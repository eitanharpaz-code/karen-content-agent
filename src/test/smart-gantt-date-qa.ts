// Smart gantt date QA (step B, 21.7.2026) — organic-reel-only cadence rules.
// Layer 1: the two rules verified against scenarios with stories, posts and
// collabs present (all transparent). findSmartGanttDate needs live sheets I/O,
// so we test the exact rule predicate in isolation, and assert wiring at
// source level in Layer 2.
// Run: npx ts-node --transpile-only src/test/smart-gantt-date-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

const parseDate = (s: string): Date => { const [d,m,y] = s.split("/").map(Number); return new Date(y,m-1,d); };
const startOfWeek = (d: Date): Date => { const s=new Date(d); s.setDate(s.getDate()-s.getDay()); s.setHours(0,0,0,0); return s; };

const buildPasses = (rows: Array<[string,string,string]>) => {
  const organicReelDates: Date[] = [];
  for (const [dt,ct,cl] of rows) {
    if (ct === "ריל" && (cl === "" || cl === "לא")) organicReelDates.push(parseDate(dt));
  }
  const reelsPerWeek = new Map<number, number>();
  for (const d of organicReelDates) { const k = startOfWeek(d).getTime(); reelsPerWeek.set(k, (reelsPerWeek.get(k)||0)+1); }
  return { organicReelDates, passes: (cand: string) => {
    const d = parseDate(cand);
    if ((reelsPerWeek.get(startOfWeek(d).getTime())||0) >= 2) return false;
    for (const rd of organicReelDates) { if (Math.abs((d.getTime()-rd.getTime())/86400000) < 2) return false; }
    return true;
  }};
};

const base = buildPasses([
  ["21/07/2026","ריל","לא"],
  ["22/07/2026","סטורי","לא"],
  ["23/07/2026","פוסט","לא"],
  ["24/07/2026","ריל","כן"],
]);
check("only organic reels counted (story/post/collab transparent)", base.organicReelDates.length === 1);
check("Rule 2: 1 day after organic reel blocked", base.passes("22/07/2026") === false);
check("Rule 2: exactly 2 days after allowed", base.passes("23/07/2026") === true);
check("Rule 2: 1 day before organic reel blocked", base.passes("20/07/2026") === false);
check("story/post/collab dates don't block a new reel", base.passes("26/07/2026") === true);

const full = buildPasses([["20/07/2026","ריל","לא"],["22/07/2026","ריל","לא"]]);
check("Rule 1: week with 2 organic reels is full", full.passes("24/07/2026") === false);
check("Rule 1: next week is open", full.passes("28/07/2026") === true);

const controller = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("bridge imports findSmartGanttDate", controller.includes("findSmartGanttDate,"));
check("bridge calls findSmartGanttDate with the draft content type", controller.includes("forNewItemType: pendingDraft.contentType"));

const sheets = readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8");
check("smart function reads content type from column E", sheets.includes('const contentType = (row[4] || "").toString().trim()'));
check("smart function has plain-list fallback", sheets.includes("smart.length > 0 ? smart : plainAvailable"));

console.log(`\nSmart gantt date QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
