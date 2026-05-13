import dotenv from "dotenv";
import {
  detectStatusUpdate,
  getColumnName,
  normalizeHebrewText,
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

type Sprint7MultiStatusTest = {
  description: string;
  message: string;
  expectedStatusTypes: string[];
  expectedContentName: string;
  expectedMatchedTaskName?: string;
  allowAmbiguous?: boolean;
};

type Sprint8MatchTest = {
  description: string;
  message: string;
  expectedStatusType: string;
  expectedContentName: string;
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

const MULTI_STATUS_TESTS: Sprint7MultiStatusTest[] = [
  {
    description: "Filmed and edited in one message",
    message: "צילמתי וערכתי קונספט טעימות חדש לחתונה",
    expectedStatusTypes: ["filmed", "edited"],
    expectedContentName: "קונספט טעימות חדש לחתונה",
  },
  {
    description: "Filmed, edited and uploaded in one message",
    message: "צילמתי, ערכתי והעליתי את הסרטון על השמלה השלישית",
    expectedStatusTypes: ["filmed", "edited", "uploaded"],
    expectedContentName: "שמלה שלישית",
    expectedMatchedTaskName: "האם שמלה שלישית זה מוגזם? סקר: האם כדאי שמלה שלישית?",
  },
  {
    description: "Cover and copy ready in one message",
    message: "הקאבר והקופי מוכנים לקפריסין",
    expectedStatusTypes: ["cover_ready", "copy_ready"],
    expectedContentName: "לקפריסין",
    allowAmbiguous: true,
  },
];

const SPRINT_8_MATCH_TESTS: Sprint8MatchTest[] = [
  {
    description: "Natural cover match for קפריסין",
    message: "הקאבר של הלוקים שלי לקפריסין מוכן",
    expectedStatusType: "cover_ready",
    expectedContentName: "הלוקים שלי לקפריסין",
  },
  {
    description: "Natural edit match for חליפה",
    message: "ערכתי את הסרטון עם החליפה",
    expectedStatusType: "edited",
    expectedContentName: "הלך לבחור חליפה עם החברה הכי טובה שלו - ואת לא משחררת",
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

const runMultiStatusTest = async (test: Sprint7MultiStatusTest) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Multi-status test: ${test.description}`);
  console.log(`Message: ${test.message}\n`);

  const statusUpdate = detectStatusUpdate(test.message);
  if (!statusUpdate) {
    console.error(`❌ Detection failed for message: ${test.message}`);
    return { passed: false, reason: "No status update detected." };
  }

  console.log(`Detected statusTypes: ${statusUpdate.statusTypes.join(", ")}`);
  console.log(`Extracted content name: "${statusUpdate.contentName}"`);

  const missingTypes = test.expectedStatusTypes.filter(
    (expected) => !statusUpdate.statusTypes.includes(expected as any)
  );
  if (missingTypes.length > 0) {
    console.error(`❌ Expected statusTypes ${test.expectedStatusTypes.join(", ")} but got ${statusUpdate.statusTypes.join(", ")}`);
    return { passed: false, reason: "Missing detected status types." };
  }

  if (statusUpdate.contentName !== normalizeHebrewText(test.expectedContentName)) {
    console.error(`❌ Expected content name '${test.expectedContentName}' but extracted '${statusUpdate.contentName}'`);
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
      console.log(`✅ Ambiguous result detected for content name: ${statusUpdate.contentName}`);
      console.log("No sheet update was performed for ambiguous multi-status message.");
      return { passed: true };
    }

    console.error(`❌ Expected a unique match but got ambiguous result for content name: ${statusUpdate.contentName}`);
    return { passed: false, reason: "Ambiguous production task match." };
  }

  const exactMatch = matchResult as ProductionTaskMatch;
  console.log(`Found production task on row ${exactMatch.rowIndex}: ${exactMatch.row[1]}`);

  for (const statusType of statusUpdate.statusTypes) {
    const columnName = getColumnName(statusType);
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

const runSprint8MatchTest = async (test: Sprint8MatchTest) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Sprint 8 match test: ${test.description}`);
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
  if (!matchResult || "ambiguous" in matchResult) {
    console.error(`❌ Expected a unique Sprint 8 match, but got ${matchResult ? JSON.stringify(matchResult) : "no match"}`);
    return { passed: false, reason: "Did not resolve to a unique task match." };
  }

  const actualContentName = matchResult.row[1] || "";
  if (actualContentName !== test.expectedContentName) {
    console.error(`❌ Expected content name '${test.expectedContentName}' but got '${actualContentName}'`);
    return { passed: false, reason: "Matched wrong task name." };
  }

  console.log(`✅ Sprint 8 resolved to unique task: ${actualContentName}`);
  console.log("No sheet update was performed in this test.");
  return { passed: true };
};
const main = async () => {
  console.log("Sprint 7 QA: Direct production status update validation");
  console.log("This script uses the Sprint 7 production status service and updates משימות הפקה directly.\n");

  const results = [] as Array<{ test: Record<string, unknown>; passed: boolean; reason?: string }>;

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
      results.push({ test: { description: test.description }, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Edge case test failed unexpectedly: ${message}`);
      results.push({ test: { description: test.description }, passed: false, reason: message });
    }
  }

  for (const test of MULTI_STATUS_TESTS) {
    try {
      const result = await runMultiStatusTest(test);
      results.push({ test: { description: test.description }, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Multi-status test failed unexpectedly: ${message}`);
      results.push({ test: { description: test.description }, passed: false, reason: message });
    }
  }

  for (const test of SPRINT_8_MATCH_TESTS) {
    try {
      const result = await runSprint8MatchTest(test);
      results.push({ test: { description: test.description, message: test.message, expectedStatusType: test.expectedStatusType }, passed: result.passed, reason: result.reason });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Sprint 8 test failed unexpectedly: ${message}`);
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
