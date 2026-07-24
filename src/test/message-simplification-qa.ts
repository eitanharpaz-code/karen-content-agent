// Message simplification + flexible time QA — 21.7.2026.
// Driven by the real conversation logs:
// (1) draft preview drops category/tone/priority (internal noise);
// (2) bank display drops the "(GEN-001 / כללי / עדיפות נמוך)" parenthetical;
// (3) upload-time parsing accepts Karen's real phrasings ("ב-11:00",
//     "בשעה 11:00", "ב11 ביום שישי") instead of only a bare number.
// Run: npx ts-node --transpile-only src/test/message-simplification-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { formatOpenIdeasResponse } from "../services/visibility.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

const controllerSource = readFileSync(
  path.resolve(__dirname, "../controllers/whatsapp.controller.ts"),
  "utf-8"
);

// --- 1. Draft preview simplification (source-level) ---
const previewFn = controllerSource.slice(
  controllerSource.indexOf("const buildDraftPreviewMessage"),
  controllerSource.indexOf("const buildDraftPreviewMessage") + 2600
);
check("draft preview no longer shows קטגוריה", !previewFn.includes("`קטגוריה: ${displayCategory"));
check("draft preview no longer shows טון", !previewFn.includes("`טון: ${displayTone"));
check("draft preview no longer shows עדיפות", !previewFn.includes("`עדיפות: ${getDraftPriorityText"));
check("draft preview shows the name in quotes", previewFn.includes('"${draft.shortName}"'));
check("draft preview prefixes the content type", previewFn.includes("displayContentType(draft.contentType)"));
check("draft preview shows the summary directly", previewFn.includes("draft.summary"));

// --- 2. Bank display cleanup (behavioral) ---
const ideasOutput = formatOpenIdeasResponse([
  { contentId: "GEN-001", idea: "ביזנס די לעוני", summary: "איך אחרי שטסים בביזנס קשה לחזור לאקונומי", category: "שמלות", priority: "נמוך" },
  { contentId: "MKB-001", idea: "אוהד קבוצה מסוימת", category: "היריון", priority: "נמוך" },
]);
// Categories chosen to NOT appear inside any idea name, so a hit means the
// category label leaked, not the name.
check("bank display omits the content ID", !ideasOutput.includes("GEN-001") && !ideasOutput.includes("MKB-001"));
check("bank display omits category", !ideasOutput.includes("שמלות") && !ideasOutput.includes("היריון"));
check("bank display omits priority label", !ideasOutput.includes("עדיפות נמוך"));
check("bank display shows the idea name in bold", ideasOutput.includes("*ביזנס די לעוני*"));
check("bank display omits the summary (scannable list)", !ideasOutput.includes("קשה לחזור לאקונומי"));
check("bank display has no leftover parentheses", !ideasOutput.includes("()") && !ideasOutput.includes("( )"));
check("bank display separates ideas with a blank line", ideasOutput.includes("*ביזנס די לעוני*\n\n"));

// --- 3. Flexible upload-time parsing (behavioral, mirrors the controller regex) ---
const timeRegex = /(?:^|[^\d])([01]?\d|2[0-3])(?::([0-5]\d))?(?![\d:])/;
const parseTime = (raw: string): string | null => {
  const m = raw.match(timeRegex);
  if (!m) return null;
  const h = m[1];
  const min = m[2] || "00";
  return `${h}:${min}`;
};
const timeCases: Array<[string, string | null]> = [
  ["11:00", "11:00"],
  ["ב11:00", "11:00"],
  ["בשעה 11:00", "11:00"],
  ["ב11 ביום שישי", "11:00"],
  ["18:00", "18:00"],
  ["8:30", "8:30"],
  ["ב-9", "9:00"],
  ["בשעה 20:15", "20:15"],
  ["11", "11:00"],
  ["בלי מספר בכלל", null],
];
for (const [input, expected] of timeCases) {
  check(`time: "${input}" → ${expected ?? "null"}`, parseTime(input) === expected);
}

console.log(`\nMessage simplification QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
