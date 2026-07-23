// Bank->production QA (priority 3 from live logs, 21.7.2026).
// Layer 1: the expanded isApproveForProductionCommand catches Karen's real
// inflections ("תעביר", "העבר", "מאושר להפקה") without false-positiving on
// queries ("מה יש בהפקה"). Layer 2: the not-found path shows a pick list and
// stores approve_pick_idea; a pick handler exists BEFORE draft creation so a
// name reply approves rather than creating a duplicate.
// Run: npx ts-node --transpile-only src/test/approve-production-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { isApproveForProductionCommand } from "../services/confirmation.service";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const shouldDetect = [
  "תעביר את ספרייט להפקה",
  "תעביר את שתפ עם ספרייט להפקה",
  "שתפ עם ספרייט מאושר להפקה",
  "תוסיפי את רעיון אנשים שמתקשרים להפקה",
  "תעבירי להפקה",
  "העבר אותו להפקה",
];
for (const m of shouldDetect) check(`detects: "${m}"`, isApproveForProductionCommand(m) === true);

const shouldIgnore = ["מה יש בהפקה?", "מה בהפקה", "כמה תכנים בהפקה", "איזה רעיונות יש", "ערכתי את הסרטון"];
for (const m of shouldIgnore) check(`ignores query: "${m}"`, isApproveForProductionCommand(m) === false);

const src = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("not-found path shows the open ideas instead of 'try again'", src.includes("לאיזה מהם התכוונת?"));
check("not-found path stores approve_pick_idea", src.includes('questionType: "approve_pick_idea"'));
check("empty bank handled distinctly", src.includes("approve_not_found_empty"));
check("pick handler exists", src.includes('pendingQuestion?.questionType === "approve_pick_idea"'));
check("pick handler re-runs approveContentForProduction on the reply", src.includes("approveContentForProduction(spreadsheetId, incomingText.trim())"));
check("pick handler cancels on rejection", src.includes("approve_pick_cancelled"));
check("pick handler re-offers on repeated miss", src.includes("approve_pick_retry"));

const pickPos = src.indexOf('pendingQuestion?.questionType === "approve_pick_idea"');
const draftPos = src.lastIndexOf('status: "draft_created"');
check("pick handler is positioned before draft creation (no duplicate)", pickPos > -1 && pickPos < draftPos);

console.log(`\nBank->production QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
