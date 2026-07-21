// Context resolution QA (name-recognition round, step A — 21.7.2026).
// Layer 1: the pronoun gate (looksLikePronounReference) fires on pronouns and
// NOT on real content names — the safety boundary that prevents guessing when
// Karen actually named something. Layer 2: source-level wiring — resolution is
// attempted before the ask-again fallback, retries the lookup, and never
// guesses. Layer 3: the service's own safety returns.
// Run: npx ts-node --transpile-only src/test/context-resolution-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { looksLikePronounReference } from "../services/context-resolution.service";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok?"✅":"❌"} ${n}`); };

// Includes normalized final-form spellings ("אותו גמ") — the detector strips
// final letters before this gate sees the text.
const pronouns = ["אותו גם", "אותו גמ", "אותו", "אותה", "את אותו", "זה", "אותם", "אותמ", "ההוא"];
for (const p of pronouns) check(`pronoun detected: "${p}"`, looksLikePronounReference(p) === true);

const names = ["סקויה", "בת זוג של אוהד", "שתפ עם יקב בזלת הגולן", "ביזנס די לעוני", "אותו סרטון על סקויה"];
for (const n of names) check(`real name NOT treated as pronoun: "${n}"`, looksLikePronounReference(n) === false);

const src = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
check("resolution attempted before the no-match fallback", src.includes("looksLikePronounReference(statusUpdate.contentName)") && src.includes("resolvePronounToRecentContent(sender, statusUpdate.contentName)"));
check("resolution retries the lookup with the resolved name", src.includes("findProductionTaskByName(spreadsheetId, resolvedName)"));
check("resolved name replaces the pronoun for the rest of the flow", src.includes("statusUpdate.contentName = resolvedName"));
check("only runs when nothing matched and not a fast-track", src.includes("!matchResult && !explicitFastTrack && looksLikePronounReference"));

const svc = readFileSync(path.resolve(__dirname, "../services/context-resolution.service.ts"), "utf-8");
check("returns null on empty history (no guess)", svc.includes("if (history.length === 0) return null;"));
check("returns null when Claude says לא-ידוע", svc.includes('answer === "לא-ידוע"'));
check("uses persona-free classifier call", svc.includes("withPersona: false") && svc.includes("CLASSIFIER_MODEL"));
check("guards against a chatty (too-long) reply", svc.includes("answer.length > 80"));

console.log(`\nContext resolution QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
