// Final batch QA — covers the last five changes of the 12/07/2026 session:
// 1. Persona-free classifier calls (withPersona: false)
// 2. Audit F6 — bare "חדש" removed from edit_or_new clarification triggers
// 3. Audit F7 — bare "בצד" requires a put-aside verb, "בצד של" excluded
// 4. Audit F8 — AI visibility classifier skipped for deterministic commands
// 5. Routing trace — uniform handler + Claude-call-count log line
// Run: npx ts-node --transpile-only src/test/final-batch-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { isArchiveCommand } from "../services/confirmation.service";
import {
  startRoutingTrace,
  recordClaudeCall,
  finishRoutingTrace,
} from "../services/routing-trace.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf-8");

// --- 1. Persona-free classifiers ---
const claudeSource = read("../services/claude.service.ts");
check("askClaude supports withPersona option", claudeSource.includes("withPersona?: boolean") && claudeSource.includes("options.withPersona !== false"));
check("classifyMessageIntent is persona-free", read("../services/conversation-intent.service.ts").includes("withPersona: false"));
check("askClaudeForVisibilityIntent is persona-free", read("../services/visibility.service.ts").includes("withPersona: false"));

// --- 2. F6: clarification triggers ---
const controllerSource = read("../controllers/whatsapp.controller.ts");
check("wantsNew no longer triggers on bare חדש", !controllerSource.includes('["לפתוח חדש", "חדש", "רעיון חדש"]'));
check("wantsNew uses explicit phrasings", controllerSource.includes('"לפתוח חדש", "רעיון חדש", "משהו חדש"'));

// --- 3. F7: isArchiveCommand behavior ---
check('archive: "תעבירי את שמלות לארכיון"', isArchiveCommand("תעבירי את שמלות לארכיון") === true);
check('archive: "לשים את זה בצד בינתיים"', isArchiveCommand("לשים את זה בצד בינתיים") === true);
check('archive: "תשמרי את הרעיון הזה בצד"', isArchiveCommand("תשמרי את הרעיון הזה בצד") === true);
check('not archive: "לשים דגש בצד של ההורים" (positional בצד של)', isArchiveCommand("רעיון לסרטון, לשים דגש בצד של ההורים") === false);
check('not archive: "יש נקודה חשובה בצד המשפטי" (no verb)', isArchiveCommand("יש נקודה חשובה בצד המשפטי") === false);
check('not archive: plain new idea', isArchiveCommand("יש לי רעיון על נאום החתן") === false);

// --- 4. F8: skipAI gate ---
const visibilitySource = read("../services/visibility.service.ts");
check("detectVisibilityIntentWithAI accepts skipAI option", visibilitySource.includes("skipAI?: boolean") && visibilitySource.includes("if (options.skipAI) return null;"));
check("controller computes deterministic-command gate", controllerSource.includes("matchesDeterministicCommand") && controllerSource.includes("skipAI: matchesDeterministicCommand"));

// --- 5. Routing trace ---
const capturedLines: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => { capturedLines.push(args.join(" ")); };
startRoutingTrace("whatsapp:+qa", "יש לי רעיון חדש לבדיקת הטרייס");
recordClaudeCall("claude-sonnet-4-6", true);
recordClaudeCall("claude-haiku-4-5-20251001", false);
recordClaudeCall("claude-haiku-4-5-20251001", false);
finishRoutingTrace("draft_created");
console.log = originalLog;

const traceLine = capturedLines.find((l) => l.includes("[Routing Trace]")) || "";
check("trace line reports the handler", traceLine.includes("handler=draft_created"));
check("trace line reports total Claude calls", traceLine.includes("claudeCalls=3"));
check("trace line breaks calls down by tier", traceLine.includes("sonnet:1") && traceLine.includes("haiku:2"));
check("trace line includes text preview", traceLine.includes("לבדיקת הטרייס"));

// No active trace → safe no-ops
finishRoutingTrace("should_not_print");
recordClaudeCall("claude-sonnet-4-6", true);
check("finish/record without active trace are safe no-ops", true);

check("controller wraps res.json exactly once for tracing", (controllerSource.match(/finishRoutingTrace\(/g) || []).length === 1);
check("both Claude entry points record calls", (claudeSource.match(/recordClaudeCall\(/g) || []).length === 2);

console.log(`\nFinal batch QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
