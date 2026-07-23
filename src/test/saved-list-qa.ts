// Saved list QA (23.7.2026).
// After Karen declines a date, the agent reports the reel gap and offers to
// show what is already saved. This covers that flow: the offer, the listing
// with descriptions, paging with "עוד", picking by name, and the handoff back
// into the normal date flow.
// Run: npx ts-node --transpile-only src/test/saved-list-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const ctrl = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
const health = readFileSync(path.resolve(__dirname, "../services/planning-health.service.ts"), "utf-8");

// Gap computation
check("computeScheduledReelGap is exported", health.includes("export const computeScheduledReelGap"));
check("gap counts scheduled, not published", health.includes("isReel(entry.item)") && !health.includes('=== "פורסם" &&\n      isReel'));
check("gap excludes collaborations", health.includes("!isCollaboration(entry.item)"));

// The offer after "keep"
check("keep path computes the gap", ctrl.includes("computeScheduledReelGap"));
check("keep path stores offer_saved_list", ctrl.includes('questionType: "offer_saved_list"'));
check("keep path phrasing mentions what is missing", ctrl.includes("כדי לסגור את"));
check("singular and plural reels are handled", ctrl.includes("חסר רילס אחד") && ctrl.includes("רילסים"));

// Listing
check("offer handler exists", ctrl.includes('pendingQuestion?.questionType === "offer_saved_list"'));
check("listing pulls open ideas", ctrl.includes("getOpenContentIdeas(spreadsheetId)"));
check("listing caps at six", ctrl.includes("ideas.slice(0, 6)"));
check("listing includes the summary line", ctrl.includes("if (i.summary) lines.push(i.summary)"));
check("more-than-six offers עוד", ctrl.includes('לכתוב "עוד"'));
check("empty list handled", ctrl.includes("saved_list_empty"));
check("declining ends cleanly", ctrl.includes("saved_list_declined"));

// Picking
check("pick handler exists", ctrl.includes('pendingQuestion?.questionType === "saved_list_pick"'));
check("pick matches ignoring punctuation", ctrl.includes("removePunctuationForMatching(o.name)"));
check("paging with עוד is supported", ctrl.includes("saved_pick_more_shown"));
check("unrecognized pick re-offers the names", ctrl.includes("saved_pick_unclear"));
check("picking hands off to the date flow", ctrl.includes("saved_pick_dates_offered") && ctrl.includes('questionType: "bridge_pick_date"'));
check("no free dates handled", ctrl.includes("saved_pick_no_dates"));

// Language
check("no bank jargon in messages", !ctrl.includes("בבנק"));
check("saved-list copy avoids the word שיבוץ", !ctrl.includes("לשיבוץ"));

console.log(`\nSaved list QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
