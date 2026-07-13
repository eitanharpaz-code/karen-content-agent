// Sponsored/organic detection QA (12.7.2026).
// Covers two fixes: (1) detection scans name + summary, since the save path
// passes Claude's short name as `idea`; (2) extended vocabulary (קולאב,
// collab, שיתופי פעולה) plus a lookahead so "שתפ" requires no Hebrew letter
// after it — creator-speak like "משתפת אתכם" is organic, not sponsored.
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

// --- Source-level: both fixes actually live in the service ---
check("detectionText combines idea + summary", src.includes("const detectionText = `${idea} ${summary}`;"));
check("collab regex tests detectionText, not bare idea", /const collab = \/[^\n]+\/i\.test\(detectionText\)/.test(src));
check("requiresShoot regex tests detectionText, not bare idea", /const requiresShoot = \/[^\n]+\/\.test\(detectionText\)/.test(src));
check("extended vocabulary present in service (קולאב + collab)", src.includes("קולאב") && src.includes("collab"));
check("mishtatefet lookahead present in service", src.includes("(?![\\u0590-\\u05FF])"));

// --- Behavioral: the exact regex from the service ---
const collabRegex = /(?:שת["״׳]?פ(?![\u0590-\u05FF])|שיתוף פעולה|שיתופי פעולה|חסות|חסת|ממומן|ממומנת|ברנד|מותג|לקוח|קולאב|collab)/i;

const vocabCases: Array<[string, boolean]> = [
  ["שתפ עם חברת תכשיטים", true],
  ['בשת"פ עם מותג קפה', true],
  ["שת״פ חדש ומרגש", true],
  ["קולאב עם עיריית תל אביב", true],
  ["Collab עם ברנד בגדים", true],
  ["יש לנו שיתופי פעולה החודש", true],
  ["תוכן ממומן על שגרת בוקר", true],
  ["אני משתפת אתכם ברגע מרגש", false],
  ["משתפים אתכם בהכנות", false],
  ["סרטון על רשת פיצריות שאני אוהבת", false],
  ["רוצה לגשת פנימה ולצלם", false],
  ["סרטון על ניסיון לבשל ארוחה רומנטית שנגמר בפיצה", false],
];
for (const [text, expected] of vocabCases) {
  check(`vocab: "${text}" → ${expected ? "שת\"פ" : "אורגני"}`, collabRegex.test(text) === expected);
}

console.log(`\nCollab detection QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
