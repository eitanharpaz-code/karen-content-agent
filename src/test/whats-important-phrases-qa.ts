import dotenv from "dotenv";
dotenv.config();
import { detectVisibilityIntent } from "../services/visibility.service";

const testCases = [
  "מה הכי חשוב?",
  "מה חשוב?",
  "מה דחוף",
  "מה להעלות?",
  "מה לעלות?",
  "מה כדאי להעלות",
  "מה הצעד הבא",
  "מה אני צריכה לעשות?",
];

console.log("בודק זיהוי ביטויים:\n");
for (const text of testCases) {
  const intent = detectVisibilityIntent(text);
  const ok = intent === "whats_important" ? "✅" : "❌";
  console.log(`${ok} "${text}" → ${intent}`);
}
