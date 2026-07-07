// Stage 2A — static/audit contract test.
//
// This test does NOT call Claude, does NOT call Google Sheets, and does NOT
// import any production service module. It reads source files as plain text
// and checks, with targeted regex/string assertions, that the existing
// behavior matches the Drafting vs Matching Claude context contract defined
// in src/types/claude-context.types.ts.
//
// Run with: npx ts-node src/test/claude-context-contract-qa.ts

import { readFileSync } from "fs";
import path from "path";
import type {
  DraftingClaudeContext,
  MatchingClaudeContext,
  ClaudeMatchingCandidate,
} from "../types/claude-context.types";

const ROOT = path.resolve(__dirname, "..", "..");

const readSource = (relativePath: string): string =>
  readFileSync(path.join(ROOT, relativePath), "utf-8");

let passCount = 0;
let failCount = 0;

const check = (description: string, condition: boolean): void => {
  if (condition) {
    passCount += 1;
    console.log(`  PASS: ${description}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${description}`);
  }
};

console.log("=== Claude Context Contract — Stage 2A static audit ===\n");

// ---------------------------------------------------------------------------
// 1 & 2. sheets.service.ts must not touch the persona / askClaude at all.
// ---------------------------------------------------------------------------
console.log("[1-2] sheets.service.ts must not use persona or askClaude");

const sheetsServiceSource = readSource("src/services/sheets.service.ts");

check(
  "sheets.service.ts does not reference prompts/system-prompt.md",
  !sheetsServiceSource.includes("system-prompt.md")
);

// Stage 2 wiring update: sheets.service.ts is now ALLOWED (and required) to
// import askClaudeForMatching — the persona-free unified matching path. It
// must still never reference the drafting function askClaude itself.
check(
  "sheets.service.ts does not import or call askClaude (drafting path)",
  !/\baskClaude\b(?!ForMatching)/.test(sheetsServiceSource)
);

check(
  "sheets.service.ts imports askClaudeForMatching from claude.service",
  /import\s*\{\s*askClaudeForMatching\s*\}\s*from\s*["']\.\/claude\.service["']/.test(
    sheetsServiceSource
  )
);

// ---------------------------------------------------------------------------
// 3. The four matching functions must ask Claude for a number / 0 only.
// ---------------------------------------------------------------------------
console.log("\n[3] Matching functions must request number-or-zero only");

// Stage 2 wiring progress: functions move from `unwired` to `wired` one at
// a time. Wired functions must use askClaudeForMatching (no ad-hoc fetch);
// unwired functions must still match the original ad-hoc fetch contract.
const wiredMatchingFunctionNames = ["getContentIdeaSummary"];

const unwiredMatchingFunctionNames = [
  "findProductionTaskByName",
  "findSimilarContentIdea",
  "findApprovedContentByName",
];

const matchingFunctionNames = [
  ...wiredMatchingFunctionNames,
  ...unwiredMatchingFunctionNames,
];

const extractFunctionBody = (source: string, fnName: string): string => {
  const startMarker = new RegExp(
    `export const ${fnName}\\s*=`
  );
  const startMatch = startMarker.exec(source);
  if (!startMatch) return "";

  const startIndex = startMatch.index;

  // Find the next top-level `export const` / `export function` after this
  // one, and cut there — this is robust to functions of any length, unlike
  // a fixed character-count slice (which silently truncated longer
  // functions such as findProductionTaskByName).
  const nextExportMarker = /^export (const|function)\s/gm;
  nextExportMarker.lastIndex = startIndex + startMatch[0].length;
  const nextMatch = nextExportMarker.exec(source);

  const endIndex = nextMatch ? nextMatch.index : source.length;
  return source.slice(startIndex, endIndex);
};

for (const fnName of unwiredMatchingFunctionNames) {
  const body = extractFunctionBody(sheetsServiceSource, fnName);

  check(`${fnName} is found in sheets.service.ts`, body.length > 0);

  check(
    `${fnName} (unwired) calls fetch("https://api.anthropic.com/v1/messages")`,
    /fetch\(\s*["']https:\/\/api\.anthropic\.com\/v1\/messages["']/.test(body)
  );

  check(
    `${fnName} (unwired) instructs Claude to return only a number or "0"`,
    /רק מספר/.test(body) && /"0"/.test(body)
  );

  check(
    `${fnName} (unwired) parses the result with parseInt (number-only expectation)`,
    /parseInt\(resultText\)/.test(body)
  );
}

for (const fnName of wiredMatchingFunctionNames) {
  const body = extractFunctionBody(sheetsServiceSource, fnName);

  check(`${fnName} is found in sheets.service.ts`, body.length > 0);

  check(
    `${fnName} (wired) does NOT call fetch directly`,
    !/fetch\(\s*["']https:\/\/api\.anthropic\.com\/v1\/messages["']/.test(body)
  );

  check(
    `${fnName} (wired) calls askClaudeForMatching`,
    /askClaudeForMatching\(/.test(body)
  );

  check(
    `${fnName} (wired) builds a MatchingClaudeContext`,
    /MatchingClaudeContext/.test(body) && /kind:\s*"matching"/.test(body)
  );

  check(
    `${fnName} (wired) guards against a null match result`,
    /matchedIndex\s*!==\s*null/.test(body)
  );
}

// ---------------------------------------------------------------------------
// 4. Claude failure in matching must return null, not a token-overlap
//    fallback.
// ---------------------------------------------------------------------------
console.log(
  "\n[4] Matching functions must return null on Claude failure (no unsafe fallback)"
);

const extractCatchBlock = (body: string): string => {
  const catchMatch = /catch\s*\([^)]*\)\s*\{/.exec(body);
  if (!catchMatch) return "";

  // Walk forward from the opening brace, tracking brace depth, so the
  // extracted block is exactly the catch body — robust to any nested
  // `if { ... }` blocks inside the catch, unlike a single non-greedy regex.
  const openBraceIndex = catchMatch.index + catchMatch[0].length - 1;
  let depth = 0;
  for (let i = openBraceIndex; i < body.length; i += 1) {
    if (body[i] === "{") depth += 1;
    if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return body.slice(openBraceIndex, i + 1);
      }
    }
  }
  return "";
};

for (const fnName of matchingFunctionNames) {
  const body = extractFunctionBody(sheetsServiceSource, fnName);
  const catchBlock = extractCatchBlock(body);

  check(
    `${fnName} has a catch block`,
    catchBlock.length > 0
  );

  check(
    `${fnName} catch block returns null`,
    /return null;/.test(catchBlock)
  );

  check(
    `${fnName} catch block does not fall back to token overlap`,
    !/getTokenOverlapScore/.test(catchBlock)
  );
}

// ---------------------------------------------------------------------------
// 5. content.service.ts must still produce the exact parser labels.
// ---------------------------------------------------------------------------
console.log("\n[5] content.service.ts must keep the exact parser labels");

const contentServiceSource = readSource("src/services/content.service.ts");

const requiredParserLabels = [
  "Short Name",
  "Category",
  "Tone",
  "Priority",
  "Content Type",
  "Summary",
];

for (const label of requiredParserLabels) {
  check(
    `content.service.ts parses the "${label}" label`,
    contentServiceSource.includes(label)
  );
}

check(
  "content.service.ts calls askClaude (drafting uses the SDK + persona path)",
  /askClaude/.test(contentServiceSource)
);

// ---------------------------------------------------------------------------
// 6. system-prompt.md must still say Claude does not ask Karen to approve.
// ---------------------------------------------------------------------------
console.log(
  "\n[6] system-prompt.md must still instruct Claude not to ask for approval"
);

let systemPromptSource = "";
try {
  systemPromptSource = readSource("prompts/system-prompt.md");
} catch (error) {
  console.error(
    "  Could not read prompts/system-prompt.md from disk — this check will be reported as a failure."
  );
}

check(
  "prompts/system-prompt.md exists and was read",
  systemPromptSource.length > 0
);

check(
  'system-prompt.md instructs Claude not to ask Karen for approval inside the response',
  /Do not ask Karen to approve inside the Claude response/.test(
    systemPromptSource
  )
);

// ---------------------------------------------------------------------------
// 7. The new contract types must encode the right literals.
// ---------------------------------------------------------------------------
console.log("\n[7] claude-context.types.ts must encode the contract literals");

// These are type-level checks. If the project compiles (npx tsc --noEmit),
// the assignments below prove the literal types are exactly as specified.
// We also do a source-text check as a human-readable cross-check, since
// TypeScript's structural typing alone wouldn't catch a literal being
// loosened (e.g. usesSystemPrompt: boolean instead of true/false).

const claudeContextTypesSource = readSource(
  "src/types/claude-context.types.ts"
);

check(
  "DraftingClaudeContext encodes usesSystemPrompt: true",
  /usesSystemPrompt:\s*true;/.test(claudeContextTypesSource)
);

check(
  "MatchingClaudeContext encodes usesSystemPrompt: false",
  /usesSystemPrompt:\s*false;/.test(claudeContextTypesSource)
);

check(
  'MatchingClaudeContext encodes expectedReturn: "number_or_zero"',
  /expectedReturn:\s*"number_or_zero";/.test(claudeContextTypesSource)
);

// Type-level smoke check — will fail to compile under tsc --noEmit if the
// literal types are ever loosened away from true/false/"number_or_zero".
const draftingSample: DraftingClaudeContext = {
  kind: "drafting",
  purpose: "content_draft",
  userInput: "test",
  usesSystemPrompt: true,
  expectedParserLabels: requiredParserLabels,
};

const matchingCandidateSample: ClaudeMatchingCandidate = {
  index: 0,
  label: "test candidate",
};

const matchingSample: MatchingClaudeContext = {
  kind: "matching",
  purpose: "production_task_match",
  query: "test",
  candidates: [matchingCandidateSample],
  usesSystemPrompt: false,
  expectedReturn: "number_or_zero",
};

check(
  "DraftingClaudeContext sample value type-checks",
  draftingSample.usesSystemPrompt === true
);

check(
  "MatchingClaudeContext sample value type-checks",
  matchingSample.usesSystemPrompt === false &&
    matchingSample.expectedReturn === "number_or_zero"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);

if (failCount > 0) {
  process.exitCode = 1;
}
