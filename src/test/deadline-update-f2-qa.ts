// Audit F2 QA — isDeadlineUpdate must fire only on explicit deadline-change
// phrasings (aligned with extractDeadlineUpdate), never on messages that
// merely contain "תאריך" plus a substring like "שני" (inside "שניה" or
// "יום שני") or "שנה". Critical because this detector sits in the
// explicit-command escape hatch of every pendingQuestion handler — a false
// positive there wipes modal state mid-flow.
// Run: npx ts-node --transpile-only src/test/deadline-update-f2-qa.ts

import { isDeadlineUpdate, extractDeadlineUpdate } from "../services/production-status.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Real deadline commands: must still be detected ---
check('deadline: "תשני את הדדליין של קפריסין לתאריך 18/6"', isDeadlineUpdate("תשני את הדדליין של קפריסין לתאריך 18/6") === true);
check('deadline: "תשנה את הדדליין של שמלות ל-15/7"', isDeadlineUpdate("תשנה את הדדליין של שמלות ל-15/7") === true);
check('deadline: "עדכני את הדדליין של רווקות ל 20/8"', isDeadlineUpdate("עדכני את הדדליין של רווקות ל 20/8") === true);
check('deadline: "שני את הדדליין של קפריסין ל-18/6" (short verb, explicit form)', isDeadlineUpdate("שני את הדדליין של קפריסין ל-18/6") === true);
check('deadline: "הדדליין של קפריסין הוא 15/7" (declarative)', isDeadlineUpdate("הדדליין של קפריסין הוא 15/7") === true);
check('deadline: "תשני, את הדדליין של קפריסין ל-18/6" (verb with punctuation)', isDeadlineUpdate("תשני, את הדדליין של קפריסין ל-18/6") === true);
check('deadline: "תעדכן את התאריך של קפריסין ל-18/6" (explicit את התאריך)', isDeadlineUpdate("תעדכן את התאריך של קפריסין ל-18/6") === true);

// --- The F2 hijack cases: must NOT be detected ---
check('not deadline: "רגע שניה, מה התאריך של קפריסין?" (שני inside שניה)', isDeadlineUpdate("רגע שניה, מה התאריך של קפריסין?") === false);
check('not deadline: "בעצם תשני לתאריך של יום שני" (mid-flow answer)', isDeadlineUpdate("בעצם תשני לתאריך של יום שני") === false);
check('not deadline: "תזיזי את התאריך ליום שני" (יום שני, no change verb)', isDeadlineUpdate("תזיזי את התאריך ליום שני") === false);
check('not deadline: "מה מתוכנן ליום שני ואיזה תאריך פנוי?"', isDeadlineUpdate("מה מתוכנן ליום שני ואיזה תאריך פנוי?") === false);
check('not deadline: "השנה נתחתן, מה התאריך שקבענו?" (שנה inside השנה)', isDeadlineUpdate("השנה נתחתן, מה התאריך שקבענו?") === false);
check('not deadline: "רעיון לסרטון על בחירת תאריך לחתונה"', isDeadlineUpdate("רעיון לסרטון על בחירת תאריך לחתונה") === false);
check('not deadline: "מה הסטטוס של קפריסין?"', isDeadlineUpdate("מה הסטטוס של קפריסין?") === false);

// --- Detection stays aligned with extraction on canonical phrasings ---
const e1 = extractDeadlineUpdate("תשני את הדדליין של קפריסין לתאריך 18/6");
check("extraction still works: name", e1?.contentName === "קפריסין");
const e2 = extractDeadlineUpdate("הדדליין של שמלות הוא 15/7");
check("extraction still works: declarative name", e2?.contentName === "שמלות");

console.log(`\nF2 deadline-update QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
