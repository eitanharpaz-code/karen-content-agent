import dotenv from "dotenv";
import { getSpreadsheetMetadata, appendRowToSheet } from "../services/sheets.service";

dotenv.config();

const main = async () => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    if (!spreadsheetId) {
      throw new Error("Missing GOOGLE_SHEETS_ID in environment variables.");
    }

    console.log("Testing Google Sheets API...\n");

    console.log("1. Reading spreadsheet metadata...");
    const metadata = await getSpreadsheetMetadata(spreadsheetId);
    console.log(`   Spreadsheet: ${metadata.title}`);
    console.log(`   Sheets found: ${metadata.sheets?.length}`);
    metadata.sheets?.forEach((sheet) => {
      console.log(`     - ${sheet.title}`);
    });

    console.log("\n2. Appending test row to בנק רעיונות (Content Library)...");
    const testRow = [
      "TEST-001",
      "Test Short Name",
      "Test Full Title",
      "Test Category",
      "Test Theme",
      "Test Tone",
      "Test Type",
      "Test Platforms",
      "Draft",
      "High",
      "No",
      "No",
      "No",
      "None",
      new Date().toISOString().split("T")[0],
      new Date().toISOString().split("T")[0],
      "This is a test row from Sprint 4 QA",
    ];

    await appendRowToSheet(spreadsheetId, "בנק רעיונות", testRow);
    console.log("   Row appended successfully!");

    console.log("\n3. Verifying metadata again...");
    const updatedMetadata = await getSpreadsheetMetadata(spreadsheetId);
    console.log(`   Spreadsheet still available: ${updatedMetadata.title}`);

    console.log("\nSprint 4 QA passed: Google Sheets integration working correctly.");
  } catch (error) {
    console.error("Error during Sheets test:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
