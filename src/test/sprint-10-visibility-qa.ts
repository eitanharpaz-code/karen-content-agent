import dotenv from "dotenv";
import {
  detectVisibilityIntent,
  extractSearchKeyword,
  formatVisibilityResponse,
  VisibilityIntent,
} from "../services/visibility.service";
import {
  getTasksMissingEdit,
  getTasksMissingCover,
  getTasksMissingCopy,
  getTasksNotUploaded,
  getStuckTasks,
  searchTasksByKeyword,
} from "../services/sheets.service";

dotenv.config();

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) {
  throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
}

type VisibilityTestCase = {
  description: string;
  query: string;
  expectedIntent: VisibilityIntent;
  shouldReadFromSheets: boolean;
};

const TEST_CASES: VisibilityTestCase[] = [
  {
    description: "Detect missing edit intent from Hebrew query",
    query: "מה נשאר לערוך?",
    expectedIntent: "missing_edit",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect missing edit intent from alternative phrasing",
    query: "איזה סרטונים עדיין לא ערוכים?",
    expectedIntent: "missing_edit",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect missing cover intent",
    query: "איזה תכנים בלי קאבר?",
    expectedIntent: "missing_cover",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect missing copy intent",
    query: "איזה תכנים בלי קופי?",
    expectedIntent: "missing_copy",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect upload status intent",
    query: "מה עדיין לא עלה?",
    expectedIntent: "not_uploaded",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect stuck workflow intent",
    query: "איזה תכנים תקועים?",
    expectedIntent: "stuck_workflow",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect category search intent",
    query: "מה הסטטוס של קפריסין?",
    expectedIntent: "category_search",
    shouldReadFromSheets: true,
  },
];

const runVisibilityTest = async (testCase: VisibilityTestCase) => {
  console.log("\n" + "-".repeat(60));
  console.log(`Test: ${testCase.description}`);
  console.log(`Query: "${testCase.query}"`);

  const intent = detectVisibilityIntent(testCase.query);
  if (intent !== testCase.expectedIntent) {
    console.error(`❌ Expected intent '${testCase.expectedIntent}' but got '${intent}'`);
    return { passed: false, reason: "Intent detection mismatch" };
  }
  console.log(`✅ Intent correctly detected as: ${intent}`);

  if (testCase.shouldReadFromSheets) {
    try {
      let tasks;
      switch (intent) {
        case "missing_edit":
          tasks = await getTasksMissingEdit(spreadsheetId);
          console.log(`📊 Found ${tasks.length} tasks missing edit`);
          break;
        case "missing_cover":
          tasks = await getTasksMissingCover(spreadsheetId);
          console.log(`📊 Found ${tasks.length} tasks missing cover`);
          break;
        case "missing_copy":
          tasks = await getTasksMissingCopy(spreadsheetId);
          console.log(`📊 Found ${tasks.length} tasks missing copy`);
          break;
        case "not_uploaded":
          tasks = await getTasksNotUploaded(spreadsheetId);
          console.log(`📊 Found ${tasks.length} tasks not uploaded`);
          break;
        case "stuck_workflow":
          tasks = await getStuckTasks(spreadsheetId);
          console.log(`📊 Found ${tasks.length} stuck tasks`);
          break;
        case "category_search": {
          const keyword = extractSearchKeyword(testCase.query);
          if (!keyword) {
            console.log("❌ Could not extract search keyword");
            return { passed: false, reason: "Keyword extraction failed" };
          }
          console.log(`🔍 Searching for keyword: "${keyword}"`);
          tasks = await searchTasksByKeyword(spreadsheetId, keyword);
          console.log(`📊 Found ${tasks.length} tasks matching keyword`);
          break;
        }
        default:
          console.error(`❌ Unhandled intent: ${intent}`);
          return { passed: false, reason: "Unhandled intent" };
      }

      if (!Array.isArray(tasks)) {
        console.error(`❌ Expected array of tasks, got ${typeof tasks}`);
        return { passed: false, reason: "Invalid task array" };
      }

      const response = formatVisibilityResponse(tasks, intent);
      console.log(`📱 Response:\n${response}`);
      console.log(`✅ Sheet query executed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Sheet query failed: ${message}`);
      return { passed: false, reason: `Sheet error: ${message}` };
    }
  }

  return { passed: true };
};

const main = async () => {
  console.log("Sprint 10 Visibility Query QA");
  const results: Array<{ description: string; passed: boolean; reason?: string }> = [];

  for (const testCase of TEST_CASES) {
    try {
      const result = await runVisibilityTest(testCase);
      results.push({
        description: testCase.description,
        passed: result.passed,
        reason: result.reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Test failed unexpectedly: ${message}`);
      results.push({
        description: testCase.description,
        passed: false,
        reason: message,
      });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Sprint 10 Visibility Query QA Results");
  console.log("=".repeat(60));

  for (const result of results) {
    console.log(
      `- ${result.description}: ${result.passed ? "PASS" : "FAIL"}${result.reason ? ` (${result.reason})` : ""}`
    );
  }

  const allPassed = results.every((result) => result.passed);
  console.log("\n" + (allPassed ? "✅ All visibility query tests passed." : "❌ Some visibility query tests failed."));

  if (!allPassed) {
    process.exit(1);
  }
};

main();
