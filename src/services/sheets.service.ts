import { google, sheets_v4 } from "googleapis";
import { normalizeHebrewText, getTokenOverlapScore } from "./production-status.service";
import { parseDateFromSheet, getHebrewDayName } from "../utils/date-utils";

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
    // Use sheet name only (without cell reference) to ensure append works correctly across all columns
    // This prevents the append from updating a partially-filled last row
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetName,
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

// Get all existing Content IDs from בנק רעיונות
export const getExistingContentIds = async (spreadsheetId: string): Promise<string[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:A`,
  });

  const values = response.data.values || [];
  // Skip header row, filter out empty cells
  return values.slice(1).map((row) => row[0]).filter(Boolean);
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
  const normalizedSearch = normalizeHebrewText(categoryName);
  return (
    categories.find(
      (entry) => normalizeHebrewText(entry.categoryName) === normalizedSearch
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
  const normalizedName = normalizeHebrewText(categoryName);
  const categories = await getCategories(spreadsheetId);
  const existing = categories.find(
    (entry) => normalizeHebrewText(entry.categoryName) === normalizedName
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
  category: string,
  tone: string,
  priority: string
): Promise<void> => {
  console.log(`[Sprint 6] Step 1: Saving content idea to בנק רעיונות`);
  console.log(`[Sprint 6] Content_ID: ${contentId}`);
  
  const contentRow = [
    contentId,           // Content_ID
    idea,                // רעיון
    category,            // קטגוריה
    tone,                // טון רגשי
    "",                  // הוק / פתיח (empty for now)
    "",                  // מתאים ל... (empty for now)
    "לא",                // דורש יום צילום? (default "לא")
    priority,            // רמת עדיפות
    "רעיון",             // סטטוס (default "רעיון")
    "",                  // שת״פ / חסות (empty for now)
    "",                  // הערות
  ];

  console.log(`[Sprint 6] saveContentIdea -> target="${SHEET_NAMES.contentLibrary}", content_id=${contentId}`);
  console.log(`[Sprint 6] saveContentIdea -> rowPayload=${JSON.stringify(contentRow)}`);

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.contentLibrary, contentRow);
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
  
  const taskRow = [
    contentId,           // content_id
    contentName,         // שם התוכן
    "לא",                // צריך טקסט? (default "לא")
    "לא",                // צולם (default "לא")
    "לא",                // נערך (default "לא")
    "לא",                // קאבר מוכן (default "לא")
    "לא",                // קופי מוכן (default "לא")
    "לא",                // הועלה (default "לא")
    "",                  // דדליין (empty for now)
    "",                  // שעת העלאה (empty for now)
    "",                  // הערות
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
      range: `${SHEET_NAMES.productionTasks}!A:K`, // Get content_id and content name columns
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
        if (normalizedTaskName.includes(normalizedSearchName) || normalizedSearchName.includes(normalizedTaskName)) {
          console.log(`[Sprint 7] ✓ Includes match at row ${sheetRowNumber}`);
          includesMatches.push({ rowIndex: sheetRowNumber, row });
          continue;
        }

        // Try includes match with punctuation-normalized text
        if (punctuationNormalizedTask.includes(punctuationNormalizedSearch) || punctuationNormalizedSearch.includes(punctuationNormalizedTask)) {
          console.log(`[Sprint 7] ✓ Includes punctuation-normalized match at row ${sheetRowNumber}`);
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

        const candidateList = candidates.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
        const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
            max_tokens: 50,
            messages: [
              {
                role: "user",
                content: `המשתמש חיפש: "${contentName}"
הנה רשימת המשימות המועמדות:
${candidateList}

החזר רק את המספר של המשימה שהכי מתאימה לחיפוש, או "0" אם אין התאמה סבירה. רק מספר, בלי הסבר.`,
              },
            ],
          }),
        });

        const data = await claudeResponse.json() as any;
        const resultText = (data.content?.[0]?.text || "0").trim();
        const index = parseInt(resultText) - 1;

        if (index >= 0 && index < candidates.length) {
          console.log(`[Claude Matching] "${contentName}" → "${candidates[index].name}" (row ${candidates[index].rowIndex})`);
          // If search term appears in the matched name — Claude is confident
          const confident = candidates[index].name.toLowerCase().includes(contentName.toLowerCase()) ||
                            contentName.toLowerCase().split(/\s+/).every((word) => candidates[index].name.toLowerCase().includes(word));
          return { rowIndex: candidates[index].rowIndex, row: candidates[index].row };
        }
      } catch (claudeError) {
        console.error(`[Claude Matching] Error: ${claudeError}. Falling back to token overlap.`);
        // Continue to token overlap fallback below
      }

      // Token overlap fallback if Claude fails
      const highestScore = Math.max(...scoredMatches.map((match) => match.score));
      const bestMatches = scoredMatches.filter((match) => match.score === highestScore);

      if (highestScore < 1) {
        console.log(`[Sprint 8] Highest score ${highestScore} below threshold; no match`);
        return null;
      }

      if (bestMatches.length === 1) {
        console.log(`[Sprint 8] Best token match at row ${bestMatches[0].rowIndex} with score ${highestScore}`);
        return bestMatches[0];
      }

      console.log(`[Sprint 8] Multiple best token matches found with score ${highestScore}`);
      return { ambiguous: true, matches: bestMatches };
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
  rowIndex: number, // 1-indexed row number from the sheet
  columnIndex: number // 1-indexed column number (1=A, 2=B, etc.)
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  try {
    const statusColumns = [3, 4, 5]; // C-E are the only allowed status columns
    if (!statusColumns.includes(columnIndex)) {
      throw new Error(`Invalid status column index ${columnIndex}. May only update C-E.`);
    }
    // Convert column index to letter (1->A, 2->B, etc.)
    const columnLetter = String.fromCharCode(64 + columnIndex);
    const cellAddress = `${columnLetter}${rowIndex}`;
    const range = `${SHEET_NAMES.productionTasks}!${cellAddress}`;

    console.log(`[Sprint 7] Updating exact cell range: ${range} to "כן"`);
    console.log(`[Sprint 7] Row mapping: requested rowIndex=${rowIndex}, columnIndex=${columnIndex}, address=${cellAddress}`);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["כן"]],
      },
    });

    console.log(`[Sprint 7] ✅ Successfully updated ${cellAddress} to "כן"`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Sprint 7] Failed to update production status: ${errorMessage}`);
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
};

// Get all production tasks from משימות הפקה
export const getAllProductionTasks = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.productionTasks}!A:K`,
  });

  const values = response.data.values || [];
  // Skip header row (row 1)
  return values.slice(1).map((row) => ({
    contentId: row[0] || "",
    taskName: row[1] || "",
    needsText: row[2] || "לא",
    filmed: row[3] || "לא",
    edited: row[4] || "לא",
    coverReady: row[5] || "לא",
    copyReady: row[6] || "לא",
    uploaded: row[7] || "לא",
    deadline: row[8] || "",
    uploadTime: row[9] || "",
    notes: row[10] || "",
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
  // Sprint 10 fix: return all tasks that are not marked as edited (no longer require filmed === "כן")
  return tasks.filter((task) => task.edited !== "כן");
};

// Get tasks missing cover: cover ready != כן
export const getTasksMissingCover = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.coverReady !== "כן");
};

// Get tasks missing copy: copy ready != כן
export const getTasksMissingCopy = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.copyReady !== "כן");
};

// Get tasks not uploaded: uploaded != כן
export const getTasksNotUploaded = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.uploaded !== "כן");
};

export const getTasksEditedAndNotUploaded = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => task.edited === "כן" && task.uploaded !== "כן");
};

// Get stuck tasks: deterministic patterns
// Pattern 1: filmed but not edited
// Pattern 2: edited but not uploaded
// Pattern 3: not filmed and not edited (idle)
export const getStuckTasks = async (spreadsheetId: string): Promise<ProductionTaskRow[]> => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  return tasks.filter((task) => {
    // Filmed but not edited
    if (task.filmed === "כן" && task.edited !== "כן") {
      return true;
    }
    // Edited but not uploaded
    if (task.edited === "כן" && task.uploaded !== "כן") {
      return true;
    }
    // Cover/copy missing in later stages
    if (task.filmed === "כן" && (task.coverReady !== "כן" || task.copyReady !== "כן")) {
      return true;
    }
    return false;
  });
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
    const candidateList = candidates.map((c, i) => `${i + 1}. ${c.idea}`).join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: `המשתמש מחפש: "${searchName}"
הנה רשימת הרעיונות:
${candidateList}

החזר רק את המספר של הרעיון שהכי מתאים לחיפוש, או "0" אם אין התאמה. רק מספר, בלי הסבר.`,
          },
        ],
      }),
    });

    const data = await response.json() as any;
    const resultText = (data.content?.[0]?.text || "0").trim();
    const index = parseInt(resultText) - 1;

    if (index >= 0 && index < candidates.length) {
      const ideaText = candidates[index].idea;
      const shortName = ideaText.split(/\s+/).slice(0, 6).join(" ");
      console.log(`[Claude Summary] "${searchName}" → "${shortName}"`);
      return { shortName, idea: ideaText };
    }
  } catch (error) {
    console.error(`[Claude Summary] Error: ${error}`);
    // Fallback to token overlap
    const normalized = searchName.trim().toLowerCase();
    const scored = values.slice(1)
      .map((row) => {
        const idea = (row[1] || "").toString();
        const score = getTokenOverlapScore(normalized, idea.toLowerCase());
        return { row, score };
      })
      .filter((entry) => entry.score >= 2)
      .sort((a, b) => b.score - a.score);
    const match = scored.length > 0 ? scored[0].row : null;
    if (!match) return null;
    const ideaText = (match[1] || "").toString();
    return { shortName: ideaText.split(/\s+/).slice(0, 6).join(" "), idea: ideaText };
  }

  return null;
};
// Get all content ideas from בנק רעיונות with priority
export const getContentIdeasWithPriority = async (spreadsheetId: string): Promise<Map<string, { priority: string; category: string }>> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:H`,
  });

  const values = response.data.values || [];
  const map = new Map<string, { priority: string; category: string }>();

  values.slice(1).forEach((row) => {
    const contentId = row[0] || "";
    const category = row[2] || "";
    const priority = row[7] || "בינוני";
    if (contentId) {
      map.set(contentId, { priority, category });
    }
  });

  return map;
};

// Extended task row with priority and category from בנק רעיונות
export type ProductionTaskRowExtended = ProductionTaskRow & {
  priority: string;
  category: string;
  isTrend: boolean;
  deadlineDate: Date | null;
  deadlineDayName: string;
};

// Get all production tasks with priority from בנק רעיונות
export const getAllProductionTasksWithPriority = async (spreadsheetId: string): Promise<ProductionTaskRowExtended[]> => {
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
      case "copy":     return task.copyReady !== "כן";
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

  const range = `${SHEET_NAMES.productionTasks}!I${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[deadline]],
    },
  });

  console.log(`[Deadline] ✅ Updated deadline for row ${rowIndex} to: ${deadline}`);
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
    const candidateList = candidates.map((c, i) => `${i + 1}. ${c.idea}`).join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: `רעיון חדש: "${ideaText}"
הנה רעיונות קיימים:
${candidateList}

האם יש רעיון קיים שדומה מאוד לרעיון החדש (אותו נושא, אותו קונספט)? החזר רק את המספר של הרעיון הדומה, או "0" אם אין רעיון דומה. רק מספר, בלי הסבר.`,
          },
        ],
      }),
    });

    const data = await response.json() as any;
    const resultText = (data.content?.[0]?.text || "0").trim();
    const index = parseInt(resultText) - 1;

    if (index >= 0 && index < candidates.length) {
      console.log(`[Claude Duplicate] "${ideaText}" → "${candidates[index].idea}"`);
      return { contentId: candidates[index].contentId, idea: candidates[index].idea };
    }
  } catch (error) {
    console.error(`[Claude Duplicate] Error: ${error}`);
    // Fallback to token overlap
    let bestMatch: { contentId: string; idea: string; score: number } | null = null;
    for (const row of values.slice(1)) {
      const idea = (row[1] || "").toString();
      const score = getTokenOverlapScore(normalized, normalizeHebrewText(idea).toLowerCase());
      if (score >= 2 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { contentId: (row[0] || "").toString(), idea, score };
      }
    }
    return bestMatch ? { contentId: bestMatch.contentId, idea: bestMatch.idea } : null;
  }

  return null;
};
// Archive content idea - move from בנק רעיונות to רעיונות בצד and delete from source
export const archiveContentIdea = async (
  spreadsheetId: string,
  contentName: string
): Promise<{ success: boolean; archivedName: string } | null> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Find the row in בנק רעיונות
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:K`,
  });

  const values = response.data.values || [];
  const normalized = normalizeHebrewText(contentName).toLowerCase();

  let matchIndex = -1;
  let matchRow: string[] = [];

  for (let i = 1; i < values.length; i++) {
    const idea = (values[i][1] || "").toString();
    const score = getTokenOverlapScore(normalized, normalizeHebrewText(idea).toLowerCase());
    if (score >= 1) {
      matchIndex = i + 1; // 1-indexed sheet row
      matchRow = values[i];
      break;
    }
  }

  if (matchIndex === -1) return null;

  // Add to רעיונות בצד with archive timestamp
  const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
 // Pad matchRow to exactly 11 columns before adding timestamp to column L
  const paddedRow = Array.from({ length: 11 }, (_, i) => matchRow[i] || "");
  const archiveRow = [...paddedRow, israelTime];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAMES.archive}!A:L`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [archiveRow] },
  });

  // Delete from בנק רעיונות
  const sheetMeta = await getSpreadsheetMetadata(spreadsheetId);
  const sourceSheet = sheetMeta.sheets?.find((s) => s.title === SHEET_NAMES.contentLibrary);
  if (!sourceSheet?.sheetId) throw new Error("Could not find בנק רעיונות sheet ID");

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
// Delete from משימות הפקה by content_id
  const contentId = (matchRow[0] || "").toString();
  if (contentId) {
    const tasksResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAMES.productionTasks}!A:A`,
    });
    const taskRows = tasksResponse.data.values || [];
    const taskRowIndex = taskRows.findIndex((row, i) => i > 0 && row[0] === contentId);
    if (taskRowIndex > 0) {
      const taskSheetMeta = await getSpreadsheetMetadata(spreadsheetId);
      const taskSheet = taskSheetMeta.sheets?.find((s) => s.title === SHEET_NAMES.productionTasks);
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
  }

  return { success: true, archivedName: (matchRow[1] || contentName).toString() };
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
  await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
    contentId, contentShortName, "לא", "לא", "לא", "לא", "לא", "לא", "", "", "",
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
): Promise<{ success: boolean; name: string }> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // 1. מצא את הרעיון בבנק רעיונות
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A:M`,
  });

  const rows = response.data.values || [];
 const normalizedSearch = normalizeHebrewText(contentId).toLowerCase();
  const rowIndex = rows.findIndex((row, i) => {
    if (i === 0) return false;
    const rowName = normalizeHebrewText((row[1] || "").toString().trim()).toLowerCase();
    const rowId = (row[0] || "").toString().trim();
    const score = getTokenOverlapScore(normalizedSearch, rowName);
    return rowId === contentId || rowName.includes(normalizedSearch) || normalizedSearch.includes(rowName) || score >= 2;
  });
  if (rowIndex === -1) throw new Error(`לא נמצא רעיון עם ID: ${contentId}`);

  const row = rows[rowIndex];
  const actualContentId = (row[0] || "").toString().trim();
  const name = (row[1] || "").toString().trim();
  const summary = (row[2] || "").toString().trim();
  const category = (row[3] || "").toString().trim();
  const tone = (row[4] || "").toString().trim();
  const priority = (row[8] || "").toString().trim();
  const collab = (row[10] || "").toString().trim();
  const notes = (row[11] || "").toString().trim();
  const timestamp = new Date().toISOString();

  // 2. הוסף לתכנים שאושרו
await appendRowToSheet(spreadsheetId, SHEET_NAMES.approvedContent, [
    actualContentId, name, summary, category, tone, priority,
    "ממתין לצילום", collab, notes, timestamp,
  ]);

  // 3. פתח שורה במשימות הפקה
await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
    actualContentId, name, "לא", "לא", "לא", "", "",
  ]);

  // 4. מחק מבנק רעיונות
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_NAMES.contentLibrary}!A${rowIndex + 1}:M${rowIndex + 1}`,
  });

  return { success: true, name };
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
): Promise<void> => {
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
    return;
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
  // כתוב טיימסטמפ בעמודה M (עמודה 13)
  const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  const timestampRange = `גאנט תוכן!N${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: timestampRange,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[israelTime]] },
  });
console.log(`[Gantt] ✅ Wrote publish timestamp to N${rowIndex + 1}: ${israelTime}`);};
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
    const candidateList = candidates.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: `המשתמש חיפש: "${contentName}"
הנה רשימת התכנים הקיימים:
${candidateList}

החזר רק את המספר של התוכן שהכי מתאים לחיפוש, או "0" אם אין התאמה סבירה. רק מספר, בלי הסבר.`,
          },
        ],
      }),
    });

    const data = await response.json() as any;
    const resultText = (data.content?.[0]?.text || "0").trim();
    const index = parseInt(resultText) - 1;

  if (index >= 0 && index < candidates.length) {
      console.log(`[Claude Matching] "${contentName}" → "${candidates[index].name}"`);
      // אם השם המחופש מופיע בשם המלא — Claude בטוח
      const confident = candidates[index].name.toLowerCase().includes(contentName.toLowerCase()) ||
                        contentName.toLowerCase().split(/\s+/).every((word) => candidates[index].name.toLowerCase().includes(word));
      return { contentId: candidates[index].contentId, name: candidates[index].name, exact: confident };
    }
  } catch (error) {
    console.error(`[Claude Matching] Error: ${error}`);
    // Fallback to token overlap if Claude fails
    let best: { contentId: string; name: string; score: number } | null = null;
    for (const row of rows.slice(1)) {
      const name = (row[1] || "").toString();
      const score = getTokenOverlapScore(normalized, normalizeHebrewText(name).toLowerCase());
      if (score >= 1 && (!best || score > best.score)) {
        best = { contentId: row[0].toString(), name, score };
      }
    }
    return best ? { contentId: best.contentId, name: best.name, exact: false } : null;
  }

  return null;
};

// Write a new row to גאנט תוכן
export const addRowToGantt = async (
  spreadsheetId: string,
  contentId: string,
  contentName: string,
  date: string,
  dayName: string,
  uploadTime: string = ""
): Promise<void> => {
  // Pull priority and collab from תכנים שאושרו
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const approvedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:J`,
  });
  const approvedRows = approvedResponse.data.values || [];
  const approvedRow = approvedRows.slice(1).find((row) => (row[0] || "").toString().trim() === contentId);
  const priority = approvedRow ? (approvedRow[5] || "").toString().trim() : "";
  const collab = approvedRow ? (approvedRow[7] || "").toString().trim() : "";

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.monthlyGantt, [
    contentId,       // A - content_id
    date,            // B - תאריך
    dayName,         // C - יום
    "אינסטגרם",      // D - פלטפורמה
    "ריל",           // E - סוג תוכן
    contentName,     // F - שם התוכן/קונספט
    "",              // G - נושא/פרק
    priority,        // H - רמת עדיפות
    "",              // I - סטוריז תומכים
    collab || "לא",  // J - שת"פ/חסות
    "בתכנון",        // K - סטטוס
    uploadTime,      // L - שעת העלאה
    "",              // M - הערות
  ]);
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
  month: number, // 1-12
  year: number
): Promise<{ contentId: string; name: string }[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Get all content IDs in gantt for this month
  const ganttResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.monthlyGantt}!A:B`,
  });
  const ganttRows = ganttResponse.data.values || [];
  const ganttContentIds = new Set(
    ganttRows.slice(1)
      .filter((row) => {
        const dateStr = (row[1] || "").toString().trim();
        const parts = dateStr.split("/");
        if (parts.length !== 3) return false;
        return parseInt(parts[1]) === month && parseInt(parts[2]) === year;
      })
      .map((row) => (row[0] || "").toString().trim())
      .filter(Boolean)
  );

  // Get all approved content
  const approvedResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAMES.approvedContent}!A:B`,
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
  priority: string
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
  ]);

  await appendRowToSheet(spreadsheetId, SHEET_NAMES.productionTasks, [
    contentId,
    shortName,
    "כן",
    "כן",
    "כן",
    "",
    "",
  ]);
};