// Fast Lane QA (trend scheduling step 1 — 21.7.2026).
// Layer 1: expanded trend detection catches Karen's natural openers but not
// normal ideas that mention trends mid-sentence. Layer 2: source-level wiring
// of aggressive today/tomorrow scheduling + the follow-up handler.
// Run: npx ts-node --transpile-only src/test/fast-lane-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { isTrendCommand } from "../services/confirmation.service";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const trends = [
  "טרנד: ריקוד החתולים",
  "ראיתי טרנד מטורף של ריקוד",
  "תפסתי טרנד חדש",
  "יש לי טרנד בול בשבילנו",
  "טרנד לסטורי על בוקר",
  "יש טרנד חדש",
];
for (const t of trends) check(`trend detected: "${t}"`, isTrendCommand(t) === true);

const notTrends = [
  "יש לי רעיון לסרטון על איך טרנדים משפיעים על נוער",
  "רעיון: למה אנשים עוקבים אחרי טרנדים",
  "מה הטרנדים החמים החודש?",
  "צילמתי את הסרטון",
];
for (const t of notTrends) check(`NOT a trend command: "${t}"`, isTrendCommand(t) === false);

const src = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("trend drafts get aggressive scheduling branch", src.includes('const isTrendDraft = pendingDraft.category === "טרנד"'));
check("offers today/tomorrow", src.includes("היום") && src.includes("מחר") && src.includes("trend_schedule"));
check("story bypasses cadence (always offerable)", src.includes("isStory || !todayTaken"));
check("aggressive offer replaces the calm bridge (guard)", src.includes("if (!bridgeOfferLine) try"));
check("follow-up handler exists", src.includes('pendingQuestion?.questionType === "trend_schedule"'));
check("follow-up schedules via approve + addRowToGantt", src.includes("approveContentForProduction(spreadsheetId, ctx.contentName)") && src.includes("addRowToGantt(spreadsheetId, ctx.contentId"));
check("follow-up handles rejection (keeps in bank)", src.includes("trend_schedule_kept"));
check("follow-up handles explicit alternative date", src.includes("normalizeUserDateInput(explicit[0])"));
check("reel + taken date does not silently overwrite", src.includes("trend_schedule_taken"));
check("confirmation reminds to shoot/edit fast", src.includes("כדאי לצלם ולערוך מהר"));

console.log(`\nFast Lane QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
