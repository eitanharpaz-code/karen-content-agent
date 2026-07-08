import dotenv from "dotenv";
import {
  detectVisibilityIntent,
  detectVisibilityIntentWithAI,
  type VisibilityIntent,
} from "../services/visibility.service";

dotenv.config();

type Case = {
  name: string;
  message: string;
  // The intent hardcoded detection would return today (for regression tracking / to
  // classify whether this test exercises the AI path).
  expectedHardcoded: VisibilityIntent;
  // The intent we expect the AI-augmented path to return.
  expectedWithAI: VisibilityIntent;
};

const cases: Case[] = [
  // ----- Hardcoded sync path: must still work exactly as before -----
  {
    name: "REGRESSION: 'מה בגאנט השבוע' — sync path",
    message: "מה בגאנט השבוע",
    expectedHardcoded: "gantt_query",
    expectedWithAI: "gantt_query",
  },
  {
    name: "REGRESSION: 'מה עוד לא ערוך' — sync path",
    message: "מה עוד לא ערוך",
    expectedHardcoded: "missing_edit",
    expectedWithAI: "missing_edit",
  },

  // ----- AI fallback: novel phrasings hardcoded misses -----
  {
    name: "AI: 'יש משהו שאני צריכה לצלם השבוע?'",
    message: "יש משהו שאני צריכה לצלם השבוע?",
    expectedHardcoded: null,
    expectedWithAI: "missing_filmed",
  },
  {
    name: "AI: 'יש לי משהו דחוף עכשיו?'",
    message: "יש לי משהו דחוף עכשיו?",
    expectedHardcoded: null,
    expectedWithAI: "whats_important",
  },
  {
    name: "REGRESSION: 'שכחתי מה כבר מוכן להעלאה' — hardcoded catches",
    message: "שכחתי מה כבר מוכן להעלאה",
    expectedHardcoded: "edited_not_uploaded",
    expectedWithAI: "edited_not_uploaded",
  },
  {
    name: "AI: 'בואי נראה מה עוד צריך צילום השבוע'",
    message: "בואי נראה מה עוד צריך צילום השבוע",
    expectedHardcoded: "missing_filmed",
    expectedWithAI: "missing_filmed",
  },
  {
    name: "AI: 'תזכירי לי מה עולה מחר או מחרתיים'",
    message: "תזכירי לי מה עולה מחר או מחרתיים",
    expectedHardcoded: null,
    expectedWithAI: "gantt_query",
  },
  {
    name: "AI: 'איפה אני עם הצילומים?'",
    message: "איפה אני עם הצילומים?",
    expectedHardcoded: null,
    expectedWithAI: "missing_filmed",
  },

  // ----- AI must return NONE for arg-extraction cases (safety guard) -----
  {
    name: "GUARD: specific-name status query stays on hardcoded task_status path",
    message: "מה קורה עם הסרטון על שמלת קפריסין?",
    expectedHardcoded: "task_status",
    expectedWithAI: "task_status", // hardcoded target-extractor handles it
  },
  {
    name: "AI: month name should NOT be routed",
    message: "מה מתכננת ביולי הזה?",
    expectedHardcoded: null,
    expectedWithAI: null, // Claude sees "יולי" → returns NONE
  },

  // ----- Cheap sync gate: non-question messages must not reach Claude -----
  {
    name: "GATE: statement-not-question stays null (no AI call)",
    message: "היה יום טוב",
    expectedHardcoded: null,
    expectedWithAI: null,
  },
  {
    name: "GATE: new-idea message stays null (no AI call)",
    message: "יש לי רעיון חדש על שמלת חורף",
    expectedHardcoded: null,
    expectedWithAI: null,
  },
];

const grade = { passed: 0, failed: 0, notes: [] as string[] };

const assert = (label: string, condition: boolean, detail?: string) => {
  if (condition) {
    grade.passed++;
    console.log(`  ✅ ${label}`);
  } else {
    grade.failed++;
    grade.notes.push(`FAIL: ${label}${detail ? " — " + detail : ""}`);
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  }
};

const main = async () => {
  console.log("=== Visibility Intent AI Fallback QA ===\n");

  for (const c of cases) {
    console.log(`--- ${c.name} ---`);
    console.log(`Message: "${c.message}"`);

    const syncResult = detectVisibilityIntent(c.message);
    console.log(`Hardcoded (sync): ${syncResult}`);

    assert(
      "Hardcoded path returns expected value",
      syncResult === c.expectedHardcoded,
      `expected="${c.expectedHardcoded}" got="${syncResult}"`
    );

    const aiResult = await detectVisibilityIntentWithAI(c.message);
    console.log(`Wrapper (AI-augmented): ${aiResult}`);

    assert(
      "AI-augmented wrapper returns expected value",
      aiResult === c.expectedWithAI,
      `expected="${c.expectedWithAI}" got="${aiResult}"`
    );

    console.log();
  }

  console.log(`=== Summary ===`);
  console.log(`Passed: ${grade.passed}`);
  console.log(`Failed: ${grade.failed}`);
  if (grade.notes.length) {
    console.log(`Failures:`);
    grade.notes.forEach((n) => console.log(`  - ${n}`));
  }

  process.exit(grade.failed === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error("QA runner crashed:", err);
  process.exit(1);
});
