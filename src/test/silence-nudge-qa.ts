// Silence nudge QA (23.7.2026).
// After two quiet days the evening reminder becomes a single small offer.
// Two shapes: unfilmed content that is close, or waiting ideas. Each one
// arms a follow-up so Karen's one-word answer lands in a real handler.
// Run: npx ts-node --transpile-only src/test/silence-nudge-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { buildSilenceNudge } from "../services/daily-brief.service";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const unfilmed = [{
  contentId: "GEN-013",
  displayTitle: "להזכיר על צק",
  ganttDate: "24/07/2026",
  daysUntilUpload: 1,
  filmed: "לא",
  edited: "לא",
  isPublished: false,
}] as any;

// Message selection
const a = buildSilenceNudge(unfilmed, 7, 1);
check("unfilmed content takes priority", a?.kind === "unfilmed");
check("unfilmed nudge carries the content id", a?.contentId === "GEN-013");
check("unfilmed nudge asks a real question", Boolean(a?.message.includes("להשאיר אותו כמו שהוא, או להעביר ליום אחר")));

const b = buildSilenceNudge([], 7, 1);
check("falls back to waiting ideas", b?.kind === "ideas");
check("singular reel phrasing", Boolean(b?.message.includes("חסר כרגע רילס אחד")));

const bb = buildSilenceNudge([], 7, 2);
check("plural reel phrasing", Boolean(bb?.message.includes("חסרים כרגע 2 רילסים")));

check("nothing to say returns null", buildSilenceNudge([], 0, 0) === null);
check("ideas nudge needs both a gap and saved ideas", buildSilenceNudge([], 0, 2) === null);

// Wiring
const brief = readFileSync(path.resolve(__dirname, "../services/daily-brief.service.ts"), "utf-8");
const sched = readFileSync(path.resolve(__dirname, "../services/scheduler.service.ts"), "utf-8");
const ctrl = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");

check("silence measured in days", brief.includes("getDaysSinceLastInteraction"));
check("triggers at two days", brief.includes("silentDays >= 2"));
check("guarded against repeat sends", brief.includes('getValue<string>("silenceNudge"'));
check("re-arms only after she writes again", brief.includes("alreadyNudged !== lastWrote"));

check("ideas nudge arms the saved list", sched.includes('questionType: "offer_saved_list"'));
check("unfilmed nudge arms its decision", sched.includes('questionType: "nudge_unfilmed_decision"'));

check("decision handler exists", ctrl.includes('pendingQuestion?.questionType === "nudge_unfilmed_decision"'));
check("keeping it is handled", ctrl.includes("nudge_kept_as_is"));
check("moving offers dates", ctrl.includes("nudge_move_dates_offered"));
check("move reuses the pick-date handler", ctrl.includes('mode: "move"') && ctrl.includes("gantt_date_moved"));
check("move updates instead of adding a row", ctrl.includes("updateGanttRowDate(spreadsheetId, ctx.contentId, chosen"));

console.log(`\nSilence nudge QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
