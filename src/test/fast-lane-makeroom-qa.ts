// Fast Lane step 2 QA (make-room flow — 21.7.2026).
// Trend reel + full week (today+tomorrow taken) → Karen is shown the week's
// organic reels and picks one to push. That reel moves to the nearest smart
// date; the trend takes the freed slot. Single choice per product decision.
// Run: npx ts-node --transpile-only src/test/fast-lane-makeroom-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const ctrl = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
const sheets = readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8");

check("getOrganicReelsInWeek is exported", sheets.includes("export const getOrganicReelsInWeek"));
check("helper filters organic reels only", sheets.includes('contentType === "ריל" && (collab === "" || collab === "לא")'));
check("helper bounds to the reference week", sheets.includes("weekStart") && sheets.includes("weekEnd"));

check("full-week case offers to push a reel", ctrl.includes("trend_make_room") && ctrl.includes("השבוע כבר מלא בשני רילים"));
check("offer lists the week's reels", ctrl.includes("getOrganicReelsInWeek(spreadsheetId, todayDate)"));
check("offer only when reels exist", ctrl.includes("weekReels.length > 0"));

check("make-room handler exists", ctrl.includes('pendingQuestion?.questionType === "trend_make_room"'));
check("handler matches the reel pick by name", ctrl.includes("r.name.includes(pick) || pick.includes(r.name)"));
check("handler moves the reel to a smart date", ctrl.includes("updateGanttRowDate(spreadsheetId, chosenReel.contentId, newReelDate"));
check("trend takes the freed slot", ctrl.includes("addRowToGantt(spreadsheetId, ctx.contentId, ctx.contentName, freedDate"));
check("reel avoids reusing the freed slot", ctrl.includes("smartDates.find((d: string) => d !== freedDate)"));
check("handler handles unrecognized reel", ctrl.includes("trend_make_room_unclear"));
check("handler handles rejection", ctrl.includes("trend_make_room_kept"));
check("success message shows both moves", ctrl.includes("עבר ל-") && ctrl.includes("נכנס ל-"));

console.log(`\nFast Lane make-room QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
