/**
 * Usability Improvements QA Test
 * Tests conversational UX improvements from real-world usage feedback
 */

import {
  cleanIdeaPrefix,
  isContinuationMessage,
  isMetaConversation,
  hasIdeaConfidence,
  generateClarificationPrompt,
} from "../utils/conversation-utils";

console.log("Usability Improvements QA Test\n");

const testResults: { name: string; passed: boolean }[] = [];

// ===== FIX 1: Conversational Idea Prefix Cleanup =====
console.log("--- Test: Conversational Idea Prefix Cleanup ---");

const prefixTests = [
  { input: "יש לי רעיון על בת זוג של אוהד כדורגל...", expected: "על בת זוג של אוהד כדורגל..." },
  { input: "יש לי רעיון חדש לסרטון על חתונה", expected: "על חתונה" },
  { input: "חשבתי על רעיון על בנות רווקות", expected: "על בנות רווקות" },
  { input: "יש לי קונספט על ספקים", expected: "על ספקים" },
  { input: "קונספט: סרטון על טיקטוק", expected: "סרטון על טיקטוק" },
  { input: "רעיון לסרטון על מה שחשוב לי", expected: "על מה שחשוב לי" },
  { input: "זו לא הצעה עם קידומת", expected: "זו לא הצעה עם קידומת" }, // No prefix
];

for (const test of prefixTests) {
  const result = cleanIdeaPrefix(test.input);
  const passed = result === test.expected;
  testResults.push({ name: `Prefix cleanup: "${test.input.substring(0, 30)}..."`, passed });
  console.log(`${passed ? "✅" : "❌"} Input: "${test.input}"`);
  console.log(`   Expected: "${test.expected}"`);
  console.log(`   Got: "${result}"\n`);
}

// ===== FIX 2: Draft Continuation Detection =====
console.log("\n--- Test: Draft Continuation Detection ---");

const continuationTests = [
  { input: "זה פארודיה על...", expected: true },
  { input: "הרעיון הוא שאולי...", expected: true },
  { input: "כאילו סרטון שמעשן...", expected: true },
  { input: "אבל אני חושבת...", expected: true },
  { input: "בעצם, אנחנו יכולים...", expected: true },
  { input: "רעיון חדש לגמרי", expected: false },
  { input: "מה דעתך על זה", expected: false },
];

for (const test of continuationTests) {
  const result = isContinuationMessage(test.input);
  const passed = result === test.expected;
  testResults.push({ name: `Continuation: "${test.input.substring(0, 30)}"`, passed });
  console.log(`${passed ? "✅" : "❌"} Input: "${test.input}"`);
  console.log(`   Expected: ${test.expected}, Got: ${result}\n`);
}

// ===== FIX 3: Meta-Conversation Detection =====
console.log("\n--- Test: Meta-Conversation Detection ---");

const metaTests = [
  { input: "על מה ענית?", expected: true },
  { input: "לא הבנת אותי", expected: true },
  { input: "למה התכוונת?", expected: true },
  { input: "זה לא מה שאמרתי", expected: true },
  { input: "מה התכוננת?", expected: true },
  { input: "זה לא בדיוק", expected: true },
  { input: "רעיון על טיקטוק", expected: false },
  { input: "סרטון חדש על חתונה", expected: false },
];

for (const test of metaTests) {
  const result = isMetaConversation(test.input);
  const passed = result === test.expected;
  testResults.push({ name: `Meta-conversation: "${test.input}"`, passed });
  console.log(`${passed ? "✅" : "❌"} Input: "${test.input}"`);
  console.log(`   Expected: ${test.expected}, Got: ${result}\n`);
}

// ===== FIX 5: Confidence Gating =====
console.log("\n--- Test: Idea Confidence Gating ---");

const confidenceTests = [
  { input: "סרטון על חתונה", expected: true },
  { input: "רעיון חדש על טיקטוק", expected: true },
  { input: "א", expected: false }, // Too short
  { input: "?", expected: false }, // Just question mark
  { input: "ABBBBBB", expected: false }, // All caps short
  { input: "סרטון", expected: true }, // Single word but meaningful
  { input: "סרטון על חתונה עם ריקוד ודברים משעשעים", expected: true }, // Good content
];

for (const test of confidenceTests) {
  const result = hasIdeaConfidence(test.input);
  const passed = result === test.expected;
  testResults.push({ name: `Confidence: "${test.input.substring(0, 30)}"`, passed });
  console.log(`${passed ? "✅" : "❌"} Input: "${test.input}"`);
  if (!passed) {
    const normalized = test.input.trim().toLowerCase();
    console.log(`   Debug: normalized="${normalized}", length=${normalized.length}`);
  }
  console.log(`   Expected: ${test.expected}, Got: ${result}\n`);
}

// ===== FIX 4: Clarification Prompts =====
console.log("\n--- Test: Clarification Prompts ---");

const clarificationWithDraft = generateClarificationPrompt(true);
const clarificationWithoutDraft = generateClarificationPrompt(false);

const clarificationCheck1 = clarificationWithDraft.includes("לערוך את הרעיון הקיים");
const clarificationCheck2 = clarificationWithoutDraft.includes("להשתיל רעיון חדש");

testResults.push({ name: "Clarification with active draft", passed: clarificationCheck1 });
testResults.push({ name: "Clarification without active draft", passed: clarificationCheck2 });

console.log(`${clarificationCheck1 ? "✅" : "❌"} Clarification with draft includes edit option`);
console.log(`   Response: "${clarificationWithDraft}"\n`);

console.log(`${clarificationCheck2 ? "✅" : "❌"} Clarification without draft includes new idea option`);
console.log(`   Response: "${clarificationWithoutDraft}"\n`);

// ===== Summary =====
console.log("=".repeat(60));
const passed = testResults.filter((r) => r.passed).length;
const total = testResults.length;

console.log(`Usability Improvements QA Results`);
console.log(`=`.repeat(60));
console.log(`Passed: ${passed}/${total}`);

if (passed === total) {
  console.log(`\n✅ All usability improvement tests passed.`);
} else {
  console.log(`\n❌ Some tests failed:`);
  testResults.filter((r) => !r.passed).forEach((r) => {
    console.log(`   - ${r.name}`);
  });
}
