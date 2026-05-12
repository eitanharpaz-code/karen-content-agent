import { google, sheets_v4 } from "googleapis";
import { normalizeHebrewText } from "./production-status.service";

// Sheet name mapping: English reference names to actual Hebrew sheet names
const SHEET_NAMES = {
  contentLibrary: "בנק רעיונות",
  productionTasks: "משימות הפקה",
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

export const appendRowToSheet = async (
  spreadsheetId: string,
  sheetName: string,
  values: Array<string | number | null>
): Promise<void> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  console.log(`[Sheets] Writing to sheet: "${sheetName}"`);
  console.log(`[Sheets] Row payload: ${JSON.stringify(values)}`);
  
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
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

// Map Hebrew categories to category prefixes
const CATEGORY_PREFIX_MAP: Record<string, string> = {
  "קפריסין": "CYP",
  "שמלות": "DRS",
  "רווקות": "BCH",
  "רווקים": "BCH",
  "על החתונה": "PRW",
  "חתונה": "WED",
  "כללי": "GEN",
};

// Generate next Content ID based on category (e.g., CYP-006, WED-001, etc.)
// category: Hebrew category name
// existingIds: array of existing IDs from the sheet
export const generateContentId = (category: string, existingIds: string[]): string => {
  const prefix = CATEGORY_PREFIX_MAP[category] || "GEN";
  
  // Filter IDs that match this category's prefix
  const categoryIds = existingIds.filter((id) => id.startsWith(prefix + "-"));
  
  // Find the maximum number
  let maxNum = 0;
  categoryIds.forEach((id) => {
    const match = id.match(/^[A-Z]+-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  });
  
  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
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
      range: `${SHEET_NAMES.productionTasks}!A:B`, // Get content_id and content name columns
    });

    const rows = response.data.values || [];
    
    // Normalize the incoming search term
    const normalizedSearchName = normalizeHebrewText(contentName);
    
    console.log(`[Sprint 7] Searching for content: "${contentName}"`);
    console.log(`[Sprint 7] Normalized search term: "${normalizedSearchName}"`);
    
    // Skip header row (row 0)
    const matches: Array<{ rowIndex: number; row: string[] }> = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sheetRowNumber = i + 1; // Google Sheets rows are 1-indexed, header occupies row 1
      if (row && row[1]) { // Check if content name column exists
        const sheetContentName = row[1].toString();
        const normalizedTaskName = normalizeHebrewText(sheetContentName);
        
        console.log(`[Sprint 7] Array index ${i} → Google Sheets row ${sheetRowNumber}: "${sheetContentName}" → normalized: "${normalizedTaskName}"`);
        
        // Deterministic includes matching on normalized text
        if (normalizedTaskName.includes(normalizedSearchName) || 
            normalizedSearchName.includes(normalizedTaskName) ||
            normalizedTaskName === normalizedSearchName) {
          console.log(`[Sprint 7] ✓ Match found at array index ${i} (Google Sheets row ${sheetRowNumber})`);
          matches.push({ rowIndex: sheetRowNumber, row: row });
        }
      }
    }

    if (matches.length === 1) {
      console.log(`[Sprint 7] Found exactly one match`);
      return matches[0];
    }

    if (matches.length > 1) {
      console.log(`[Sprint 7] Multiple matches found for content name: ${contentName}`);
      return { ambiguous: true, matches };
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

// Export sheet names for use in other modules
export { SHEET_NAMES };

