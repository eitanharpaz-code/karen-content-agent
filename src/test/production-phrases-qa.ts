import dotenv from "dotenv";
dotenv.config();
import { isProductionStatusUpdate, detectStatusUpdate } from "../services/production-status.service";

const testCases = [
  { text: "צילמנו את הסרטון על קפריסין", expected: "filmed" },
  { text: "סיימנו לצלם את הסרטון על השמלה", expected: "filmed" },
  { text: "גמרתי לצלם את הלוקים", expected: "filmed" },
  { text: "ערכנו את הסרטון על החתונה", expected: "edited" },
  { text: "סיימנו לערוך את הסרטון", expected: "edited" },
  { text: "עריכה מוכנה לסרטון על קפריסין", expected: "edited" },
  { text: "קאבר מוכן לסרטון על השמלה", expected: "cover_ready" },
  { text: "הכנתי קאבר לסרטון על הלוקים", expected: "cover_ready" },
  { text: "קופי מוכן לסרטון על החתונה", expected: "copy_ready" },
  { text: "כתבתי קופי לסרטון על קפריסין", expected: "copy_ready" },
  { text: "פרסמנו את הסרטון על השמלה", expected: "uploaded" },
  { text: "יצא לאוויר הסרטון על הלוקים", expected: "uploaded" },
  { text: "הסרטון פורסם", expected: "uploaded" },
];

console.log("בודק ביטויי הפקה:\n");
for (const { text, expected } of testCases) {
  const detected = detectStatusUpdate(text);
  const ok = detected?.statusType === expected ? "✅" : "❌";
  console.log(`${ok} "${text}"`);
  if (detected?.statusType !== expected) {
    console.log(`   צפוי: ${expected} | קיבל: ${detected?.statusType || "null"}`);
  }
}
