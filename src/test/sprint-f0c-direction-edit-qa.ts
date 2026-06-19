/**
 * Stage F0c — Edit Request "כיוון" Field Detection QA
 *
 * Real production failure (19.6.2026): the bot displays draft summaries
 * using the label "הכיוון:" but parseEditRequest only recognized "סיכום".
 * When Karen echoed the bot's own wording ("תשנה את הכיוון ל..."), the
 * edit failed to parse, looping her back into the
 * edit_or_new_clarification prompt indefinitely.
 *
 * Run with: npx ts-node src/test/sprint-f0c-direction-edit-qa.ts
 */

import { parseEditRequest } from "../services/confirmation.service";

type Test = {
  description: string;
  input: string;
  expectField: "summary" | null;
  expectValueIncludes?: string;
};

const TESTS: Test[] = [
  // --- Real production failure ---
  {
    description: "Real failure (19.6.2026) — 'תשנה את הכיוון ל' + line break + long text",
    input:
      "תשנה את הכיוון ל\nמסתכלת על שמלות של חברות שלי שבאו לחתונה שלי כדי לראות לאיזו חברה אקח שמלה באירוע הבא שלי",
    expectField: "summary",
    expectValueIncludes: "מסתכלת על שמלות של חברות",
  },
  {
    description: "'שנה את הכיוון ל' (short form, no תשנה)",
    input: "שנה את הכיוון ל סרטון אחר לגמרי",
    expectField: "summary",
    expectValueIncludes: "סרטון אחר לגמרי",
  },
  {
    description: "'הכיוון צריך להיות' phrasing",
    input: "הכיוון צריך להיות יותר רגשי ואישי",
    expectField: "summary",
    expectValueIncludes: "יותר רגשי ואישי",
  },

  // --- Existing "סיכום" formats must still work (no regression) ---
  {
    description: "Existing 'תשנה את הסיכום ל' must still work",
    input: "תשנה את הסיכום ל סרטון על משהו אחר בכלל",
    expectField: "summary",
    expectValueIncludes: "סרטון על משהו אחר בכלל",
  },
  {
    description: "Existing 'שנה סיכום ל' (no את) must still work",
    input: "שנה סיכום ל תוכן חדש לגמרי",
    expectField: "summary",
    expectValueIncludes: "תוכן חדש לגמרי",
  },
  {
    description: "Existing multi-line סיכום edit must still work",
    input: "תשנה את הסיכום ל:\nתיאור ארוך עם שורה חדשה באמצע",
    expectField: "summary",
    expectValueIncludes: "תיאור ארוך עם שורה חדשה",
  },

  // --- Unrelated text must not false-positive ---
  {
    description: "Unrelated confirmation message ('כן') must not match",
    input: "כן",
    expectField: null,
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const result = parseEditRequest(test.input);
  let ok = true;
  const reasons: string[] = [];

  if (test.expectField === null) {
    if (result !== null && result.field === "summary") {
      ok = false;
      reasons.push(`expected no summary match, got ${JSON.stringify(result)}`);
    }
  } else {
    if (!result || result.field !== test.expectField) {
      ok = false;
      reasons.push(`expected field "${test.expectField}", got ${JSON.stringify(result)}`);
    } else if (test.expectValueIncludes && !result.value.includes(test.expectValueIncludes)) {
      ok = false;
      reasons.push(`expected value to include "${test.expectValueIncludes}", got "${result.value}"`);
    }
  }

  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    reasons.forEach((r) => console.log(`   ↳ ${r}`));
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error("Some tests failed");
}
