// Content lookup QA (24.7.2026).
// "תזכיר לי את X" answers with the summary Karen forgot and offers the step
// that fits where the content actually is. Four states: waiting in the bank,
// in production without a date, scheduled, and not found. Each one hands off
// to a flow that already exists rather than duplicating it.
// Run: npx ts-node --transpile-only src/test/content-lookup-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { extractStatusQueryTarget } from "../services/visibility.service";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

// --- Recognition ---
const shouldExtract: Array<[string, string]> = [
  ["תזכיר לי את שטיקים של דודה", "שטיקים"],
  ["תזכירי לי את ספרייט", "ספרייט"],
  ["מה זה שתפ תחתונים", "תחתונים"],
  ["מה הרעיון של בייבי מכבי", "מכבי"],
  ["ספרי לי על ביזנס די לעוני", "ביזנס"],
  ["מה הסטטוס של להזכיר על צק", "צק"],
  ["מה מצב מימה", "מימה"],
];
for (const [msg, expectPart] of shouldExtract) {
  const got = extractStatusQueryTarget(msg);
  check(`"${msg}" → מזוהה`, Boolean(got && got.includes(expectPart)));
}

// Must NOT be treated as a content question
const shouldNotExtract = [
  "יש לי רעיון על חתונה",
  "צילמתי את ספרייט",
  "מה דחוף",
  "בוקר טוב",
];
for (const msg of shouldNotExtract) {
  check(`"${msg}" → לא שאלת תוכן`, extractStatusQueryTarget(msg) === null);
}

// --- Lookup wiring ---
const sheets = readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8");
check("lookupContentByName exported", sheets.includes("export const lookupContentByName"));
check("gantt row lookup by content id", sheets.includes("export const getGanttRowByContentId"));
check("searches the bank", sheets.includes("getOpenContentIdeas(spreadsheetId)"));
check("searches production", sheets.includes("SHEET_NAMES.productionTasks"));
check("pulls the summary from approved content", sheets.includes("SHEET_NAMES.approvedContent"));
check("production wins over the bank", sheets.includes("if (prodHits.length > 0)"));
check("exact name beats partial matches", sheets.includes("const exact = candidates.filter"));
check("returns all four states", ["waiting", "in_production", "scheduled", "not_found"].every((s) => sheets.includes(`"${s}"`)));

// --- Answer wiring ---
const ctrl = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("task_status uses the new lookup", ctrl.includes("lookupContentByName(spreadsheetId, target)"));
check("leads with the summary", ctrl.includes("const headline = found.summary"));
check("says רילס, not ריל", ctrl.includes('rawType === "ריל" ? "רילס"'));
check("waiting offers production", ctrl.includes("content_lookup_waiting") && ctrl.includes("רוצה להעביר אותו להפקה"));
check("scheduled gives no follow-up offer", ctrl.includes("content_lookup_scheduled"));
check("time appears only when set", ctrl.includes("found.uploadTime\n                ? `הוא מתוכנן לעלות") || ctrl.includes("found.uploadTime"));
check("no-date wording ties state to the missing date", ctrl.includes("רוצה שנמצא לו תאריך מתאים") && ctrl.includes("הוא כבר מוכן, אבל עדיין אין לו תאריך"));
check("ambiguous asks which", ctrl.includes("visibility_query_ambiguous") && ctrl.includes("לאיזה מהם התכוונת"));
check("not found offers the list", ctrl.includes("רוצה שאציג לך את התכנים ששמורים"));

// --- Follow-up wiring ---
check("follow-up handler exists", ctrl.includes('pendingQuestion?.questionType === "content_lookup_followup"'));
check("free-form answers go to Claude", ctrl.includes("askClaudeForBridgeIntent(incomingText)"));
check("declining ends cleanly", ctrl.includes("content_lookup_declined"));
check("waiting moves to production then continues", ctrl.includes("content_lookup_approve_failed") && ctrl.includes("let lookupContentId"));
check("uses the id the approve step produced", ctrl.includes("if (approved?.contentId) lookupContentId = approved.contentId"));
check("reuses bridge_pick_date for dates", ctrl.includes("content_lookup_dates_offered") && ctrl.includes('questionType: "bridge_pick_date"'));
check("already-approved skips a second approve", ctrl.includes("ctx.alreadyApproved") && ctrl.includes("alreadyApproved: true"));
check("not-found shows the list immediately", ctrl.includes("content_lookup_list_shown"));
check("list skips a summary identical to the name", ctrl.includes("i.summary !== i.idea"));

console.log(`\nContent lookup QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
