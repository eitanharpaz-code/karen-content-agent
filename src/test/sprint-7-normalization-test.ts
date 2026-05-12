import dotenv from "dotenv";
import { normalizeHebrewText, detectStatusUpdate } from "../services/production-status.service";

dotenv.config();

/**
 * Unit tests for Hebrew normalization matching and actual status extraction.
 */

const testNormalization = () => {
  console.log("=".repeat(60));
  console.log("Hebrew Normalization Tests");
  console.log("=".repeat(60) + "\n");

  const testCases: Array<{ input: string; expected: string; description: string }> = [
    {
      input: "סרטון על קפריסין",
      expected: "קפריסינ",
      description: "Remove filler words and normalize final letters",
    },
    {
      input: "הקאבר מוכן",
      expected: "קאבר מוכנ",
      description: "Remove definite article and normalize final letters",
    },
    {
      input: "צולם קפריסין",
      expected: "צולמ קפריסינ",
      description: "Normalize final letters only",
    },
    {
      input: "השמלה השלישית",
      expected: "שמלה שלישית",
      description: "Remove definite article prefix",
    },
  ];

  let allPassed = true;

  for (const testCase of testCases) {
    const result = normalizeHebrewText(testCase.input);
    const passed = result === testCase.expected;
    allPassed = allPassed && passed;

    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${testCase.description}`);
    console.log(`  Input:    "${testCase.input}"`);
    console.log(`  Expected: "${testCase.expected}"`);
    console.log(`  Got:      "${result}"`);
    console.log("");
  }

  return allPassed;
};

const testStatusExtraction = () => {
  console.log("=".repeat(60));
  console.log("Status Extraction Tests");
  console.log("=".repeat(60) + "\n");

  const testCases: Array<{ input: string; expectedStatusType: string; expectedContentName: string; description: string }> = [
    {
      input: "צילמתי סרטון על השמלה השלישית",
      expectedStatusType: "filmed",
      expectedContentName: "שמלה שלישית",
      description: "Reported matching bug should extract the task name",
    },
    {
      input: "סיימתי לערוך את קפריסין",
      expectedStatusType: "edited",
      expectedContentName: "קפריסינ",
      description: "Editing status with content name",
    },
    {
      input: "העליתי את הסרטון על החתונה",
      expectedStatusType: "uploaded",
      expectedContentName: "חתונה",
      description: "Uploaded status with filler words",
    },
  ];

  let allPassed = true;

  for (const testCase of testCases) {
    const result = detectStatusUpdate(testCase.input);
    const passed =
      result !== null &&
      result.statusType === testCase.expectedStatusType &&
      result.contentName === testCase.expectedContentName;

    allPassed = allPassed && passed;

    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${testCase.description}`);
    console.log(`  Input:    "${testCase.input}"`);
    console.log(`  Expected: statusType=${testCase.expectedStatusType}, contentName="${testCase.expectedContentName}"`);
    if (result) {
      console.log(`  Got:      statusType=${result.statusType}, contentName="${result.contentName}"`);
    } else {
      console.log(`  Got:      null`);
    }
    console.log("");
  }

  return allPassed;
};

const main = () => {
  const normalizationPassed = testNormalization();
  const extractionPassed = testStatusExtraction();

  console.log("=".repeat(60));
  console.log("Sprint 7 Matching Bug Fix - Test Summary");
  console.log("=".repeat(60));
  console.log(`Normalization Tests: ${normalizationPassed ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
  console.log(`Status Extraction Tests: ${extractionPassed ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);
  console.log("");

  if (normalizationPassed && extractionPassed) {
    console.log("✅ Sprint 7 matching bug fix is working correctly");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    process.exit(1);
  }
};

main();
