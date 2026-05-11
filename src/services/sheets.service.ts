import { google, sheets_v4 } from "googleapis";

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

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values],
    },
  });
};

// Export sheet names for use in other modules
export { SHEET_NAMES };

