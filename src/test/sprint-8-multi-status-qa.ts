import dotenv from "dotenv";
import { detectStatusUpdate, getColumnName, normalizeHebrewText } from "../services/production-status.service";
import {
  findProductionTaskByName,
  updateProductionStatus,
  getProductionStatusColumnIndex,
} from "../services/sheets.service";
import type { ProductionTaskMatch } from "../services/sheets.service";

dotenv.config();

const requireLiveQaOptIn = () => {
  if (process.env.ALLOW_LIVE_QA !== "true") {
    console.error(
      [
        "❌ This is a Live QA script.",
        "It can write to the real Google Sheet.",
        "",
        "Run explicitly with:",
        `ALLOW_LIVE_QA=true npx ts-node ${__filename.replace(process.cwd() + "/", "")}`,
      ].join("\\n")
    );
    process.exit(1);
  }
};


const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) {
  throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
}

type MultiStatusTest = {
  description: string;
  message: string;
  expectedStatusTypes: string[];
  expectedContentName: string;
  expectedMatchedTaskName?: string;
  allowAmbiguous?: boolean;
};

const TESTS: MultiStatusTest[] = [
  {
    description: "Filmed and edited in one message",
    message: "צילמתי וערכתי קונספט טעימות חדש לחתונה",
    expectedStatusTypes: ["filmed", "edited"],
    expectedContentName: "קונספט טעימות חדש לחתונה",
    allowAmbiguous: true,
  },
  {
    description: "Filmed, edited and uploaded in one message (cascades to include cover)",
    message: "צילמתי, ערכתי והעליתי את הסרטון על השמלה השלישית",
    expectedStatusTypes: ["filmed", "edited", "cover_ready", "uploaded"],
    expectedContentName: "שמלה שלישית",
  },
  {
    description: "Cover and copy ready in one message",
    message: "הקאבר והקופי מוכנים לקפריסין",
    expectedStatusTypes: ["cover_ready"],
    expectedContentName: "קפריסין",
    allowAmbiguous: true,
  },
];

const runMultiStatusTest = async (test: MultiStatusTest) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Test: ${test.description}`);
  console.log(`Message: ${test.message}\n`);

  const statusUpdate = detectStatusUpdate(test.message);
  if (!statusUpdate) {
    console.error(`❌ Detection failed for message: ${test.message}`);
    return { passed: false, reason: "No status update detected." };
  }

  console.log(`Detected statuses: ${statusUpdate.statusTypes.join(", ")}`);
  console.log(`Extracted content name: "${statusUpdate.contentName}"`);

  const missingTypes = test.expectedStatusTypes.filter(
    (expected) => !statusUpdate.statusTypes.includes(expected as any)
  );
  if (missingTypes.length > 0) {
    console.error(`❌ Expected status types ${test.expectedStatusTypes.join(", ")} but got ${statusUpdate.statusTypes.join(", ")}`);
    return { passed: false, reason: "Missing detected status types." };
  }

  const normalizedExpected = normalizeHebrewText(test.expectedContentName);
  const normalizedExtracted = normalizeHebrewText(statusUpdate.contentName);
  if (normalizedExtracted !== normalizedExpected) {
    console.error(`❌ Expected normalized content name '${normalizedExpected}' but extracted '${normalizedExtracted}'`);
    return { passed: false, reason: "Wrong extracted content name." };
  }

  const matchResult = await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);
  if (!matchResult) {
    if (test.allowAmbiguous) {
      console.log(`✅ No unique match found and ambiguity is allowed for this test.`);
      return { passed: true };
    }

    console.error(`❌ Expected a production task match for content name: ${statusUpdate.contentName}`);
    return { passed: false, reason: "No production task match." };
  }

  if ("ambiguous" in matchResult && matchResult.ambiguous) {
    if (test.allowAmbiguous) {
      console.log(`✅ Ambiguous match detected for content name: ${statusUpdate.contentName}`);
      console.log("No sheet update was performed for ambiguous result.");
      return { passed: true };
    }

    console.error(`❌ Expected a unique match but got ambiguous result for content name: ${statusUpdate.contentName}`);
    return { passed: false, reason: "Ambiguous production task match." };
  }

  const exactMatch = matchResult as ProductionTaskMatch;
  if (test.expectedMatchedTaskName && exactMatch.row[1] !== test.expectedMatchedTaskName) {
    console.error(`❌ Expected matched task '${test.expectedMatchedTaskName}' but got '${exactMatch.row[1]}'`);
    return { passed: false, reason: "Wrong matched task name." };
  }

  if (test.allowAmbiguous) {
    console.log(`✅ Unique best match found for ${statusUpdate.contentName}: ${exactMatch.row[1]}`);
    console.log("This test allows ambiguity, so unique selection is acceptable.");
    return { passed: true };
  }

  for (const statusType of statusUpdate.statusTypes) {
    const columnName = getColumnName(statusType);

    if (columnName === "פורסם") {
      console.log(`Skipping ${columnName}: not a משימות הפקה column.`);
      continue;
    }

    const columnIndex = getProductionStatusColumnIndex(columnName);
    if (!columnIndex) {
      console.error(`❌ Invalid column mapping for ${columnName}`);
      return { passed: false, reason: "Invalid column mapping." };
    }

    console.log(`Updating column ${columnName} (index ${columnIndex}) to "כן"...`);
    await updateProductionStatus(spreadsheetId, exactMatch.rowIndex, columnIndex);
  }

  console.log(`✅ Updated row ${exactMatch.rowIndex} columns ${statusUpdate.statusTypes.map((statusType) => getColumnName(statusType)).join(", ")} successfully`);
  return { passed: true };
};

const main = async () => {
  console.log("Sprint 8 Multi-status QA");
  const results: Array<{ test: { description: string }; passed: boolean; reason?: string }> = [];

  for (const test of TESTS) {
    try {
      const result = await runMultiStatusTest(test);
      results.push({ test: { description: test.description }, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Test failed unexpectedly: ${message}`);
      results.push({ test: { description: test.description }, passed: false, reason: message });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Sprint 8 Multi-status QA Results");
  console.log("=".repeat(60));

  for (const result of results) {
    console.log(`- ${result.test.description}: ${result.passed ? "PASS" : "FAIL"}${result.reason ? ` (${result.reason})` : ""}`);
  }

  const allPassed = results.every((result) => result.passed);
  console.log("\n" + (allPassed ? "✅ All Multi-status QA tests passed." : "❌ Some Multi-status QA tests failed."));

  if (!allPassed) {
    process.exit(1);
  }
};

requireLiveQaOptIn();

main();
