import dotenv from "dotenv";
dotenv.config();
import { detectVisibilityIntent, extractPriorityFromQuery } from "../services/visibility.service";

const testCases = [
  { text: "מה בעדיפות גבוהה?", expected: "גבוה" },
  { text: "מה גבוה?", expected: "גבוה" },
  { text: "תראי לי גבוה", expected: "גבוה" },
  { text: "עדיפות גבוהה", expected: "גבוה" },
  { text: "מה בינוני?", expected: "בינוני" },
  { text: "מה בעדיפות בינונית", expected: "בינוני" },
  { text: "מה נמוך?", expected: "נמוך" },
  { text: "מה בעדיפות נמוכה", expected: "נמוך" },
  { text: "תראי נמוך", expected: "נמוך" },
];

console.log("בודק זיהוי עדיפויות:\n");
for (const { text, expected } of testCases) {
  const intent = detectVisibilityIntent(text);
  const priority = extractPriorityFromQuery(text);
  const ok = intent === "priority_filter" ? "✅" : "❌";
  console.log(`${ok} "${text}" → intent: ${intent} | עדיפות: ${priority}`);
}
