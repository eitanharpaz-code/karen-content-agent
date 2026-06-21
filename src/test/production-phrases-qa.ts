import dotenv from "dotenv";
import { detectStatusUpdate } from "../services/production-status.service";

dotenv.config();

const testCases: Array<{ text: string; expected: string | null }> = [
  { text: "צילמנו את הסרטון על קפריסין", expected: "filmed" },
  { text: "סיימנו לצלם את הסרטון על השמלה", expected: "filmed" },
  { text: "גמרתי לצלם את הלוקים", expected: "filmed" },
  { text: "ערכנו את הסרטון על החתונה", expected: "edited" },
  { text: "סיימנו לערוך את הסרטון", expected: "edited" },
  { text: "עריכה מוכנה לסרטון על קפריסין", expected: "edited" },
  { text: "קאבר מוכן לסרטון על השמלה", expected: "cover_ready" },
  { text: "הכנתי קאבר לסרטון על הלוקים", expected: "cover_ready" },
  { text: "קופי מוכן לסרטון על החתונה", expected: null },
  { text: "כתבתי קופי לסרטון על קפריסין", expected: null },
  { text: "פרסמנו את הסרטון על השמלה", expected: "uploaded" },
  { text: "יצא לאוויר הסרטון על הלוקים", expected: "uploaded" },
  { text: "הסרטון פורסם", expected: "uploaded" },
  { text: "צילמתי וערכתי סרטון חדש על סיור לוקיישנים לחתונה בתל אביב", expected: "filmed" },
  { text: "צילמתי וערכתי סרטון חדש על זוגיות", expected: "filmed" },
  { text: "צילמתי סרטון חדש על שמלה שלישית", expected: "filmed" },
  { text: "ערכתי סרטון חדש על קטגוריית קפריסין", expected: "edited" },
];

console.log("בודק ביטויי הפקה:\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const result = detectStatusUpdate(test.text);
  const actual = result?.statusType ?? null;
  const ok = actual === test.expected;

  if (ok) {
    console.log(`✅ "${test.text}"`);
    if (result?.contentName) {
      console.log(`   Content: "${result.contentName}"`);
    }
    passed++;
  } else {
    console.log(`❌ "${test.text}"`);
    console.log(`   צפוי: ${test.expected} | קיבל: ${actual}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  throw new Error("production-phrases-qa failed");
}
