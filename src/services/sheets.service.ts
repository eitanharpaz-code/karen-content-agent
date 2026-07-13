import { google, sheets_v4 } from "googleapis";
import { normalizeHebrewText, getTokenOverlapScore, tokenizeHebrewText } from "./production-status.service";
import { parseDateFromSheet, getHebrewDayName } from "../utils/date-utils";
// Stage 2 wiring (1/4): unified matching path. Matching calls NEVER use the
// Karen persona prompt — see src/types/claude-context.types.ts.
import { askClaudeForMatching } from "./claude.service";
import type { MatchingClaudeContext } from "../types/claude-context.types";

// Sheet name mapping: English reference names to actual Hebrew sheet names
const SHEET_NAMES = {
  contentLibrary: "בנק רעיונות",
  productionTasks: "משימות הפקה",
  categories: "קטגוריות",
  eventsTimeline: "ציר אירועים",
  monthlyGantt: "גאנט תוכן",
 archive: "רעיונות בצד",
  approvedContent: "תכנים שאושרו",
};

const getAuthClient = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      "Missing Google service account credentials: GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY."
    );
  }

  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
};

export const getSpreadsheetMetadata = async (spreadsheetId: string) => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  return {
    title: response.data.properties?.title,
    sheets: response.data.sheets?.map((sheet) => ({
      title: sheet.properties?.title,
      sheetId: sheet.properties?.sheetId,
    })),
  };
};

export const ensureSheetExists = async (
  spreadsheetId: string,
  sheetName: string
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const sheetExists = metadata.sheets?.some((sheet) => sheet.title === sheetName);

  if (sheetExists) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        },
      ],
    },
  });
};

export const appendRowToSheet = async (
  spreadsheetId: string,
  sheetName: string,
  values: Array<string | number | null>
): Promise<void> => {
  if (sheetName === SHEET_NAMES.categories) {
    await ensureSheetExists(spreadsheetId, SHEET_NAMES.categories);
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  console.log(`[Sheets] Writing to sheet: "${sheetName}"`);
  console.log(`[Sheets] Row payload: ${JSON.stringify(values)}`);

  try {
    const quotedSheetName = `'${sheetName.replace(/'/g, "''")}'`;
    const appendRange =
      sheetName === SHEET_NAMES.contentLibrary
        ? `${quotedSheetName}!A:K`
        : sheetName;

    console.log(`[Sheets] Append range: "${appendRange}"`);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: appendRange,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [values],
      },
    });

    console.log(`[Sheets] ✅ Successfully appended to "${sheetName}". Updated range: ${response.data.updates?.updatedRange}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Sheets] ❌ Failed to append to "${sheetName}": ${errorMessage}`);
    throw error;
  }
};

// Get all existing Content IDs globally.
// Content_ID must never be reused after moving between sheets.
export const getExistingContentIds = async (spreadsheetId: string): Promise<string[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const ranges = [
    `${SHEET_NAMES.contentLibrary}!A:A`,
    `${SHEET_NAMES.approvedContent}!A:A`,
    `${SHEET_NAMES.productionTasks}!A:A`,
    `${SHEET_NAMES.monthlyGantt}!A:A`,
  ];

  const responses = await Promise.all(
    ranges.map((range) =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      })
    )
  );

  const ids = new Set<string>();

  responses.forEach((response) => {
    const values = response.data.values || [];

    // Skip header row, filter out empty cells
    values.slice(1).forEach((row) => {
      const id = (row[0] || "").toString().trim();
      if (id) {
        ids.add(id);
      }
    });
  });

  return Array.from(ids);
};

export type CategoryRegistryEntry = {
  categoryName: string;
  prefix: string;
  createdAt: string;
  notes: string;
};

const BUILT_IN_CATEGORY_PREFIX_MAP: Record<string, string> = {
  "קפריסין": "CYP",
  "שמלות": "DRS",
  "רווקות": "BCH",
  "רווקים": "BCH",
  "על החתונה": "PRW",
  "חתונה": "WED",
  "כללי": "GEN",
  "זוגיות": "REL",
  "ספקים": "VEN",
  "משפחה": "FAM",
  "אורחים": "GST",
  "תקציב": "BUD",
  "רגשות": "EMO",
};

const GENERIC_CATEGORY_PREFIX = "CAT";

const seedCategoryRows = (): Array<Array<string>> => [
  ["category_name", "prefix", "created_at", "notes"],
  ["קפריסין", "CYP", new Date().toISOString(), ""],
  ["שמלות", "DRS", new Date().toISOString(), ""],
  ["רווקות", "BCH", new Date().toISOString(), ""],
  ["רווקים", "BCH", new Date().toISOString(), ""],
  ["על החתונה", "PRW", new Date().toISOString(), ""],
  ["חתונה", "WED", new Date().toISOString(), ""],
  ["כללי", "GEN", new Date().toISOString(), ""],
];

const transliterateHebrewToLatin = (text: string): string => {
  const mapping: Record<string, string> = {
    א: "A", ב: "B", ג: "G", ד: "D", ה: "H", ו: "V", ז: "Z", ח: "KH",
    ט: "T", י: "Y", כ: "K", ך: "K", ל: "L", מ: "M", ם: "M", נ: "N", ן: "N",
    ס: "S", ע: "A", פ: "P", ף: "P", צ: "TZ", ץ: "TZ", ק: "K", ר: "R", ש: "SH", ת: "T",
  };

  return text
    .split("")
    .map((char) => mapping[char] || "")
    .join("")
    .replace(/[^A-Z]/g, "")
    .toUpperCase();
};

const normalizeCategoryPrefixCandidate = (categoryName: string): string => {
  const normalized = normalizeHebrewText(categoryName).replace(/[^א-תa-zA-Z]/g, "");
  const mapped = BUILT_IN_CATEGORY_PREFIX_MAP[normalized];
  if (mapped) {
    return mapped;
  }

  const transliterated = transliterateHebrewToLatin(normalized);
  if (transliterated.length >= 3) {
    return transliterated.slice(0, 3);
  }

  if (transliterated.length === 2) {
    return `${transliterated}A`;
  }

  return GENERIC_CATEGORY_PREFIX;
};

const generateUniquePrefix = (basePrefix: string, existingPrefixes: Set<string>): string => {
  const normalizedBase = basePrefix.toUpperCase().slice(0, 3);
  if (!existingPrefixes.has(normalizedBase)) {
    return normalizedBase;
  }

  const prefixStart = normalizedBase.slice(0, 2) || "C";
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${prefixStart}${suffix}`.slice(0, 3).toUpperCase();
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
  }

  let counter = 2;
  while (true) {
    const candidate = `${normalizedBase.slice(0, 2)}${counter}`.slice(0, 3).toUpperCase();
    if (!existingPrefixes.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
};

export const getCategories = async (spreadsheetId: string): Promise<CategoryRegistryEntry[]> => {
  await ensureSheetExists(spreadsheetId, SHEET_NAMES.categories);
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.categories}!A:D`,
  });

  const rows = response.data.values || [];

  if (rows.length <= 1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAMES.categories}!A:D`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: seedCategoryRows() },
    });
    return seedCategoryRows().slice(1).map((row) => ({
      categoryName: row[0],
      prefix: row[1],
      createdAt: row[2],
      notes: row[3],
    }));
  }

  return rows.slice(1).map((row) => ({
    categoryName: row[0].toString(),
    prefix: row[1].toString(),
    createdAt: row[2]?.toString() || "",
    notes: row[3]?.toString() || "",
  }));
};

export const getCategoryByName = async (
  spreadsheetId: string,
  categoryName: string
): Promise<CategoryRegistryEntry | null> => {
  const categories = await getCategories(spreadsheetId);
  // Category names are a closed, known list (e.g. "חתונה" vs "על החתונה") —
  // they must NOT go through normalizeHebrewText, which strips "על" as a
  // filler word and would make these two distinct categories collide.
  // Direct trimmed comparison is correct and safe here.
  const normalizedSearch = categoryName.trim();
  return (
    categories.find(
      (entry) => entry.categoryName.trim() === normalizedSearch
    ) || null
  );
};

export const getCategoryPrefix = async (
  spreadsheetId: string,
  categoryName: string
): Promise<string | null> => {
  const category = await getCategoryByName(spreadsheetId, categoryName);
  return category?.prefix || null;
};

export const createCategory = async (
  spreadsheetId: string,
  categoryName: string,
  prefix: string,
  notes = ""
): Promise<CategoryRegistryEntry> => {
  const createdAt = new Date().toISOString();
  await appendRowToSheet(spreadsheetId, SHEET_NAMES.categories, [
    categoryName,
    prefix,
    createdAt,
    notes,
  ]);

  return {
    categoryName,
    prefix,
    createdAt,
    notes,
  };
};

export const ensureCategoryExists = async (
  spreadsheetId: string,
  categoryName: string,
  allowCreate = false
): Promise<CategoryRegistryEntry | null> => {
  // Same fix as getCategoryByName: categories are a closed list, direct
  // comparison avoids collisions like "חתונה" vs "על החתונה".
  const normalizedName = categoryName.trim();
  const categories = await getCategories(spreadsheetId);
  const existing = categories.find(
    (entry) => entry.categoryName.trim() === normalizedName
  );

  if (existing) {
    return existing;
  }

  if (!allowCreate) {
    return null;
  }

  const existingPrefixes = new Set(categories.map((entry) => entry.prefix.toUpperCase()));
  const basePrefix = normalizeCategoryPrefixCandidate(categoryName);
  const prefix = generateUniquePrefix(basePrefix, existingPrefixes);
  return createCategory(spreadsheetId, categoryName, prefix);
};

export const isUsableContentId = (contentId: string): boolean => {
  const normalized = (contentId || "").trim();

  return normalized !== "" && normalized !== "טרם תוכנן";
};

export const generateContentIdForPrefix = (
  prefix: string,
  existingIds: string[]
): string => {
  const categoryIds = existingIds.filter((id) => id.startsWith(prefix + "-"));
  let maxNum = 0;
  categoryIds.forEach((id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  });

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
};

export const generateContentId = async (
  spreadsheetId: string,
  category: string,
  existingIds: string[],
  allowCreateCategory = false
): Promise<string> => {
  const categoryEntry = await ensureCategoryExists(spreadsheetId, category, allowCreateCategory);
  const prefix = categoryEntry?.prefix || "GEN";
  return generateContentIdForPrefix(prefix, existingIds);
};

// Save content idea to בנק רעיונות
export const saveContentIdea = async (
  spreadsheetId: string,
  contentId: string,
  idea: string,
  summary: string,
  category: string,
  tone: string,
  priority: string,
  contentType: string = "ריל"
): Promise<void> => {
  console.log(`[Sprint 6] Step 1: Saving content idea to בנק רעיונות`);
  console.log(`[Sprint 6] Content_ID: ${contentId}`);

  // Bug fix (12.7.2026, found in live relaunch test): these detectors ran on
  // `idea` alone — but on the draft-approval path `idea` is Claude's SHORT
  // NAME (max 5 words), which rarely preserves words like "שת\"פ" from
  // Karen's original message. The summary almost always does, so both
  // detectors now scan name + summary together.
  const detectionText = `${idea} ${summary}`;

  const requiresShoot = /(?:בלי צילום|ללא צילום|לא דורש צילום|לא דורשת צילום|טקסט בלבד|סטורי בלבד|רק סטורי|רק טקסט)/.test(detectionText)
    ? "לא"
    : "כן";

  // Vocabulary pass (12.7.2026): added קולאב/collab (appears in Karen's own
  // sheet notes) and שיתופי פעולה. Also fixed a false positive: "שתפ" now
  // requires no Hebrew letter after it, so creator-speak like "משתפת אתכם"
  // no longer flags organic content as sponsored, while "בשת\"פ עם" still
  // matches. A spaced "שת פ" variant was considered and rejected — it
  // matches inside "רשת פ..." / "לגשת פ...".
  const collab = /(?:שת["״׳]?פ(?![\u0590-\u05FF])|שיתוף פעולה|שיתופי פעולה|חסות|חסת|ממומן|ממומנת|ברנד|מותג|לקוח|קולאב|collab)/i.test(detectionText)
    ? "כן"
    : "לא";

  const contentRow = [
    contentId,              // A - Content_ID
    idea,                   // B - רעיון
    summary,                // C - סיכום
    category,               // D - קטגוריה
    tone,                   // E - טון רגשי
    priority,               // F - רמת עדיפות
    requiresShoot,          // G - דורש יום צילום?
    collab,                 // H - שת״פ / חסות
    "רעיון",               // I - סטטוס
    "",                    // J - הערות
    new Date().toISOString(), // K - timestamp
    contentType || "ריל",      // L - סוג תוכן
  ];

  console.log(`[Sprint 6] saveContentIdea -> target="${SHEET_NAMES.contentLibrary}", content_id=${contentId}`);
  console.log(`[Sprint 6] saveContentIdea -> rowPayload=${JSON.stringify(contentRow)}`);

  // For בנק רעיונות, do NOT use values.append.
  // Google Sheets may detect a table starting at G and append to G:Q.
  // Instead, find the next non-empty row and write explicitly to A:L.
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const existingResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:Q`,
  });

  const existingRows = existingResponse.data.values || [];
  const lastNonEmptyIndex = existingRows.reduce((lastIndex, row, index) => {
    const hasAnyValue = row.some((cell) => String(cell || "").trim() !== "");
    return hasAnyValue ? index : lastIndex;
  }, 0);

  const nextRow = lastNonEmptyIndex + 2;
  const targetRange = `'${SHEET_NAMES.contentLibrary}'!A${nextRow}:L${nextRow}`;

  console.log(`[Sprint 6] saveContentIdea -> explicit targetRange=${targetRange}`);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: targetRange,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [contentRow],
    },
  });

  console.log(`[Sprint 6] ✅ Content idea saved successfully to בנק רעיונות`);
};

// Create production task in משימות הפקה
export const createProductionTask = async (
  spreadsheetId: string,
  contentId: string,
  contentName: string
): Promise<void> => {
  console.log(`[Sprint 6] Step 2: Creating production task in משימות הפקה`);
  console.log(`[Sprint 6] Content_ID: ${contentId}, Task name: ${contentName}`);

  const timestamp = new Date().toISOString();

const taskRow = [
  contentId,   // A - content_id
  contentName, // B - שם התוכן
  "לא",        // C - צולם
  "לא",        // D - נערך
  "לא",        // E - קאבר מוכן
  "",          // F - דדליין הפקה
  "",          // G - הערות
  "",          // H - ready_at
  timestamp,   // I - updated_at
];

  console.log(`[Sprint 6] createProductionTask -> target="${SHEET_NAMES.productionTasks}", content_id=${contentId}`);
  console.log(`[Sprint 6] createProductionTask -> rowPayload=${JSON.stringify(taskRow)}`);

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, taskRow);
  console.log(`[Sprint 6] ✅ Production task created successfully in משימות הפקה`);
};

export type ProductionTaskMatch = {
  rowIndex: number;
  row: string[];
};

export type ProductionTaskSearchResult =
  | ProductionTaskMatch
  | { ambiguous: true; matches: ProductionTaskMatch[] }
  | null;

/**
 * Normalize punctuation for matching purposes only.
 * Removes punctuation that might differ between user input and stored task names.
 * For matching only—does not modify stored values.
 */
const removePunctuationForMatching = (text: string): string => {
  return text
    .replace(/[,.:–\-]/g, "") // comma, period, colon, dashes (both regular and en-dash)
    .replace(/[""\"''״׳]/g, "") // English and Hebrew quotes
    .replace(/\s+/g, " ") // normalize repeated whitespace
    .trim();
};

const PRODUCTION_MATCH_GENERIC_TOKENS = new Set<string>([
  "חדש",
  "חדשה",
  "חתונה",
  "חתונות",
  "זוגיות",
  "שמלה",
  "שמלות",
  "טיקטוק",
  "טרנד",
  "סטורי",
]);

const hasMeaningfulProductionTaskOverlap = (
  searchText: string,
  candidateName: string
): boolean => {
  const searchTokens = tokenizeHebrewText(searchText).filter(
    (token) => !PRODUCTION_MATCH_GENERIC_TOKENS.has(token)
  );
  const candidateTokens = new Set(
    tokenizeHebrewText(candidateName).filter(
      (token) => !PRODUCTION_MATCH_GENERIC_TOKENS.has(token)
    )
  );

  return searchTokens.some((token) => candidateTokens.has(token));
};

// Sprint 7: Find production task by content name with Hebrew normalization
// Performs deterministic matching using normalized Hebrew text
export const findProductionTaskByName = async (
  spreadsheetId: string,
  contentName: string
): Promise<ProductionTaskSearchResult> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.productionTasks}!A:G`, // Get content_id and content name columns
    });

    const rows = response.data.values || [];

    // Normalize the incoming search term with both Hebrew and punctuation normalization
    const normalizedSearchName = normalizeHebrewText(contentName);
    const punctuationNormalizedSearch = removePunctuationForMatching(normalizedSearchName);

    console.log(`[Sprint 7] Searching for content: "${contentName}"`);
    console.log(`[Sprint 7] Normalized search term: "${normalizedSearchName}"`);
    console.log(`[Sprint 7] Punctuation-normalized search: "${punctuationNormalizedSearch}"`);

    const exactMatches: Array<{ rowIndex: number; row: string[] }> = [];
    const includesMatches: Array<{ rowIndex: number; row: string[] }> = [];
    const scoredMatches: Array<{ rowIndex: number; row: string[]; score: number }> = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sheetRowNumber = i + 1; // Google Sheets rows are 1-indexed, header occupies row 1
      if (row && row[1]) {
        const sheetContentName = row[1].toString();
        const normalizedTaskName = normalizeHebrewText(sheetContentName);
        const punctuationNormalizedTask = removePunctuationForMatching(normalizedTaskName);

        console.log(`[Sprint 7] Array index ${i} → Google Sheets row ${sheetRowNumber}: "${sheetContentName}" → normalized: "${normalizedTaskName}"`);

        // Try exact normalized match
        if (normalizedTaskName === normalizedSearchName) {
          console.log(`[Sprint 7] ✓ Exact normalized match at row ${sheetRowNumber}`);
          exactMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }

        // Try punctuation-normalized exact match
        if (punctuationNormalizedTask === punctuationNormalizedSearch) {
          console.log(`[Sprint 7] ✓ Exact punctuation-normalized match at row ${sheetRowNumber}`);
          exactMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }

// Try includes match with normalized text
        // Guard: both sides must be >= 4 chars. Prevents "שמלה" or "חדש" from matching alone.
        const MIN_INCLUDES_LENGTH = 4;
        const searchTokenCount = normalizedSearchName.split(/\s+/).filter(Boolean).length;
        if (
          searchTokenCount >= 2 &&
          normalizedSearchName.length >= MIN_INCLUDES_LENGTH &&
          normalizedTaskName.length >= MIN_INCLUDES_LENGTH &&
          normalizedTaskName.includes(normalizedSearchName)
        ) {
          console.log(`[Sprint E] ✓ Includes match (task contains search) at row ${sheetRowNumber}`);
          includesMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }
        if (
          searchTokenCount >= 2 &&
          normalizedSearchName.length >= MIN_INCLUDES_LENGTH &&
          normalizedTaskName.length >= MIN_INCLUDES_LENGTH &&
          normalizedSearchName.includes(normalizedTaskName)
        ) {
          console.log(`[Sprint E] ✓ Includes match (search contains task) at row ${sheetRowNumber}`);
          includesMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }
        // Try includes match with punctuation-normalized text
        if (
          searchTokenCount >= 2 &&
          punctuationNormalizedSearch.length >= MIN_INCLUDES_LENGTH &&
          punctuationNormalizedTask.length >= MIN_INCLUDES_LENGTH &&
          (punctuationNormalizedTask.includes(punctuationNormalizedSearch) ||
            punctuationNormalizedSearch.includes(punctuationNormalizedTask))
        ) {
          console.log(`[Sprint E] ✓ Includes punctuation-normalized match at row ${sheetRowNumber}`);
          includesMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }

        const score = getTokenOverlapScore(normalizedSearchName, normalizedTaskName);
        if (score > 0) {
          console.log(`[Sprint 8] Token overlap score ${score} for row ${sheetRowNumber}: "${sheetContentName}"`);
          scoredMatches.push({ rowIndex: sheetRowNumber, row, score });
        }
      }
    }

    if (exactMatches.length === 1) {
      console.log(`[Sprint 7] Found exactly one exact match`);
      return exactMatches[0];
    }

    if (exactMatches.length > 1) {
      console.log(`[Sprint 7] Multiple exact matches found for content name: ${contentName}`);
      return { ambiguous: true, matches: exactMatches };
    }

    if (includesMatches.length === 1) {
      console.log(`[Sprint 7] Found exactly one includes match`);
      return includesMatches[0];
    }

    if (includesMatches.length > 1) {
      console.log(`[Sprint 7] Multiple includes matches found for content name: ${contentName}`);
      return { ambiguous: true, matches: includesMatches };
    }

    // Claude-based matching for ambiguous cases
    if (scoredMatches.length > 0) {
      try {
        const candidates = scoredMatches.map((match) => ({
          rowIndex: match.rowIndex,
          row: match.row,
          name: (match.row[1] || "").toString(),
        }));

        // Stage 2 wiring (4/4): route through the unified matching path.
        // The caller-side safety checks below (new-content indicators +
        // meaningful-overlap requirement) are preserved unchanged.
        const context: MatchingClaudeContext = {
          kind: "matching",
          purpose: "production_task_match",
          query: contentName,
          candidates: candidates.map((c, i) => ({
            index: i,
            label: c.name,
            contentId: (c.row[0] || "").toString(),
          })),
          usesSystemPrompt: false,
          expectedReturn: "number_or_zero",
        };

        const matchedIndex = await askClaudeForMatching(context);

        if (matchedIndex !== null && matchedIndex >= 0 && matchedIndex < candidates.length) {
          const candidateName = candidates[matchedIndex].name;
          console.log(`[Claude Matching] "${contentName}" → "${candidateName}" (row ${candidates[matchedIndex].rowIndex})`);

          // Safety check: if user says this is new content, require meaningful (non-generic) overlap
          const newContentIndicators = ["סרטון חדש", "תוכן חדש", "רעיון חדש", "צילמתי", "ערכתי", "חדש"];
          const isNewContent = newContentIndicators.some((indicator) => contentName.includes(indicator));

          if (isNewContent) {
            // Generic/topic words to ignore when calculating meaningful overlap
            const genericWords = ["חדש", "חדשה", "תל", "אביב", "תל אביב", "חתונה", "חתונות", "זוגיות", "שמלה", "שמלות", "סרטון", "תוכן"];

            // Tokenize normalized names and filter out generic words
            const searchTokens = normalizedSearchName.split(/\s+/).filter((t) => t && !genericWords.includes(t));
            const candidateTokens = normalizeHebrewText(candidateName).split(/\s+/).filter((t) => t && !genericWords.includes(t));

            // Count meaningful overlap (tokens that appear in both after filtering generics)
            const meaningfulOverlap = searchTokens.filter((token) => candidateTokens.includes(token)).length;

            if (meaningfulOverlap === 0) {
              console.log(`[Claude Matching] Rejected weak generic match for new content: "${contentName}" → "${candidateName}"`);
              return null; // Return null to allow Fast Track flow
            }
          }

          if (!hasMeaningfulProductionTaskOverlap(contentName, candidateName)) {
            console.log(`[Claude Matching] Rejected weak Claude match: "${contentName}" → "${candidateName}"`);
            return null;
          }

          // Note: the pre-wiring version computed a `confident` flag here
          // that was never used in the return value — removed as dead code.
          return { rowIndex: candidates[matchedIndex].rowIndex, row: candidates[matchedIndex].row };
        }
} catch (claudeError) {
        // Stage E: Claude failure → return null. Do NOT fall back to weak token overlap.
        // A failed Claude call means we have no confident match — safer to open Fast Track
        // than to risk updating the wrong production row.
        console.error(`[Claude Matching] Error: ${claudeError}. Returning null (no unsafe fallback).`);
        return null;
      }
    }

    console.log(`[Sprint 7] No production task found for content name: ${contentName}`);
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Sprint 7] Failed to find production task: ${errorMessage}`);
    throw error;
  }
};

// Sprint 7: Update production status in משימות הפקה
// Updates a specific cell to "כן"
export const updateProductionStatus = async (
  spreadsheetId: string,
  rowIndex: number,
  columnIndex: number
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const statusColumns = [3, 4, 5];

    if (!statusColumns.includes(columnIndex)) {
      throw new Error(
        `Invalid status column index ${columnIndex}. May only update C-E.`
      );
    }

    const columnLetter = String.fromCharCode(64 + columnIndex);
    const statusRange =
      `${SHEET_NAMES.productionTasks}!${columnLetter}${rowIndex}`;

    const timestamp = new Date().toISOString();

    const updates: Array<{
      range: string;
      values: string[][];
    }> = [
      {
        range: statusRange,
        values: [["כן"]],
      },
      {
        range: `${SHEET_NAMES.productionTasks}!I${rowIndex}`,
        values: [[timestamp]],
      },
    ];

    // Editing makes the content ready.
    // Set ready_at only once.
    if (columnIndex === 4) {
      const readyAtResponse =
        await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${SHEET_NAMES.productionTasks}!H${rowIndex}`,
        });

      const existingReadyAt =
        readyAtResponse.data.values?.[0]?.[0]
          ?.toString()
          .trim() || "";

      if (!existingReadyAt) {
        updates.push({
          range: `${SHEET_NAMES.productionTasks}!H${rowIndex}`,
          values: [[timestamp]],
        });
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });

    console.log(
      `[Sprint 7] Updated ${statusRange}; updated_at=${timestamp}` +
        (columnIndex === 4 ? "; ready_at checked" : "")
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error(
      `[Sprint 7] Failed to update production status: ${errorMessage}`
    );

    throw error;
  }
};

// Get column index by Hebrew column name
// Returns 1-indexed column number
export const getProductionStatusColumnIndex = (columnName: string): number | null => {
  // Column mapping for משימות הפקה
 const columnMap: Record<string, number> = {
    "content_id": 1,
    "שם התוכן": 2,
    "צולם": 3,
    "נערך": 4,
    "קאבר מוכן": 5,
    "דדליין הפקה": 6,
    "הערות": 7,
  };

  return columnMap[columnName] || null;
};

// ========== Sprint 10: Visibility Queries (Read-Only) ==========

export type ProductionTaskRow = {
  contentId: string;
  taskName: string;
  needsText: string;
  filmed: string;
  edited: string;
  coverReady: string;
  copyReady: string;
  uploaded: string;
  deadline: string;
  uploadTime: string;
  notes: string;
  readyAt: string;
  updatedAt: string;
};

// Get all production tasks from משימות הפקה
export const getAllProductionTasks = async (
  spreadsheetId: string
): Promise<ProductionTaskRow[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.productionTasks}!A:I`,
  });

  const values = response.data.values || [];

  // Skip header row (row 1)
  return values.slice(1).map((row) => ({
    contentId: row[0] || "",
    taskName: row[1] || "",
    needsText: "לא",
    filmed: row[2] || "לא",
    edited: row[3] || "לא",
    coverReady: row[4] || "לא",
    copyReady: "כן",
    uploaded: "לא",
    deadline: row[5] || "",
    uploadTime: "",
    notes: row[6] || "",
    readyAt: row[7] || "",
    updatedAt: row[8] || "",
  }));
};
// Get tasks missing filming: filmed != כן
export const getTasksMissingFilmed = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.filmed !== "כן");
};
// Get tasks that need editing: filmed but not edited
export const getTasksMissingEdit = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  // "מחכה לעריכה" means it was filmed but not edited yet.
  return tasks.filter((task) => task.filmed === "כן" && task.edited !== "כן");
};

// Get tasks missing cover: cover ready != כן
export const getTasksMissingCover = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.coverReady !== "כן");
};

// Get tasks not uploaded: uploaded != כן
export const getTasksNotUploaded = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.uploaded !== "כן");
};

export const getTasksEditedAndNotUploaded = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const [tasks, ganttResponse] = await Promise.all([
    getAllProductionTasks(spreadsheetId),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.monthlyGantt}!A:K`,
    }),
  ]);

  const ganttRows = ganttResponse.data.values || [];
  const publishedIds = new Set<string>();

  ganttRows.slice(1).forEach((row) => {
    const contentId = (row[0] || "").toString().trim();
    const status = (row[10] || "").toString().trim();

    if (contentId && status === "פורסם") {
      publishedIds.add(contentId);
    }
  });

  return tasks.filter((task) => task.edited === "כן" && !publishedIds.has(task.contentId));
};

// Get stuck tasks: content that started production but is blocked before ready.
// "Edited but not uploaded" is not stuck. It belongs to ready-to-upload / gantt views.
export const getStuckTasks = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);

  return tasks.filter((task) => {
    // Filmed but not edited
    if (task.filmed === "כן" && task.edited !== "כן") {
      return true;
    }

    // Filmed/edited but missing cover
    if (task.filmed === "כן" && task.edited === "כן" && task.coverReady !== "כן") {
      return true;
    }

    return false;
  });
};
export type OpenContentIdea = {
  contentId: string;
  idea: string;
  summary: string;
  category: string;
  tone: string;
  priority: string;
  contentType: string;
  requiresShoot: string;
  collaboration: string;
  status: string;
  notes: string;
};

export const getOpenContentIdeas = async (spreadsheetId: string): Promise<OpenContentIdea[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:L`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  return rows.slice(1)
    .filter((row) => {
      const contentId = (row[0] || "").toString().trim();
      const idea = (row[1] || "").toString().trim();
      const status = (row[8] || "").toString().trim();
      return contentId && idea && status !== "ארכיון";
    })
    .map((row) => ({
      contentId: (row[0] || "").toString().trim(),
      idea: (row[1] || "").toString().trim(),
      summary: (row[2] || "").toString().trim(),
      category: (row[3] || "").toString().trim(),
      tone: (row[4] || "").toString().trim(),
      priority: (row[5] || "").toString().trim(),
      contentType: (row[11] || "ריל").toString().trim(),
      requiresShoot: (row[6] || "").toString().trim(),
      collaboration: (row[7] || "").toString().trim(),
      status: (row[8] || "").toString().trim(),
      notes: (row[9] || "").toString().trim(),
    }));
};

// Get content idea summary by name - returns shortName and idea text
export const getContentIdeaSummary = async (
  spreadsheetId: string,
  searchName: string
): Promise<{ shortName: string; idea: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:C`,
  });
  const values = response.data.values || [];
  const candidates = values.slice(1)
    .filter((row) => row[1])
    .map((row) => ({ contentId: (row[0] || "").toString(), idea: row[1].toString() }));

  if (candidates.length === 0) return null;

  try {
    // Stage 2 wiring (1/4): route through the unified matching path instead
    // of an ad-hoc fetch(). askClaudeForMatching never uses the persona and
    // returns the matched candidate index, or null (no unsafe fallback).
    const context: MatchingClaudeContext = {
      kind: "matching",
      purpose: "content_idea_match",
      query: searchName,
      candidates: candidates.map((c, i) => ({
        index: i,
        label: c.idea,
        contentId: c.contentId,
      })),
      usesSystemPrompt: false,
      expectedReturn: "number_or_zero",
    };

    const matchedIndex = await askClaudeForMatching(context);

    if (matchedIndex !== null && matchedIndex >= 0 && matchedIndex < candidates.length) {
      const ideaText = candidates[matchedIndex].idea;
      const shortName = ideaText.split(/\s+/).slice(0, 6).join(" ");
      console.log(`[Claude Summary] "${searchName}" → "${shortName}"`);
      return { shortName, idea: ideaText };
    }
} catch (error) {
    // Stage E completion: Claude failure → null. Do NOT fall back to weak
    // token overlap — same risk pattern fixed in the other matching
    // functions today. A failed Claude call means no confident match.
    console.error(`[Claude Summary] Error: ${error}. Returning null (no unsafe fallback).`);
    return null;
  }
  return null;
};
// Get content metadata from both בנק רעיונות and תכנים שאושרו.
// Approved content is important because once an idea moves to production,
// it is removed from בנק רעיונות.
export const getContentIdeasWithPriority = async (
  spreadsheetId: string
): Promise<Map<string, { priority: string; category: string; contentType: string }>> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const [ideasResponse, approvedResponse] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.contentLibrary}!A:L`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.approvedContent}!A:K`,
    }),
  ]);

  const map = new Map<string, { priority: string; category: string; contentType: string }>();

  const addRowsToMap = (values: any[][], contentTypeIndex: number) => {
    values.slice(1).forEach((row) => {
      const contentId = (row[0] || "").toString().trim();
      const category = (row[3] || "").toString().trim();
      const priority = (row[5] || "בינוני").toString().trim();
      const contentType = (row[contentTypeIndex] || "ריל").toString().trim();

      if (contentId) {
        map.set(contentId, { priority, category, contentType });
      }
    });
  };

  addRowsToMap(ideasResponse.data.values || [], 11);
  addRowsToMap(approvedResponse.data.values || [], 10);

  return map;
};

// Extended task row with priority, category, and content type from content metadata
export type ProductionTaskRowExtended = ProductionTaskRow & {
  priority: string;
  category: string;
  contentType: string;
  isTrend: boolean;
  deadlineDate: Date | null;
  deadlineDayName: string;
};

// Get all production tasks with priority from content metadata
export const getAllProductionTasksWithPriority = async (
  spreadsheetId: string
): Promise<ProductionTaskRowExtended[]> => {
  const [tasks, ideasMap] = await Promise.all([
    getAllProductionTasks(spreadsheetId),
    getContentIdeasWithPriority(spreadsheetId),
  ]);

  return tasks.map((task) => {
    const idea = ideasMap.get(task.contentId);
    const deadlineDate = parseDateFromSheet(task.deadline);
    const deadlineDayName = deadlineDate ? getHebrewDayName(deadlineDate) : "";

    return {
      ...task,
      priority: idea?.priority || "בינוני",
      category: idea?.category || "",
      contentType: idea?.contentType || "ריל",
      isTrend: task.contentId.startsWith("TRD-"),
      deadlineDate,
      deadlineDayName,
    };
  });
};
// Search tasks by keyword or category
export const searchTasksByKeyword = async (
  spreadsheetId: string,
  keyword: string
): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  const normalizedKeyword = normalizeHebrewText(keyword);
  return tasks.filter((task) => {
    const normalizedName = normalizeHebrewText(task.taskName);
    const normalizedNotes = normalizeHebrewText(task.notes);
    return (
      normalizedName.includes(normalizedKeyword) ||
      normalizedNotes.includes(normalizedKeyword)
    );
  });
};

// Export sheet names for use in other modules
export { SHEET_NAMES };

// Get tasks by category and stage for category_stage_filter intent
export const getTasksByCategory = async (
  spreadsheetId: string,
  category: string,
  stage: string
): Promise<ProductionTaskRow[]> => {
  const [tasks, ideasMap] = await Promise.all([
    getAllProductionTasks(spreadsheetId),
    getContentIdeasWithPriority(spreadsheetId),
  ]);

  const filtered = tasks.filter((task) => {
    const idea = ideasMap.get(task.contentId);
    if (!idea) return false;
    if (idea.category.trim() !== category.trim()) return false;

    switch (stage) {
      case "filmed":   return task.filmed !== "כן";
      case "edited":   return task.edited !== "כן";
      case "cover":    return task.coverReady !== "כן";
      case "uploaded": return task.uploaded !== "כן";
      default:         return false;
    }
  });

  return filtered;
};
// Update deadline for a production task
export const findRowIndexByContentId = async (
  spreadsheetId: string,
  contentId: string
): Promise<number | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.productionTasks}!A:A`,
  });
  const rows = response.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]?.toString().trim() === contentId.trim()) {
      return i + 1; // 1-indexed
    }
  }
  return null;
};
export const updateDeadline = async (
  spreadsheetId: string,
  rowIndex: number,
  deadline: string
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const timestamp = new Date().toISOString();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${SHEET_NAMES.productionTasks}!F${rowIndex}`,
          values: [[deadline]],
        },
        {
          range: `${SHEET_NAMES.productionTasks}!I${rowIndex}`,
          values: [[timestamp]],
        },
      ],
    },
  });

  console.log(
    `[Deadline] Updated deadline for row ${rowIndex} to ${deadline}; updated_at=${timestamp}`
  );
};
// Find similar content idea in בנק רעיונות for duplicate detection
export const findSimilarContentIdea = async (
  spreadsheetId: string,
  ideaText: string
): Promise<{ contentId: string; idea: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:B`,
  });

  const values = response.data.values || [];
  const normalized = normalizeHebrewText(ideaText).toLowerCase();

  const candidates = values.slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => ({ contentId: row[0].toString(), idea: row[1].toString() }));

  if (candidates.length === 0) return null;

  try {
    // Stage 2 wiring (3/4): route through the unified matching path.
    // purpose: "similar_idea_match" selects the duplicate-detection prompt
    // wording inside askClaudeForMatching (see buildMatchingPrompt) — the
    // exact wording this function used before, so behavior is unchanged.
    const context: MatchingClaudeContext = {
      kind: "matching",
      purpose: "similar_idea_match",
      query: ideaText,
      candidates: candidates.map((c, i) => ({
        index: i,
        label: c.idea,
        contentId: c.contentId,
      })),
      usesSystemPrompt: false,
      expectedReturn: "number_or_zero",
    };

    const matchedIndex = await askClaudeForMatching(context);

    if (matchedIndex !== null && matchedIndex >= 0 && matchedIndex < candidates.length) {
      console.log(`[Claude Duplicate] "${ideaText}" → "${candidates[matchedIndex].idea}"`);
      return { contentId: candidates[matchedIndex].contentId, idea: candidates[matchedIndex].idea };
    }
  } catch (error) {
    // Stage E completion: Claude failure → null. Do NOT fall back to weak
    // token overlap — a failed Claude call means we have no confident
    // duplicate match, and a wrong "similar idea found" message would
    // wrongly discourage the user from saving a genuinely new idea.
    console.error(`[Claude Duplicate] Error: ${error}. Returning null (no unsafe fallback).`);
    return null;
  }
  return null;
};
// Archive content idea — moves the row from either בנק רעיונות or תכנים
// שאושרו into רעיונות בצד and deletes it from the source sheet.
//
// Prior behavior only searched בנק רעיונות. Karen noted she needs to
// archive items that already moved into production (approved-content) too,
// so we now try בנק רעיונות first, then fall back to תכנים שאושרו before
// giving up. Cascade cleanups run in both cases:
//   - delete matching row from משימות הפקה (production tasks) by contentId
//   - mark matching row in גאנט תוכן as "בוטל" via updateGanttStatus
export const archiveContentIdea = async (
  spreadsheetId: string,
  contentName: string
): Promise<{ success: boolean; archivedName: string; source: "library" | "approved" } | null> => {
  const libResult = await _archiveRowByFuzzyName(
    spreadsheetId,
    contentName,
    SHEET_NAMES.contentLibrary
  );
  if (libResult) {
    await _cascadeCleanup(spreadsheetId, libResult.contentId);
    return { success: true, archivedName: libResult.archivedName, source: "library" };
  }

  const approvedResult = await _archiveRowByFuzzyName(
    spreadsheetId,
    contentName,
    SHEET_NAMES.approvedContent
  );
  if (approvedResult) {
    await _cascadeCleanup(spreadsheetId, approvedResult.contentId);
    return { success: true, archivedName: approvedResult.archivedName, source: "approved" };
  }

  return null;
};

// Archive by exact contentId + known source sheet. Used by bulk archive
// after local fuzzy matching has already resolved the source — avoids a
// redundant name-search step.
export const archiveContentByContentId = async (
  spreadsheetId: string,
  contentId: string,
  source: "library" | "approved"
): Promise<{ success: boolean; archivedName: string } | null> => {
  const sourceSheet =
    source === "library" ? SHEET_NAMES.contentLibrary : SHEET_NAMES.approvedContent;
  const result = await _archiveRowByContentId(spreadsheetId, contentId, sourceSheet);
  if (!result) return null;
  await _cascadeCleanup(spreadsheetId, result.contentId);
  return { success: true, archivedName: result.archivedName };
};

// --- Internal helpers ------------------------------------------------------

const _archiveRowByFuzzyName = async (
  spreadsheetId: string,
  contentName: string,
  sourceSheetName: string
): Promise<{ archivedName: string; contentId: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sourceSheetName}!A:K`,
  });

  const values = response.data.values || [];
  const normalized = normalizeHebrewText(contentName).toLowerCase();

  let matchIndex = -1;
  let matchRow: string[] = [];

  for (let i = 1; i < values.length; i++) {
    const idea = (values[i][1] || "").toString();
    const score = getTokenOverlapScore(normalized, normalizeHebrewText(idea).toLowerCase());
    if (score >= 1) {
      matchIndex = i + 1;
      matchRow = values[i];
      break;
    }
  }

  if (matchIndex === -1) return null;

  return await _moveRowToArchiveAndDelete(spreadsheetId, sourceSheetName, matchIndex, matchRow);
};

const _archiveRowByContentId = async (
  spreadsheetId: string,
  contentId: string,
  sourceSheetName: string
): Promise<{ archivedName: string; contentId: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sourceSheetName}!A:K`,
  });

  const values = response.data.values || [];

  let matchIndex = -1;
  let matchRow: string[] = [];

  for (let i = 1; i < values.length; i++) {
    if ((values[i][0] || "").toString().trim() === contentId.trim()) {
      matchIndex = i + 1;
      matchRow = values[i];
      break;
    }
  }

  if (matchIndex === -1) return null;

  return await _moveRowToArchiveAndDelete(spreadsheetId, sourceSheetName, matchIndex, matchRow);
};

const _moveRowToArchiveAndDelete = async (
  spreadsheetId: string,
  sourceSheetName: string,
  matchIndex: number,
  matchRow: string[]
): Promise<{ archivedName: string; contentId: string }> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const paddedRow = Array.from({ length: 11 }, (_, i) => matchRow[i] || "");
  const archiveRow = [...paddedRow, israelTime];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAMES.archive}!A:L`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [archiveRow] },
  });

  const sheetMeta = await getSpreadsheetMetadata(spreadsheetId);
  const sourceSheet = sheetMeta.sheets?.find((s) => s.title === sourceSheetName);
  if (!sourceSheet?.sheetId) {
    throw new Error(`Could not find sheet ID for ${sourceSheetName}`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sourceSheet.sheetId,
              dimension: "ROWS",
              startIndex: matchIndex - 1,
              endIndex: matchIndex,
            },
          },
        },
      ],
    },
  });

  return {
    archivedName: (matchRow[1] || "").toString(),
    contentId: (matchRow[0] || "").toString(),
  };
};

const _cascadeCleanup = async (
  spreadsheetId: string,
  contentId: string
): Promise<void> => {
  if (!contentId) return;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // 1) Delete matching row from משימות הפקה
  try {
    const tasksResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.productionTasks}!A:A`,
    });
    const taskRows = tasksResponse.data.values || [];
    const taskRowIndex = taskRows.findIndex((row, i) => i > 0 && row[0] === contentId);
    if (taskRowIndex > 0) {
      const taskSheetMeta = await getSpreadsheetMetadata(spreadsheetId);
      const taskSheet = taskSheetMeta.sheets?.find(
        (s) => s.title === SHEET_NAMES.productionTasks
      );
      if (taskSheet?.sheetId !== undefined) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: taskSheet.sheetId,
                    dimension: "ROWS",
                    startIndex: taskRowIndex,
                    endIndex: taskRowIndex + 1,
                  },
                },
              },
            ],
          },
        });
      }
    }
  } catch (err) {
    console.error(`[_cascadeCleanup] productionTasks cleanup failed for ${contentId}: ${err}`);
  }

  // 2) Mark matching row in גאנט as בוטל. updateGanttStatus is a no-op
  // when no gantt row exists for the content — safe to call unconditionally.
  try {
    await updateGanttStatus(spreadsheetId, contentId, "בוטל");
  } catch (err) {
    console.error(`[_cascadeCleanup] gantt cancel failed for ${contentId}: ${err}`);
  }
};
// Get list of archived content ideas
export const getArchiveList = async (spreadsheetId: string): Promise<{ contentId: string; idea: string }[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.archive}!A:B`,
  });

  const values = response.data.values || [];
  return values.slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      contentId: row[0].toString(),
      idea: row[1].toString(),
    }));
};

// Restore content idea from archive back to בנק רעיונות + create production task
export const restoreFromArchive = async (
  spreadsheetId: string,
  contentName: string
): Promise<{ success: boolean; restoredName: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Find in archive
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.archive}!A:L`,
  });

  const values = response.data.values || [];
  const normalized = normalizeHebrewText(contentName).toLowerCase();

  let matchIndex = -1;
  let matchRow: string[] = [];

let bestScore = 0;
  for (let i = 1; i < values.length; i++) {
    const idea = (values[i][1] || "").toString();
    const score = getTokenOverlapScore(normalized, normalizeHebrewText(idea).toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      matchIndex = i + 1;
      matchRow = values[i];
    }
  }
  if (bestScore < 1) matchIndex = -1;

  if (matchIndex === -1) return null;

  // Add back to בנק רעיונות (columns A-K only, skip timestamp in L)
  const ideaRow = matchRow.slice(0, 11);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [ideaRow] },
  });

  // Re-create production task
  const contentId = (matchRow[0] || "").toString();
  const contentShortName = (matchRow[1] || "").toString().split(/\s+/).slice(0, 6).join(" ");
  const restoredAt = new Date().toISOString();

await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
  contentId,
  contentShortName,
  "לא",
  "לא",
  "לא",
  "",
  "",
  "",
  restoredAt,
]);

  // Delete from archive
  const sheetMeta = await getSpreadsheetMetadata(spreadsheetId);
  const archiveSheet = sheetMeta.sheets?.find((s) => s.title === SHEET_NAMES.archive);
  if (archiveSheet?.sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: archiveSheet.sheetId,
                dimension: "ROWS",
                startIndex: matchIndex - 1,
                endIndex: matchIndex,
              },
            },
          },
        ],
      },
    });
  }

  return { success: true, restoredName: (matchRow[1] || contentName).toString() };
};
export const approveContentForProduction = async (
  spreadsheetId: string,
  contentId: string
): Promise<{ success: boolean; name: string; contentId: string }> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // 1. מצא את הרעיון בבנק רעיונות
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:L`,
  });

  const rows = response.data.values || [];
  const rawSearch = contentId.toString().trim();
  const normalizedSearch = normalizeHebrewText(rawSearch).toLowerCase();

  const rowIndex = rows.findIndex((row, i) => {
    if (i === 0) return false;

    const rowId = (row[0] || "").toString().trim();
    const rawRowName = (row[1] || "").toString().trim();

    // Never match fully empty rows.
    // Without this guard, normalizedSearch.includes("") is always true.
    if (!rowId && !rawRowName) return false;

    // Exact Content_ID match should work even if the name is empty.
    if (rowId && rowId === rawSearch) return true;

    // Name-based matching only if the row has an actual name.
    if (!rawRowName) return false;

    const rowName = normalizeHebrewText(rawRowName).toLowerCase();
    const score = getTokenOverlapScore(normalizedSearch, rowName);

    return rowName.includes(normalizedSearch) || normalizedSearch.includes(rowName) || score >= 2;
  });
  if (rowIndex === -1) throw new Error(`לא נמצא רעיון עם ID: ${contentId}`);

  const row = rows[rowIndex];
  const actualContentId = (row[0] || "").toString().trim();
  const name = (row[1] || "").toString().trim();
  const summary = (row[2] || "").toString().trim();
  const category = (row[3] || "").toString().trim();
  const tone = (row[4] || "").toString().trim();
  const priority = (row[5] || "").toString().trim();
  const collab = (row[7] || "").toString().trim();
  const notes = (row[9] || "").toString().trim();
  const contentType = (row[11] || "ריל").toString().trim();
  const timestamp = new Date().toISOString();

  // 2. הוסף לתכנים שאושרו
await appendRowToSheet(spreadsheetId, SHEET_NAMES.approvedContent, [
    actualContentId, name, summary, category, tone, priority,
    "ממתין לצילום", collab, notes, timestamp, contentType || "ריל",
  ]);

  // 3. פתח שורה במשימות הפקה
await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
  actualContentId,
  name,
  "לא",
  "לא",
  "לא",
  "",
  "",
  "",
  timestamp,
]);

  // 4. מחק מבנק רעיונות
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A${rowIndex + 1}:L${rowIndex + 1}`,
  });

  return { success: true, name, contentId: actualContentId };
};
export const getGanttByDateRange = async (
  spreadsheetId: string,
  startDate: Date,
  endDate: Date
): Promise<any[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `גאנט תוכן!A:M`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const results: any[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = (row[1] || "").toString().trim();
    if (!dateStr) continue;

    const parsed = parseDateFromSheet(dateStr);
    if (!parsed) continue;

    if (parsed >= startDate && parsed <= endDate) {
      results.push({
        contentId: (row[0] || "").toString().trim(),
        date: dateStr,
        day: (row[2] || "").toString().trim(),
        platform: (row[3] || "").toString().trim(),
        contentType: (row[4] || "").toString().trim(),
        name: (row[5] || "").toString().trim(),
        topic: (row[6] || "").toString().trim(),
        priority: (row[7] || "").toString().trim(),
        hasStories: (row[8] || "").toString().trim(),
        collaboration: (row[9] || "").toString().trim(),
        status: (row[10] || "").toString().trim(),
        uploadTime: (row[11] || "").toString().trim(),
        notes: (row[12] || "").toString().trim(),
      });
    }
  }

  return results;
};
export const updateGanttStatus = async (
  spreadsheetId: string,
  contentId: string,
  status: string
): Promise<boolean> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `גאנט תוכן!A:K`,
  });

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row, i) => i > 0 && (row[0] || "").toString().trim() === contentId);
  if (rowIndex === -1) {
    console.log(`[Gantt] No gantt row found for contentId: ${contentId}`);
    return false;
  }

  // עמודה K היא סטטוס (index 10, עמודה 11)
  const cellAddress = `גאנט תוכן!K${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellAddress,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[status]] },
  });

  console.log(`[Gantt] ✅ Updated status to "${status}" at ${cellAddress}`);

  // Write publish timestamp only when the content is actually published.
  // "מוכן" should not fill column N.
  if (status === "פורסם") {
    const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    const timestampRange = `גאנט תוכן!N${rowIndex + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: timestampRange,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[israelTime]] },
    });

    console.log(`[Gantt] ✅ Wrote publish timestamp to N${rowIndex + 1}: ${israelTime}`);
  }

  return true;
};
// Get gantt rows that are NOT published (status ≠ "פורסם")
export const getGanttNotPublished = async (spreadsheetId: string): Promise<any[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `גאנט תוכן!A:M`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  return rows.slice(1).filter((row) => {
    const status = (row[10] || "").toString().trim();
    return status !== "פורסם";
  }).map((row) => ({
    contentId: (row[0] || "").toString().trim(),
    date: (row[1] || "").toString().trim(),
    day: (row[2] || "").toString().trim(),
    platform: (row[3] || "").toString().trim(),
    contentType: (row[4] || "").toString().trim(),
    taskName: (row[5] || "").toString().trim(),
    name: (row[5] || "").toString().trim(),
    topic: (row[6] || "").toString().trim(),
    priority: (row[7] || "").toString().trim(),
    hasStories: (row[8] || "").toString().trim(),
    collaboration: (row[9] || "").toString().trim(),
    status: (row[10] || "").toString().trim(),
    uploadTime: (row[11] || "").toString().trim(),
    notes: (row[12] || "").toString().trim(),
  }));
};

// Get gantt rows that are ready to upload.
// Source of truth for questions like:
// "מה ערכתי ולא עלה?", "מה מוכן לעלייה?"
export const getGanttReadyToUpload = async (spreadsheetId: string): Promise<any[]> => {
  const items = await getGanttNotPublished(spreadsheetId);
  return items.filter((item) => item.status === "מוכן");
};

// Get gantt rows scheduled for this week that are NOT published
export const getGanttThisWeek = async (spreadsheetId: string): Promise<any[]> => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const all = await getGanttNotPublished(spreadsheetId);
  return all.filter((item) => {
    const parsed = parseDateFromSheet(item.date);
    if (!parsed) return false;
    return parsed >= startOfWeek && parsed <= endOfWeek;
  });
};
// Find approved content by name with token overlap fallback
export const findApprovedContentByName = async (
  spreadsheetId: string,
  contentName: string
): Promise<{ contentId: string; name: string; exact: boolean } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:B`,
  });

  const rows = response.data.values || [];
  const normalized = normalizeHebrewText(contentName).toLowerCase();

  // Try exact match first
  for (const row of rows.slice(1)) {
    const name = (row[1] || "").toString();
    if (normalizeHebrewText(name).toLowerCase() === normalized) {
      return { contentId: row[0].toString(), name, exact: true };
    }
  }

  // Fallback: Claude-based matching
  const candidates = rows.slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => ({ contentId: row[0].toString(), name: row[1].toString() }));

  if (candidates.length === 0) return null;

  try {
    // Stage 2 wiring (2/4): route through the unified matching path instead
    // of an ad-hoc fetch(). askClaudeForMatching never uses the persona and
    // returns the matched candidate index, or null (no unsafe fallback).
    const context: MatchingClaudeContext = {
      kind: "matching",
      purpose: "approved_content_match",
      query: contentName,
      candidates: candidates.map((c, i) => ({
        index: i,
        label: c.name,
        contentId: c.contentId,
      })),
      usesSystemPrompt: false,
      expectedReturn: "number_or_zero",
    };

    const matchedIndex = await askClaudeForMatching(context);

    if (matchedIndex !== null && matchedIndex >= 0 && matchedIndex < candidates.length) {
      console.log(`[Claude Matching] "${contentName}" → "${candidates[matchedIndex].name}"`);
      // אם השם המחופש מופיע בשם המלא — Claude בטוח
      const confident = candidates[matchedIndex].name.toLowerCase().includes(contentName.toLowerCase()) ||
                        contentName.toLowerCase().split(/\s+/).every((word) => candidates[matchedIndex].name.toLowerCase().includes(word));
      return { contentId: candidates[matchedIndex].contentId, name: candidates[matchedIndex].name, exact: confident };
    }
  } catch (error) {
    // Stage E completion: Claude failure → null. Do NOT fall back to weak
    // token overlap — same risk pattern fixed earlier today in
    // findProductionTaskByName: a failed Claude call means no confident
    // match, and a weak fallback could schedule/confirm the wrong content.
    console.error(`[Claude Matching] Error: ${error}. Returning null (no unsafe fallback).`);
    return null;
  }

  return null;
};

// Update status in תכנים שאושרו by Content_ID
export const updateApprovedContentStatusById = async (
  spreadsheetId: string,
  contentId: string,
  status: "ממתין לצילום" | "ממתין לעריכה" | "מוכן לעלייה" | "פורסם" | "בוטל"
): Promise<boolean> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:G`,
  });

  const rows = response.data.values || [];
  const normalizedContentId = contentId.toString().trim();

  for (let i = 1; i < rows.length; i++) {
    const rowContentId = (rows[i][0] || "").toString().trim();

    if (rowContentId === normalizedContentId) {
      const rowIndex = i + 1; // Google Sheets is 1-indexed
      const range = `${SHEET_NAMES.approvedContent}!G${rowIndex}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[status]],
        },
      });

      console.log(`[Approved Content] ✅ Updated status for ${contentId} to "${status}"`);
      return true;
    }
  }

  console.warn(`[Approved Content] ⚠️ Could not find Content_ID ${contentId} in תכנים שאושרו`);
  return false;
};

// Write a new row to גאנט תוכן
const formatDateForSheet = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

const calculateProductionDeadlineFromGanttDate = (ganttDate: string): string | null => {
  const parts = ganttDate.split("/");

  if (parts.length !== 3) {
    return null;
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  const uploadDate = new Date(year, month - 1, day);

  if (Number.isNaN(uploadDate.getTime())) {
    return null;
  }

  const deadlineDate = new Date(uploadDate);
  deadlineDate.setDate(uploadDate.getDate() - 1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (deadlineDate < today) {
    return formatDateForSheet(uploadDate);
  }

  return formatDateForSheet(deadlineDate);
};

const updateProductionDeadlineForGanttItem = async (
  spreadsheetId: string,
  contentId: string,
  ganttDate: string
): Promise<string | null> => {
  const productionDeadline = calculateProductionDeadlineFromGanttDate(ganttDate);

  if (!productionDeadline) {
    return null;
  }

  const productionRowIndex = await findRowIndexByContentId(spreadsheetId, contentId);

  if (!productionRowIndex) {
    console.log(`[Gantt] No production task found for content_id=${contentId}. Skipping production deadline update.`);
    return null;
  }

  await updateDeadline(spreadsheetId, productionRowIndex, productionDeadline);

  console.log(`[Gantt] ✅ Production deadline updated for content_id=${contentId}: ${productionDeadline}`);

  return productionDeadline;
};

export type GanttEntry = {
  contentId: string;
  date: string;
  name: string;
};

export class GanttDuplicateError extends Error {
  constructor(public readonly entry: GanttEntry) {
    super(`Content ${entry.contentId} is already scheduled on ${entry.date}`);
    this.name = "GanttDuplicateError";
    Object.setPrototypeOf(this, GanttDuplicateError.prototype);
  }
}

export const findGanttEntryByContentId = async (
  spreadsheetId: string,
  contentId: string
): Promise<GanttEntry | null> => {
  if (!isUsableContentId(contentId)) return null;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:F`,
  });

  const row = (response.data.values || [])
    .slice(1)
    .find(
      (candidate) =>
        (candidate[0] || "").toString().trim() === contentId.trim()
    );

  if (!row) return null;

  return {
    contentId: (row[0] || "").toString().trim(),
    date: (row[1] || "").toString().trim(),
    name: (row[5] || "").toString().trim(),
  };
};

export const addRowToGantt = async (
  spreadsheetId: string,
  contentId: string,
  contentName: string,
  date: string,
  dayName: string,
  uploadTime: string = "",
  status: "בתכנון" | "מוכן" | "בזמן אמת" | "פורסם" = "בתכנון"
): Promise<string | null> => {
  if (!isUsableContentId(contentId)) {
    throw new Error(
      `Invalid contentId for gantt write: "${contentId || ""}"`
    );
  }

  // Pull priority, collab, and content type from תכנים שאושרו
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const existingEntry = await findGanttEntryByContentId(
    spreadsheetId,
    contentId
  );

  if (existingEntry) {
    throw new GanttDuplicateError(existingEntry);
  }

  const approvedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:K`,
  });

  const approvedRows = approvedResponse.data.values || [];
  const approvedRow = approvedRows.slice(1).find((row) => (row[0] || "").toString().trim() === contentId);

  const priority = approvedRow ? (approvedRow[5] || "").toString().trim() : "";
  const collab = approvedRow ? (approvedRow[7] || "").toString().trim() : "";
  const contentType = approvedRow ? (approvedRow[10] || "ריל").toString().trim() : "ריל";

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.monthlyGantt, [
    contentId,          // A - content_id
    date,              // B - תאריך
    dayName,          // C - יום
    "אינסטגרם",      // D - פלטפורמה
    contentType || "ריל", // E - סוג תוכן
    contentName,     // F - שם התוכן/קונספט
    "",              // G - נושא/פרק
    priority,        // H - רמת עדיפות
    "",              // I - סטוריז תומכים
    collab || "לא",  // J - שת"פ/חסות
    status,          // K - סטטוס
    uploadTime,      // L - שעת העלאה
    "",              // M - הערות
  ]);

  const productionDeadline = await updateProductionDeadlineForGanttItem(
    spreadsheetId,
    contentId,
    date
  );

  return productionDeadline;
};
// Sort גאנט תוכן by date column (column B, index 1) ascending
export const sortGanttByDate = async (spreadsheetId: string): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Get sheet ID for גאנט תוכן
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  const ganttSheet = metadata.sheets?.find((s) => s.title === SHEET_NAMES.monthlyGantt);
  if (!ganttSheet || ganttSheet.sheetId === undefined) {
    console.log("[Gantt Sort] Could not find גאנט תוכן sheet ID");
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: {
              sheetId: ganttSheet.sheetId,
              startRowIndex: 1, // skip header
              startColumnIndex: 0,
              endColumnIndex: 14,
            },
            sortSpecs: [
              {
                dimensionIndex: 1, // column B = תאריך
                sortOrder: "ASCENDING",
              },
            ],
          },
        },
      ],
    },
  });

  console.log("[Gantt Sort] ✅ Sorted גאנט תוכן by date");
};
// Update upload time (column L) for a gantt row by content name and date
export const updateGanttUploadTime = async (
  spreadsheetId: string,
  contentName: string,
  date: string,
  uploadTime: string
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:F`,
  });

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row, i) => {
    if (i === 0) return false;
    return (row[1] || "").toString().trim() === date &&
           (row[5] || "").toString().trim() === contentName;
  });

  if (rowIndex === -1) {
    console.log(`[Gantt] Could not find row for ${contentName} on ${date}`);
    return;
  }

  const cellAddress = `${SHEET_NAMES.monthlyGantt}!L${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellAddress,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[uploadTime]] },
  });

  console.log(`[Gantt] ✅ Updated upload time for "${contentName}" to ${uploadTime}`);
};
// Check if a date is already taken in the gantt
export const isGanttDateTaken = async (
  spreadsheetId: string,
  date: string // format: dd/mm/yyyy
): Promise<{ taken: boolean; existingName: string; existingContentId: string }> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:F`,
  });

  const rows = response.data.values || [];
  const match = rows.slice(1).find((row) => (row[1] || "").toString().trim() === date);

  return {
    taken: !!match,
    existingName: match ? (match[5] || "").toString().trim() : "",
    existingContentId: match ? (match[0] || "").toString().trim() : "",
  };
};

// Find available dates in the same month that have no gantt entry
export const findAvailableDatesInMonth = async (
  spreadsheetId: string,
  date: string // format: dd/mm/yyyy
): Promise<string[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const parts = date.split("/");
  const month = parseInt(parts[1]) - 1;
  const year = parseInt(parts[2]);
  const requestedDay = parseInt(parts[0]);

  // Get all taken dates in gantt
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!B:B`,
  });

  const rows = response.data.values || [];
  const takenDates = new Set(rows.slice(1).map((row) => (row[0] || "").toString().trim()));

  // Find all days in the month that are not taken
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const available: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`;
    if (!takenDates.has(dateStr)) {
      available.push(dateStr);
    }
  }

  // Sort by proximity to requested date
  available.sort((a, b) => {
    const dayA = Math.abs(parseInt(a.split("/")[0]) - requestedDay);
    const dayB = Math.abs(parseInt(b.split("/")[0]) - requestedDay);
    return dayA - dayB;
  });

  return available;
};

// Update a gantt row's date and day
export const updateGanttRowDate = async (
  spreadsheetId: string,
  contentId: string,
  newDate: string,
  newDayName: string
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:A`,
  });

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row, i) => i > 0 && (row[0] || "").toString().trim() === contentId);
  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${SHEET_NAMES.monthlyGantt}!B${sheetRow}`, values: [[newDate]] },
        { range: `${SHEET_NAMES.monthlyGantt}!C${sheetRow}`, values: [[newDayName]] },
      ],
    },
  });

  console.log(`[Gantt] ✅ Updated date for ${contentId} to ${newDate} (${newDayName})`);
};
// Get approved content that has no gantt entry
export const getApprovedContentNotInGantt = async (
  spreadsheetId: string,
  _month: number, // kept for the existing API
  _year: number
): Promise<{ contentId: string; name: string; contentType: string }[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // A content_id may appear only once in the gantt, regardless of month.
  const ganttResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:A`,
  });
  const ganttRows = ganttResponse.data.values || [];
  const ganttContentIds = new Set(
    ganttRows.slice(1)
      .map((row) => (row[0] || "").toString().trim())
      .filter(Boolean)
  );

  // Get all approved content
  const approvedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:K`,
  });
  const approvedRows = approvedResponse.data.values || [];

  return approvedRows.slice(1)
    .filter((row) => {
      const contentId = (row[0] || "").toString().trim();
      return contentId && !ganttContentIds.has(contentId);
    })
    .map((row) => ({
      contentId: (row[0] || "").toString().trim(),
      name: (row[1] || "").toString().trim(),
      contentType: (row[10] || "ריל").toString().trim(),
    }));
};
// Fast Track — save directly to תכנים שאושרו with all fields ready
export const saveFastTrackContent = async (
  spreadsheetId: string,
  contentId: string,
  shortName: string,
  summary: string,
  category: string,
  tone: string,
  priority: string,
  contentType: string = "ריל"
): Promise<void> => {
  const timestamp = new Date().toISOString();

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.approvedContent, [
    contentId,
    shortName,
    summary,
    category,
    tone,
    priority,
    "מוכן לעלייה",
    "",
    "",
    timestamp,
    contentType || "ריל",
  ]);

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
  contentId,
  shortName,
  "כן",
  "כן",
  "כן",
  "",
  "",
  timestamp,
  timestamp,
]);
};
