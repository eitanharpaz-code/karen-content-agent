import dotenv from "dotenv";
dotenv.config();
import { detectVisibilityIntent } from "../services/visibility.service";

const testCases = [
  { text: "חסר קאבר לסרטון", expected: "missing_cover" },
  { text: "אין קאבר", expected: "missing_cover" },
  { text: "ללא קאבר", expected: "missing_cover" },
  { text: "למה חסר קופי?", expected: null },
  { text: "אין קופי לסרטון", expected: null },
  { text: "מה לא עלה?", expected: "not_uploaded" },
  { text: "מה עוד לא עלה?", expected: "not_uploaded" },
  { text: "עדיין לא עלה", expected: "not_uploaded" },
  { text: "מה טרם עלה?", expected: "not_uploaded" },
  { text: "תקועה", expected: "stuck_workflow" },
  { text: "מה תקוע אצלי?", expected: "stuck_workflow" },
  { text: "מה נתקע אצלי?", expected: "stuck_workflow" },
];

console.log("בודק ביטויי visibility:\n");
for (const { text, expected } of testCases) {
  const intent = detectVisibilityIntent(text);
  const ok = intent === expected ? "✅" : "❌";
  console.log(`${ok} "${text}" → ${intent}`);
}
