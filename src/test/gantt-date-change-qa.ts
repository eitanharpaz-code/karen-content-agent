// Gantt date-change QA (priority 1 from live logs, 21.7.2026).
// Layer 1 (behavioral): isGanttDateChange + extractGanttDateChange handle
// Karen's real phrasings — including the ones that previously fell through
// ("X שנה ל-29/7"). Layer 2 (source): the handler reuses existing functions,
// stops safely on a taken date, and has a follow-up handler for the answer.
// Run: npx ts-node --transpile-only src/test/gantt-date-change-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { isGanttDateChange, extractGanttDateChange } from "../services/confirmation.service";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Layer 1: detection (clean-state assumption — caller guarantees it) ---
check('detects "שנה תאריך של X ל-29/7/2026"', isGanttDateChange("שנה תאריך של שתפ תחתונים ל29/7/2026") === true);
check('detects "X שנה ל 29/07/2026" (no תאריך keyword)', isGanttDateChange("שתפ תחתונים ובושם שנה ל 29/07/2026") === true);
check('detects "שנה תאריך בגאנט X ל29/07/26"', isGanttDateChange("שנה תאריך בגאנט שתפ תחתונים ל29/07/26") === true);
check('detects "תזיז את סקויה ל25/7"', isGanttDateChange("תזיז את סקויה ל25/7") === true);
check('rejects a message with a verb but no date', isGanttDateChange("שנה טון למצחיק") === false);
check('rejects a message with a date but no move verb', isGanttDateChange("מה מתוכנן ב29/7") === false);

// --- Layer 1: extraction ---
const e1 = extractGanttDateChange("שנה תאריך של שתפ תחתונים ל29/7/2026");
check("extracts full 4-digit target date", e1?.targetDate === "29/7/2026");
check("extracts content name without scaffolding", (e1?.contentName || "").includes("שתפ תחתונים") && !(e1?.contentName || "").includes("תאריך") && !(e1?.contentName || "").includes("26"));
const e2 = extractGanttDateChange("שתפ תחתונים ובושם שנה ל 29/07/2026");
check("extraction works with trailing verb form", (e2?.contentName || "").includes("שתפ תחתונים ובושם"));

// --- Layer 2: handler wiring (source) ---
const src = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("handler reuses findProductionTaskByName", src.includes("findProductionTaskByName(spreadsheetId, change.contentName)"));
check("handler reuses updateGanttRowDate + sortGanttByDate", src.includes("updateGanttRowDate(spreadsheetId, targetContentId") && src.includes("sortGanttByDate(spreadsheetId)"));
check("handler checks collision via isGanttDateTaken", src.includes("isGanttDateTaken(spreadsheetId, normalizedTarget)"));
check("taken date stops safely — no auto-displace", src.includes("gantt_date_change_collision") && src.includes("never auto-displace"));
check("collision follow-up handler exists", src.includes('pendingQuestion?.questionType === "gantt_date_change_collision"'));
check("follow-up handles כן (find free date)", src.includes("findAvailableDatesInMonth") && src.includes("gantt_date_changed"));
check("follow-up handles an explicit alternative date", src.includes("explicitDate"));
check("follow-up handles rejection", src.includes("gantt_date_change_cancelled"));
check("handler handles not-scheduled case", src.includes("gantt_date_change_not_scheduled"));
check("handler handles ambiguous match", src.includes("gantt_date_change_ambiguous"));

console.log(`\nGantt date-change QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
