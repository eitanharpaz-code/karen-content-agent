import "dotenv/config";
import { google } from "googleapis";

type SheetRow = {
  sheet: "בנק רעיונות" | "תכנים שאושרו";
  rowNumber: number;
  contentId: string;
  name: string;
  currentContentType: string;
  inferredContentType: string | null;
  source: string;
};

const VALID_TYPES = new Set(["ריל", "פוסט", "סטורי"]);

const getAuthClient = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Missing Google service account credentials.");
  }

  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
};

const normalizeType = (value: string): string => value.toString().trim();

const isMissingOrSuspicious = (value: string): boolean => {
  const normalized = normalizeType(value);
  return !normalized || !VALID_TYPES.has(normalized);
};

const readRange = async (
  spreadsheetId: string,
  range: string
): Promise<any[][]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return response.data.values || [];
};

const buildGanttTypeMap = (rows: any[][]): Map<string, string> => {
  const map = new Map<string, string>();

  rows.slice(1).forEach((row) => {
    const contentId = (row[0] || "").toString().trim();
    const contentType = normalizeType(row[4] || "");

    if (contentId && VALID_TYPES.has(contentType) && !map.has(contentId)) {
      map.set(contentId, contentType);
    }
  });

  return map;
};

const collectCandidates = (
  sheet: "בנק רעיונות" | "תכנים שאושרו",
  rows: any[][],
  contentTypeIndex: number,
  ganttTypeByContentId: Map<string, string>
): SheetRow[] => {
  return rows.slice(1)
    .map((row, index) => {
      const contentId = (row[0] || "").toString().trim();
      const name = (row[1] || "").toString().trim();
      const currentContentType = normalizeType(row[contentTypeIndex] || "");

      return {
        sheet,
        rowNumber: index + 2,
        contentId,
        name,
        currentContentType,
        inferredContentType: contentId ? ganttTypeByContentId.get(contentId) || null : null,
        source: "גאנט תוכן לפי contentId",
      };
    })
    .filter((row) => row.contentId && isMissingOrSuspicious(row.currentContentType));
};

const main = async (): Promise<void> => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID");

  const [ideaRows, approvedRows, ganttRows] = await Promise.all([
    readRange(spreadsheetId, "בנק רעיונות!A:L"),
    readRange(spreadsheetId, "תכנים שאושרו!A:K"),
    readRange(spreadsheetId, "גאנט תוכן!A:E"),
  ]);

  const ganttTypeByContentId = buildGanttTypeMap(ganttRows);

  const candidates = [
    ...collectCandidates("בנק רעיונות", ideaRows, 11, ganttTypeByContentId),
    ...collectCandidates("תכנים שאושרו", approvedRows, 10, ganttTypeByContentId),
  ];

  const fillable = candidates.filter((row) => row.inferredContentType);
  const unresolved = candidates.filter((row) => !row.inferredContentType);

  console.log("=== CONTENT TYPE BACKFILL PREVIEW ===");
  console.log(`בנק רעיונות rows: ${Math.max(ideaRows.length - 1, 0)}`);
  console.log(`תכנים שאושרו rows: ${Math.max(approvedRows.length - 1, 0)}`);
  console.log(`גאנט rows: ${Math.max(ganttRows.length - 1, 0)}`);
  console.log(`Missing/suspicious content type rows: ${candidates.length}`);
  console.log(`Fillable from gantt by contentId: ${fillable.length}`);
  console.log(`Unresolved: ${unresolved.length}`);

  console.log("\n=== FILLABLE ===");
  console.dir(fillable.map((row) => ({
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    contentId: row.contentId,
    name: row.name,
    currentContentType: row.currentContentType || "(empty)",
    inferredContentType: row.inferredContentType,
  })), { depth: null });

  console.log("\n=== UNRESOLVED ===");
  console.dir(unresolved.map((row) => ({
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    contentId: row.contentId,
    name: row.name,
    currentContentType: row.currentContentType || "(empty)",
  })), { depth: null });

  console.log("\nNo writes were made.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
