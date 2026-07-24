// Bridge (bank→gantt) step 1 QA — 12.7.2026.
// Layer 1 (behavioral): classifyBridgeOfferAnswer resolves Karen's natural
// answers correctly, with keep-phrasings winning over schedule-phrasings
// ("לא לשבץ", "כן אבל לא עכשיו" → keep).
// Layer 2 (source): the controller has the bridge_offer modal handler with
// the sibling escape hatch, chains ONLY existing flows (approve → collision
// check → addRowToGantt → sort → gantt_upload_time), and the save block
// stores the offer while preserving the passive tail as fallback.
// Run: npx ts-node --transpile-only src/test/bridge-offer-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { classifyBridgeOfferAnswer } from "../services/confirmation.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Layer 1: answer classification ---
const cases: Array<[string, string]> = [
  ["כן", "schedule"],
  ["לשבץ", "schedule"],
  ["שבצי אותו", "schedule"],
  ["כן תשבצי", "schedule"],
  ["יאללה", "schedule"],
  ["בטח", "schedule"],
  ["להשאיר בבנק", "keep"],
  ["להשאיר", "keep"],
  ["בינתיים לא", "keep"],
  ["לא", "keep"],
  ["לא לשבץ", "keep"],
  ["כן אבל לא עכשיו", "keep"],
  ["אחר כך", "keep"],
  ["עזבי כרגע", "keep"],
  ["מה זה הרעיון הזה בכלל?", "unclear"],
  ["רגע, איזה תאריך אמרת?", "unclear"],
];
for (const [text, expected] of cases) {
  check(`"${text}" → ${expected}`, classifyBridgeOfferAnswer(text) === expected);
}

// --- Layer 2: source-level wiring ---
const controllerSource = readFileSync(
  path.resolve(__dirname, "../controllers/whatsapp.controller.ts"),
  "utf-8"
);

const handlerStart = controllerSource.indexOf('questionType === "bridge_offer"');
check("controller has a bridge_offer modal handler", handlerStart > -1);

const handlerBlock = controllerSource.slice(handlerStart, handlerStart + 4500);
check("handler has the sibling escape hatch", handlerBlock.includes("isExplicitCommandDuringBridgeOffer"));
check("schedule path reuses approveContentForProduction", handlerBlock.includes("approveContentForProduction(spreadsheetId, contentName)"));
check("schedule path reuses the collision check", controllerSource.includes("isGanttDateTaken(spreadsheetId, date)"));
check("date-pick path reuses addRowToGantt + sort", controllerSource.includes("bridge_pick_date") && controllerSource.includes("addRowToGantt(") && controllerSource.includes("sortGanttByDate(spreadsheetId)"));
check("date-pick path hands off to the existing upload-time question", controllerSource.includes('questionType: "gantt_upload_time"'));
check("collision falls into the existing gantt_collision flow", controllerSource.includes('questionType: "gantt_collision"'));
check("keep path leaves it without a date", controllerSource.includes("השארתי אותו כרגע בלי תאריך"));

check("save block stores a bridge_offer question", controllerSource.includes('questionType: "bridge_offer",'));
check("save block states the no-date case instead of teaching a command", controllerSource.includes("כרגע אין מקום פנוי בגאנט"));
check("free-date lookup failure is non-fatal (try/catch)", controllerSource.includes("keeping passive tail"));

console.log(`\nBridge offer QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
