import "dotenv/config";

const requireMigrationOptIn = () => {
  if (process.env.ALLOW_PRODUCTION_TIMESTAMPS_MIGRATION !== "true") {
    console.error(
      [
        "❌ This is a real production timestamp migration.",
        "It writes to the real Google Sheet.",
        "",
        "Run the preview first:",
        "ALLOW_LIVE_QA=true npx ts-node src/test/production-timestamps-migration-preview.ts",
        "",
        "Then run explicitly with:",
        `ALLOW_PRODUCTION_TIMESTAMPS_MIGRATION=true npx ts-node ${__filename.replace(process.cwd() + "/", "")}`,
      ].join("\\n")
    );
    process.exit(1);
  }
};

import { google } from "googleapis";

const SHEET_NAME = "משימות הפקה";

const run = async (): Promise<void> => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!spreadsheetId || !email || !privateKey) {
    throw new Error("Missing Google Sheets environment variables");
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:I`,
  });

  const rows = response.data.values || [];
  const timestamp = new Date().toISOString();

  const updates: Array<{
    range: string;
    values: string[][];
  }> = [];

  const expectedReadyRows: number[] = [];
  const expectedUpdatedRows: number[] = [];

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const sheetRow = index + 1;

    const contentId = (row[0] || "").toString().trim();
    const edited = (row[3] || "").toString().trim();
    const readyAt = (row[7] || "").toString().trim();
    const updatedAt = (row[8] || "").toString().trim();

    if (!contentId || contentId.startsWith("test_name_")) {
      continue;
    }

    if (edited === "כן" && !readyAt) {
      updates.push({
        range: `'${SHEET_NAME}'!H${sheetRow}`,
        values: [[timestamp]],
      });

      expectedReadyRows.push(sheetRow);
    }

    if (!updatedAt) {
      updates.push({
        range: `'${SHEET_NAME}'!I${sheetRow}`,
        values: [[timestamp]],
      });

      expectedUpdatedRows.push(sheetRow);
    }
  }

  console.log(`ready_at ייכתב ב-${expectedReadyRows.length} שורות.`);
  console.log(`updated_at ייכתב ב-${expectedUpdatedRows.length} שורות.`);

  if (updates.length === 0) {
    console.log("אין שורות לעדכון. ייתכן שה-migration כבר בוצע.");
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates,
    },
  });

  const verification = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:I`,
  });

  const verifiedRows = verification.data.values || [];

  for (const sheetRow of expectedReadyRows) {
    const value = verifiedRows[sheetRow - 1]?.[7]?.toString().trim();

    if (value !== timestamp) {
      throw new Error(`ready_at verification failed at row ${sheetRow}`);
    }
  }

  for (const sheetRow of expectedUpdatedRows) {
    const value = verifiedRows[sheetRow - 1]?.[8]?.toString().trim();

    if (value !== timestamp) {
      throw new Error(`updated_at verification failed at row ${sheetRow}`);
    }
  }

  console.log("Migration completed and verified.");
  console.log(`Baseline timestamp: ${timestamp}`);
};

requireMigrationOptIn();

run().catch((error) => {
  console.error(error);
  process.exit(1);
});