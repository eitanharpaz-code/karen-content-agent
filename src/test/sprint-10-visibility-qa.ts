import dotenv from "dotenv";
import {
  detectVisibilityIntent,
  extractSearchKeyword,
  formatVisibilityResponse,
  VisibilityIntent,
  isQuestionLikeMessage,
} from "../services/visibility.service";
import { detectStatusUpdate } from "../services/production-status.service";
import {
  getTasksMissingEdit,
  getTasksMissingCover,
  getTasksMissingCopy,
  getTasksNotUploaded,
  getTasksEditedAndNotUploaded,
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
  isQuestionLike?: boolean;
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
    description: "Detect edited-but-not-uploaded visibility intent from direct phrasing",
    query: "מה ערכתי ועוד לא עלה",
    expectedIntent: "edited_not_uploaded",
    shouldReadFromSheets: true,
  },
  {
    description: "Detect edited-but-not-uploaded visibility intent from alternate phrasing",
    query: "מה נערך ולא עלה",
    expectedIntent: "edited_not_uploaded",
    shouldReadFromSheets: true,
  },
  {
    description: "Unsupported question-like update should not auto-update sheets",
    query: "מה צילמתי?",
    expectedIntent: null,
    shouldReadFromSheets: false,
    isQuestionLike: true,
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
        case "edited_not_uploaded":
          tasks = await getTasksEditedAndNotUploaded(spreadsheetId);
          console.log(`📊 Found ${tasks.length} tasks edited but not uploaded`);
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

  if (testCase.isQuestionLike && !intent) {
    const looksLikeQuestion = isQuestionLikeMessage(testCase.query);
    if (!looksLikeQuestion) {
      console.error(`❌ Expected query to be question-like: ${testCase.query}`);
      return { passed: false, reason: "Question-like detection mismatch" };
    }
    console.log(`✅ Question-like message detected and no direct visibility intent returned`);
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

  const statusUpdateCheck = detectStatusUpdate("ערכתי את הסרטון על החליפה");
  if (!statusUpdateCheck) {
    console.error("❌ Expected production status update detection for non-question update phrase.");
    results.push({ description: "Non-question production status update remains supported", passed: false, reason: "Status update detection failed" });
  } else {
    console.log("✅ Production status update detection still works for non-question phrase.");
  }

  const allPassed = results.every((result) => result.passed);
  console.log("\n" + (allPassed ? "✅ All visibility query tests passed." : "❌ Some visibility query tests failed."));

  if (!allPassed) {
    process.exit(1);
  }
};

main();
