import dotenv from "dotenv";
import {
  isResetRequest,
  isNewIdeaCommand,
  getNewIdeaText,
  parseEditRequest,
} from "../services/confirmation.service";
import {
  ensureCategoryExists,
  generateContentIdForPrefix,
  generateContentId,
  getCategories,
} from "../services/sheets.service";

dotenv.config();

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) {
  throw new Error("Missing GOOGLE_SHEETS_ID environment variable.");
}

type TestResult = { description: string; passed: boolean; reason?: string };

const randomSuffix = () => `qa_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

const runTest = async (description: string, fn: () => Promise<void>) => {
  try {
    await fn();
    return { description, passed: true };
  } catch (error) {
    return { description, passed: false, reason: error instanceof Error ? error.message : String(error) };
  }
};

const testResetAndNewIdeaCommands = async () => {
  if (!isResetRequest("ביטול")) throw new Error("Expected reset request to be recognized.");
  if (!isResetRequest("רעיון חדש")) throw new Error("Expected reset request by phrase to be recognized.");
  if (!isNewIdeaCommand("רעיון חדש: משהו חדש")) throw new Error("Expected new idea command to be recognized.");
  const ideaText = getNewIdeaText("רעיון חדש: קמפיין קיץ חדש");
  if (ideaText !== "קמפיין קיץ חדש") throw new Error(`Expected idea text to be extracted, got '${ideaText}'`);
};

const testCategoryEditParsing = async () => {
  const edit = parseEditRequest("שני את הקטגוריה ל-קפריסין");
  if (!edit || edit.field !== "category" || edit.value !== "קפריסין") {
    throw new Error(`Expected category edit parsing for קפריסין, got ${JSON.stringify(edit)}`);
  }
};

const testGenerateContentIdForPrefix = async () => {
  const ids = ["GEN-001", "GEN-002", "CYP-005", "CYP-006"];
  const nextGen = generateContentIdForPrefix("GEN", ids);
  if (nextGen !== "GEN-003") throw new Error(`Expected GEN-003, got ${nextGen}`);
  const nextCyp = generateContentIdForPrefix("CYP", ids);
  if (nextCyp !== "CYP-007") throw new Error(`Expected CYP-007, got ${nextCyp}`);
};

const testCategoryRegistryCreateAndPrefix = async () => {
  const uniqueCategory = `בדיקה ${randomSuffix()}`;
  const existingEntry = await ensureCategoryExists(spreadsheetId, uniqueCategory, false);
  if (existingEntry !== null) {
    throw new Error("Expected unknown category to return null when creation is not allowed.");
  }

  const createdEntry = await ensureCategoryExists(spreadsheetId, uniqueCategory, true);
  if (!createdEntry || !createdEntry.prefix) {
    throw new Error("Expected category creation to return a registry entry with prefix.");
  }
  if (createdEntry.categoryName !== uniqueCategory) {
    throw new Error(`Expected categoryName to match '${uniqueCategory}', got '${createdEntry.categoryName}'`);
  }

  const categories = await getCategories(spreadsheetId);
  const found = categories.find((entry) => entry.categoryName === uniqueCategory);
  if (!found) {
    throw new Error("Expected created category to appear in category registry.");
  }
};

const testGenerateContentIdUsesCategoryPrefix = async () => {
  const uniqueCategory = `בדיקה ${randomSuffix()}`;
  const createdEntry = await ensureCategoryExists(spreadsheetId, uniqueCategory, true);
  if (!createdEntry) {
    throw new Error("Expected category creation to succeed.");
  }

  const ids = ["GEN-001", `${createdEntry.prefix}-001`, `${createdEntry.prefix}-002`];
  const nextId = await generateContentId(spreadsheetId, uniqueCategory, ids, false);
  if (nextId !== `${createdEntry.prefix}-003`) {
    throw new Error(`Expected next ID ${createdEntry.prefix}-003, got ${nextId}`);
  }
};

const main = async () => {
  console.log("Sprint 9 Category Registry QA");
  const tests: Array<() => Promise<void>> = [
    testResetAndNewIdeaCommands,
    testCategoryEditParsing,
    testGenerateContentIdForPrefix,
    testCategoryRegistryCreateAndPrefix,
    testGenerateContentIdUsesCategoryPrefix,
  ];

  const results: TestResult[] = [];
  for (const test of tests) {
    const result = await runTest(test.name, test);
    results.push(result);
    console.log(`- ${result.description}: ${result.passed ? "PASS" : "FAIL"}${result.reason ? ` (${result.reason})` : ""}`);
  }

  const allPassed = results.every((result) => result.passed);
  console.log("\nSprint 9 Category Registry QA Results");
  if (!allPassed) {
    console.error("❌ Some tests failed.");
    process.exit(1);
  }
  console.log("✅ All tests passed.");
};

main();
