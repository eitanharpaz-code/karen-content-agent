// Live-test bug fix QA (12.7.2026): sponsored/shoot detection must scan the
// summary too, since the save path passes Claude's short name (not Karen's
// original message) as `idea`. Verified at source level: the regexes test
// detectionText = idea + summary.
// Run: npx ts-node --transpile-only src/test/collab-detection-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

const src = readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8");

check("detectionText combines idea + summary", src.includes("const detectionText = `${idea} ${summary}`;"));
check("collab regex tests detectionText, not bare idea", /const collab = \/[^\n]+\/\.test\(detectionText\)/.test(src));
check("requiresShoot regex tests detectionText, not bare idea", /const requiresShoot = \/[^\n]+\/\.test\(detectionText\)/.test(src));
check("sponsored keywords intact (שת\"פ, ממומן, מותג)", src.includes("ממומן") && src.includes("מותג"));

// Behavioral sanity on the regex itself, replicated from source:
const collabRegex = /(?:שת["״׳]?פ|שיתוף פעולה|חסות|חסת|ממומן|ממומנת|ברנד|מותג|לקוח)/;
check("regex matches inside a summary", collabRegex.test("בוקר עם קפה " + "שיתוף פעולה עם מותג קפה על שגרת הבוקר"));
check("regex does not match an organic summary", !collabRegex.test("סרטון על ניסיון לבשל ארוחה רומנטית שנגמר בפיצה"));

console.log(`\nCollab detection QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// --- Vocabulary pass additions (12.7.2026) ---
const extendedRegex = /(?:שת["״׳]?פ(?![\u0590-\u05FF])|שיתוף פעולה|שיתופי פעולה|חסות|חסת|ממומן|ממומנת|ברנד|מותג|לקוח|קולאב|collab)/i;
const vocabCases: Array<[string, boolean]> = [
  ["שתפ עם חברת תכשיטים", true],
  ['בשת"פ עם מותג קפה', true],
  ["שת״פ חדש ומרגש", true],
  ["קולאב עם עיריית תל אביב", true],
  ["Collab עם ברנד בגדים", true],
  ["יש לנו שיתופי פעולה החודש", true],
  ["אני משתפת אתכם ברגע מרגש", false],
  ["משתפים אתכם בהכנות", false],
  ["סרטון על רשת פיצריות שאני אוהבת", false],
  ["רוצה לגשת פנימה ולצלם", false],
];
let vocabFail = 0;
for (const [text, expected] of vocabCases) {
  const got = extendedRegex.test(text);
  const ok = got === expected;
  if (!ok) vocabFail++;
  console.log(`${ok ? "✅" : "❌"} vocab: "${text}" → ${got}`);
}
if (vocabFail > 0) process.exitCode = 1;
console.log(`Vocabulary cases: ${vocabCases.length - vocabFail}/${vocabCases.length} passed`);
