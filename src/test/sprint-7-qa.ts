import dotenv from "dotenv";
import {
  detectStatusUpdate,
  getColumnName,
} from "../services/production-status.service";
import {
  findProductionTaskByName,
  updateProductionStatus,
  getProductionStatusColumnIndex,
} from "../services/sheets.service";
import type { ProductionTaskMatch } from "../services/sheets.service";

dotenv.config();

type Sprint7Test = {
  description: string;
  message: string;
  expectedStatusType: string;
};

type Sprint7EdgeCaseTest = {
  description: string;
  message: string;
  expectedStatusType: string;
  expectedOutcome: "ambiguous" | "no_match";
};

const TEST_CASES: Sprint7Test[] = [
  {
    description: "Filming status update",
    message: "צילמתי סרטון על השמלה השלישית",
    expectedStatusType: "filmed",
  },
  {
    description: "Editing status update",
    message: "סיימתי לערוך את הסרטון על השמלה השלישית",
    expectedStatusType: "edited",
  },
  {
    description: "Cover ready status update",
    message: "הקאבר מוכן עבור השמלה השלישית",
    expectedStatusType: "cover_ready",
  },
  {
    description: "Copy ready status update",
    message: "הקופי מוכן לשמלה השלישית",
    expectedStatusType: "copy_ready",
  },
  {
    description: "Uploaded status update",
    message: "העליתי את הסרטון על השמלה השלישית",
    expectedStatusType: "uploaded",
  },
];

const EDGE_CASE_TESTS: Sprint7EdgeCaseTest[] = [
  {
    description: "Multiple matches edge case",
    message: "צילמתי סרטון על חתונה",
    expectedStatusType: "filmed",
    expectedOutcome: "ambiguous",
  },
  {
    description: "No match edge case",
    message: "צילמתי סרטון על חד קרן מעופף",
    expectedStatusType: "filmed",
    expectedOutcome: "no_match",
  },
];

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

if (!spreadsheetId) {
  throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
}

const runTest = async (test: Sprint7Test) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Test: ${test.description}`);
  console.log(`Message: ${test.message}\n`);

  const statusUpdate = detectStatusUpdate(test.message);
  if (!statusUpdate) {
    console.error(`❌ Detection failed for message: ${test.message}`);
    return { passed: false, reason: "No status update detected." };
  }

  console.log(`Detected statusType: ${statusUpdate.statusType}`);
  console.log(`Extracted content name: "${statusUpdate.contentName}"`);

  if (statusUpdate.statusType !== test.expectedStatusType) {
    console.error(`❌ Expected statusType ${test.expectedStatusType} but got ${statusUpdate.statusType}`);
    return { passed: false, reason: "Wrong status type." };
  }

  const columnName = getColumnName(statusUpdate.statusType);
  const columnIndex = getProductionStatusColumnIndex(columnName);

  if (!columnIndex) {
    console.error(`❌ Invalid column mapping for ${columnName}`);
    return { passed: false, reason: "Invalid column mapping." };
  }

  const matchResult = await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);
  if (!matchResult) {
    console.error(`❌ Could not find a unique production task for content name: "${statusUpdate.contentName}"`);
    return { passed: false, reason: "No unique production task match." };
  }

  if ("ambiguous" in matchResult && matchResult.ambiguous) {
    console.error(`❌ Expected a unique match but got an ambiguous result for content name: "${statusUpdate.contentName}"`);
    return { passed: false, reason: "Ambiguous match result." };
  }

  const exactMatch = matchResult as ProductionTaskMatch;
  console.log(`Found production task on row ${exactMatch.rowIndex}: ${exactMatch.row[1]}`);
  console.log(`Updating column ${columnName} (index ${columnIndex}) to "כן"...`);

  await updateProductionStatus(spreadsheetId, exactMatch.rowIndex, columnIndex);

  console.log(`✅ Updated row ${exactMatch.rowIndex} column ${columnName} successfully`);

  return { passed: true };
};
const runEdgeCaseTest = async (test: Sprint7EdgeCaseTest) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Edge case: ${test.description}`);
  console.log(`Message: ${test.message}\n`);

  const statusUpdate = detectStatusUpdate(test.message);
  if (!statusUpdate) {
    console.error(`❌ Detection failed for message: ${test.message}`);
    return { passed: false, reason: "No status update detected." };
  }

  console.log(`Detected statusType: ${statusUpdate.statusType}`);
  console.log(`Extracted content name: "${statusUpdate.contentName}"`);

  if (statusUpdate.statusType !== test.expectedStatusType) {
    console.error(`❌ Expected statusType ${test.expectedStatusType} but got ${statusUpdate.statusType}`);
    return { passed: false, reason: "Wrong status type." };
  }

  const matchResult = await findProductionTaskByName(spreadsheetId, statusUpdate.contentName);
  if (test.expectedOutcome === "ambiguous") {
    if (!matchResult || !("ambiguous" in matchResult && matchResult.ambiguous)) {
      console.error(`❌ Expected ambiguous match result, but got ${matchResult ? JSON.stringify(matchResult) : "no match"}`);
      return { passed: false, reason: "Expected ambiguous match result." };
    }

    console.log(`✅ Ambiguous result detected with ${matchResult.matches.length} possible matches.`);
    console.log("No sheet update was performed for ambiguous edge case.");
    return { passed: true };
  }

  if (test.expectedOutcome === "no_match") {
    if (matchResult) {
      console.error(`❌ Expected no match, but got a result: ${JSON.stringify(matchResult)}`);
      return { passed: false, reason: "Expected no match." };
    }

    console.log("✅ No matching production task was found.");
    console.log("No sheet update was performed for no-match edge case.");
    return { passed: true };
  }

  return { passed: false, reason: "Unknown expected outcome." };
};
const main = async () => {
  console.log("Sprint 7 QA: Direct production status update validation");
  console.log("This script uses the Sprint 7 production status service and updates משימות הפקה directly.\n");

  const results = [] as Array<{ test: Sprint7Test; passed: boolean; reason?: string }>;

  for (const test of TEST_CASES) {
    try {
      const result = await runTest(test);
      results.push({ test, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Test failed unexpectedly: ${message}`);
      results.push({ test, passed: false, reason: message });
    }
  }

  for (const test of EDGE_CASE_TESTS) {
    try {
      const result = await runEdgeCaseTest(test);
      results.push({ test: { description: test.description, message: test.message, expectedStatusType: test.expectedStatusType }, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Edge case test failed unexpectedly: ${message}`);
      results.push({ test: { description: test.description, message: test.message, expectedStatusType: test.expectedStatusType }, passed: false, reason: message });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Sprint 7 QA Results");
  console.log("=".repeat(60));

  for (const result of results) {
    console.log(`- ${result.test.description}: ${result.passed ? "PASS" : "FAIL"}${result.reason ? ` (${result.reason})` : ""}`);
  }

  const allPassed = results.every((result) => result.passed);
  console.log("\n" + (allPassed ? "✅ All Sprint 7 tests passed." : "❌ Some Sprint 7 tests failed."));

  if (!allPassed) {
    process.exit(1);
  }
};

main();
