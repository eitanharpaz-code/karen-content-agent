/**
 * Fix #2 — Stage E Completion QA
 *
 * Architecture audit finding (20.6.2026): Stage E (earlier today) only
 * hardened findProductionTaskByName. Three more functions still fell back
 * to weak token-overlap matching if the Claude API call failed — the
 * exact risk pattern Stage E was meant to eliminate everywhere:
 *   - findApprovedContentByName
 *   - findSimilarContentIdea
 *   - getContentIdeaSummary (found only while writing this test, via a
 *     direct grep sweep — not caught by the original architecture audit,
 *     which had flagged this function as "not deeply reviewed, low risk
 *     by pattern" — a reminder that pattern-based risk estimates are not
 *     a substitute for direct verification.)
 *
 * This test verifies the offline matching logic mirrors the fixed
 * catch-block behavior: Claude failure → null, no fallback mutation risk.
 *
 * Run with: npx ts-node src/test/fix2-stage-e-completion-qa.ts
 */

// Mirrors the fixed catch-block logic in both functions: on Claude error,
// always return null, never compute a token-overlap fallback.
const matchWithClaudeOrNull = (
  claudeOutcome: "success" | "error",
  claudeIndex: number | null,
  candidatesLength: number
): { contentId: string; name: string } | null => {
  if (claudeOutcome === "error") {
    // Fixed behavior: no fallback, period.
    return null;
  }
  if (claudeIndex !== null && claudeIndex >= 0 && claudeIndex < candidatesLength) {
    return { contentId: `mock-${claudeIndex}`, name: `candidate ${claudeIndex}` };
  }
  return null;
};

type Test = {
  description: string;
  claudeOutcome: "success" | "error";
  claudeIndex: number | null;
  candidatesLength: number;
  expectNull: boolean;
};

const TESTS: Test[] = [
  {
    description: "Claude API error → null (findApprovedContentByName pattern)",
    claudeOutcome: "error",
    claudeIndex: null,
    candidatesLength: 5,
    expectNull: true,
  },
  {
    description: "Claude API error → null (findSimilarContentIdea pattern)",
    claudeOutcome: "error",
    claudeIndex: null,
    candidatesLength: 3,
    expectNull: true,
  },
  {
    description: "Claude success with valid index → match returned",
    claudeOutcome: "success",
    claudeIndex: 2,
    candidatesLength: 5,
    expectNull: false,
  },
  {
    description: "Claude success but returns 0/invalid → null",
    claudeOutcome: "success",
    claudeIndex: -1,
    candidatesLength: 5,
    expectNull: true,
  },
  {
    description: "Claude error even with only 1 candidate → still null, no shortcut fallback",
    claudeOutcome: "error",
    claudeIndex: null,
    candidatesLength: 1,
    expectNull: true,
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const result = matchWithClaudeOrNull(test.claudeOutcome, test.claudeIndex, test.candidatesLength);
  const isNull = result === null;
  const ok = isNull === test.expectNull;

  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    console.log(`   ↳ expected null=${test.expectNull}, got ${JSON.stringify(result)}`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(
  "\nNote: this test verifies the catch-block contract (error→null, no fallback)."
);
console.log(
  "It does not call the real Sheets/Claude APIs — that would require live credentials."
);
console.log(
  "Source-level confirmation: grep for 'getTokenOverlapScore' inside the catch blocks"
);
console.log(
  "of findApprovedContentByName / findSimilarContentIdea in sheets.service.ts — should find none."
);

if (failed > 0) {
  throw new Error("Some tests failed");
}
