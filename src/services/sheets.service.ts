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

    if (scoredMatches.length > 0) {
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
    const statusColumns = [4, 5, 6, 7, 8]; // D-H are the only allowed status columns
    if (!statusColumns.includes(columnIndex)) {
      throw new Error(`Invalid status column index ${columnIndex}. Sprint 7 may only update D-H.`);
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
    // Write actual upload timestamp to column L (index 12) when uploaded column is marked
    if (columnIndex === 8) {
      const israelTime = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
      const timestampRange = `${SHEET_NAMES.productionTasks}!L${rowIndex}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: timestampRange,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[israelTime]],
        },
      });
      console.log(`[Sprint 7] ✅ Wrote upload timestamp to L${rowIndex}: ${israelTime}`);
    }
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
    "צריך טקסט?": 3,
    "צולם": 4,
    "נערך": 5,
    "קאבר מוכן": 6,
    "קופי מוכן": 7,
    "הועלה": 8,
    "דדליין": 9,
    "שעת העלאה": 10,
    "הערות": 11,
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
  const shortName = ideaText.split(/\s+/).slice(0, 6).join(" ");
  return {
    shortName,
    idea: ideaText,
  };
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

  const normalizedCategory = normalizeHebrewText(category);

  const filtered = tasks.filter((task) => {
    const idea = ideasMap.get(task.contentId);
    if (!idea) return false;
    const taskCategory = normalizeHebrewText(idea.category);
    if (taskCategory !== normalizedCategory) return false;

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