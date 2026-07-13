// Weekly progress QA (12.7.2026) — the "2 reels a week" context layer.
// Verifies: (1) computeWeeklyProgress counts only organic items published in
// the CURRENT week; (2) the morning brief gains exactly one status line with
// correct phrasing per state; (3) the afternoon reminder adds recognition
// only when the target is met; (4) everything is backwards-compatible when
// weeklyProgress is absent. Prioritization logic itself is untouched.
// Run: npx ts-node --transpile-only src/test/weekly-progress-qa.ts

import { computeWeeklyProgress, PlanningGanttItem } from "../services/planning-health.service";
import {
  buildMorningBriefFromData,
  buildAfternoonReminderFromData,
  formatWeeklyStatusLine,
} from "../services/daily-brief.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// Anchor: Wednesday 15/07/2026. Its week (Sun-Sat) is 12/07 - 18/07.
const anchor = new Date(2026, 6, 15);
const item = (
  id: string, date: string, type: string, status: string, collab = "לא"
): PlanningGanttItem => ({ contentId: id, date, contentType: type, status, collaboration: collab });

// --- 1. Counter behavior ---
const gantt: PlanningGanttItem[] = [
  item("GEN-001", "13/07/2026", "ריל", "פורסם"),          // organic reel, this week → counts
  item("GEN-002", "08/07/2026", "ריל", "פורסם"),          // last week → no
  item("GEN-003", "16/07/2026", "ריל", "בתכנון"),         // not published → no
  item("MSK-001", "14/07/2026", "ריל", "פורסם", "כן"),    // collab → no
  item("GEN-004", "14/07/2026", "פוסט", "פורסם"),         // organic post → posts counter
  item("טרם תוכנן", "15/07/2026", "ריל", "פורסם"),        // unusable id → no
];

const p1 = computeWeeklyProgress(gantt, { anchorDate: anchor });
check("counts exactly one organic reel published this week", p1.publishedReels === 1);
check("last week / unpublished / collab / unusable-id are all excluded", p1.publishedReels === 1 && p1.publishedPosts === 1);
check("default targets come from planning-health (2 reels, 1 post)", p1.reelTarget === 2 && p1.postTarget === 1);
check("target not met with 1 of 2", p1.reelTargetMet === false);

const p2 = computeWeeklyProgress(
  [...gantt, item("GEN-005", "12/07/2026", "ריל", "פורסם")],
  { anchorDate: anchor }
);
check("target met with 2 of 2", p2.reelTargetMet === true && p2.publishedReels === 2);

// --- 2. Status line phrasing ---
check("no progress object → no line (backwards compatible)", formatWeeklyStatusLine(undefined) === null);
check("zero published → target-framing line", (formatWeeklyStatusLine({ publishedReels: 0, publishedPosts: 0, reelTarget: 2, postTarget: 1, reelTargetMet: false }) || "").includes("עוד לא עלה ריל השבוע"));
check("one of two → 'עוד אחד וסגרנו'", (formatWeeklyStatusLine(p1) || "").includes("עוד אחד וסגרנו את היעד"));
check("target met → 'מכאן הכל בונוס'", (formatWeeklyStatusLine(p2) || "").includes("מכאן הכל בונוס"));

// --- 3. Morning brief integration (quiet-day path: no priority items) ---
const morningWith = buildMorningBriefFromData({
  priorityItems: [], futureHoles: [], monthName: "יולי", planningSignals: [], weeklyProgress: p1,
});
check("morning brief includes the weekly status line", (morningWith || "").includes("סטטוס שבועי"));
const morningWithout = buildMorningBriefFromData({
  priorityItems: [], futureHoles: [], monthName: "יולי", planningSignals: [],
});
check("morning brief without progress has no status line (backwards compatible)", !(morningWithout || "").includes("סטטוס שבועי"));

// --- 4. Afternoon recognition ---
const afternoonMet = buildAfternoonReminderFromData({
  priorityItems: [], ganttIsLight: true, monthName: "יולי", weeklyProgress: p2,
});
check("afternoon adds recognition when target met", (afternoonMet || "").includes("מכאן הכל בונוס"));
const afternoonNotMet = buildAfternoonReminderFromData({
  priorityItems: [], ganttIsLight: true, monthName: "יולי", weeklyProgress: p1,
});
check("afternoon stays silent about the goal when not met", !(afternoonNotMet || "").includes("בונוס"));
check("afternoon focus/branch logic unchanged (gantt-light message still there)", (afternoonNotMet || "").includes("הגאנט קצת ריק"));

console.log(`\nWeekly progress QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
