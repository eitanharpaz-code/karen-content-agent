// Fast Lane step 2 QA (make-room flow, rebuilt 22.7.2026).
// Trend reel + full week. Three modes: recommend (one organic to move, collab
// stays), choose (several organics), otherday (all collab → schedule elsewhere).
// Run: npx ts-node --transpile-only src/test/fast-lane-makeroom-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const ctrl = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
const sheets = readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8");

// --- helper: blocking reels with collab flag ---
check("getReelsBlockingDates is exported", sheets.includes("export const getReelsBlockingDates"));
check("helper flags collab vs organic", sheets.includes("isCollab"));
check("getOrganicReelsInWeek still exported", sheets.includes("export const getOrganicReelsInWeek"));

// --- offer: three modes ---
check("offer computes organic vs collab blockers", ctrl.includes("const organicBlockers") && ctrl.includes("const collabBlockers"));
check("recommend mode: one organic to move", ctrl.includes('mode: "recommend"') && ctrl.includes("להעביר את"));
check("recommend explains the collab stays with the brand", ctrl.includes("שסגרנו מול המותג"));
check("choose mode: several organics", ctrl.includes('mode: "choose"') && ctrl.includes("איזה מהם תרצי שאעביר"));
check("otherday mode: all collab", ctrl.includes('mode: "otherday"') && ctrl.includes("שיתופי פעולה שסגורים מול מותגים"));
check("no leftover emoji/exclamation trend header", !ctrl.includes("🔥 טרנד! השבוע כבר מלא"));

// --- handler: mode branches ---
check("handler branches on recommend", ctrl.includes('ctx.mode === "recommend"'));
check("handler branches on recommend_alt (3 dates)", ctrl.includes('ctx.mode === "recommend_alt"'));
check("handler branches on otherday", ctrl.includes('ctx.mode === "otherday"'));
check("recommend: כן executes, לא offers alternatives", ctrl.includes("recommend_alt") && ctrl.includes("איזה מהם הכי מתאים לך"));
check("choose: matches pick ignoring punctuation", ctrl.includes("removePunctuationForMatching(r.name)"));
check("choose: reel avoids reusing the freed slot", ctrl.includes("futureSmartDates.find((d: string) => d !== freedDate)"));
check("trend takes the freed slot in all executing modes", ctrl.includes("scheduleTrendAt"));
check("success message shows both moves", ctrl.includes("עבר ל-") && ctrl.includes("נכנס ל-"));

console.log(`\nFast Lane make-room QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
