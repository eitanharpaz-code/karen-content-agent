/**
 * Stage F0b — Edit-or-New Clarification Answer Detection QA
 *
 * The controller stores a pendingQuestion with questionType
 * "edit_or_new_clarification" when it asks "רצית לערוך את הרעיון הנוכחי
 * או לפתוח חדש?". This test verifies the answer-classification logic
 * extracted from that handler in isolation (no Express/Sheets/Twilio
 * mocking needed — this is the part that previously failed in production
 * on 17.6.2026: "לערוך את הנוכחי" → "אין כרגע משהו שמחכה לעריכה").
 *
 * Run with: npx ts-node src/test/sprint-f0b-edit-clarification-qa.ts
 */

const classifyAnswer = (incomingText: string): "edit" | "new" | "unclear" => {
  const rawAnswer = incomingText.trim().toLowerCase();
  const wantsEdit = ["לערוך", "לערוך את הנוכחי", "את הנוכחי", "הנוכחי", "עריכה"].some(
    (phrase) => rawAnswer.includes(phrase)
  );
  const wantsNew = ["לפתוח חדש", "חדש", "רעיון חדש"].some((phrase) => rawAnswer.includes(phrase));

  if (wantsEdit) return "edit";
  if (wantsNew) return "new";
  return "unclear";
};

type Test = {
  description: string;
  input: string;
  expect: "edit" | "new" | "unclear";
};

const TESTS: Test[] = [
  // --- The real production failure ---
  {
    description: "Real failure (17.6.2026) — 'לערוך את הנוכחי' must resolve to edit",
    input: "לערוך את הנוכחי",
    expect: "edit",
  },
  // --- Other plausible phrasings for editing ---
  {
    description: "Short answer 'הנוכחי' alone",
    input: "הנוכחי",
    expect: "edit",
  },
  {
    description: "Short answer 'לערוך'",
    input: "לערוך",
    expect: "edit",
  },
  {
    description: "Answer 'עריכה'",
    input: "עריכה",
    expect: "edit",
  },
  // --- New content phrasings ---
  {
    description: "Answer 'לפתוח חדש'",
    input: "לפתוח חדש",
    expect: "new",
  },
  {
    description: "Answer 'חדש' alone",
    input: "חדש",
    expect: "new",
  },
  {
    description: "Answer 'רעיון חדש'",
    input: "רעיון חדש",
    expect: "new",
  },
  // --- Ambiguous / unrelated answers must not crash or misfire ---
  {
    description: "Unrelated answer falls through as unclear",
    input: "מה הסטטוס של קפריסין",
    expect: "unclear",
  },
  {
    description: "Empty-ish answer falls through as unclear",
    input: "...",
    expect: "unclear",
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const result = classifyAnswer(test.input);
  const ok = result === test.expect;
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    console.log(`   ↳ expected "${test.expect}", got "${result}"`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error("Some tests failed");
}
