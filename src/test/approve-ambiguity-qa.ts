// Approve ambiguity QA (name-recognition round B — 21.7.2026).
// When Karen's (often shortened) name matches 2+ bank ideas, the approve flow
// must ask which one instead of silently approving the first. A fully-typed
// exact name is unambiguous. A single partial match approves directly.
// Run: npx ts-node --transpile-only src/test/approve-ambiguity-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

type Idea = { idea: string };
const resolve = (bank: Idea[], target: string) => {
  const t = target.trim();
  const exact = bank.find((i) => i.idea.trim() === t);
  if (exact) return { kind: "exact", name: exact.idea };
  const partial = bank.filter((i) => i.idea.includes(t) || t.includes(i.idea.trim()));
  if (partial.length > 1) return { kind: "ask", options: partial.map((p) => p.idea) };
  if (partial.length === 1) return { kind: "single", name: partial[0].idea };
  return { kind: "none" };
};

const bank: Idea[] = [
  { idea: "בת זוג של אוהד מכבי" },
  { idea: "בייבי מכבי" },
  { idea: "ביזנס די לעוני" },
];

const many = resolve(bank, "מכבי");
check('"מכבי" → ask which (2 matches)', many.kind === "ask" && (many as any).options.length === 2);
check('exact full name → approve directly (no loop)', resolve(bank, "בת זוג של אוהד מכבי").kind === "exact");
check('single partial → approve directly', resolve(bank, "ביזנס").kind === "single");
check('no match → falls through (none)', resolve(bank, "חלום מתוק").kind === "none");
check('ask list contains both מכבי ideas', JSON.stringify((many as any).options).includes("בת זוג של אוהד מכבי") && JSON.stringify((many as any).options).includes("בייבי מכבי"));

const src = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("pre-check runs before approveContentForProduction", src.indexOf("מצאתי כמה רעיונות שמתאימים") < src.indexOf("result = await approveContentForProduction"));
check("ambiguous case reuses approve_pick_idea", src.includes('questionType: "approve_pick_idea"') && src.includes("approve_ambiguous_pick"));
check("exact name bypasses the ambiguity prompt", src.includes("const exactHit = bankIdeas.find"));
check("pre-check failure is non-fatal", src.includes("ambiguity pre-check failed, proceeding normally"));

console.log(`\nApprove ambiguity QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
