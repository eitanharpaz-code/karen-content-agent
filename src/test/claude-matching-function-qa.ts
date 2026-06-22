// Stage 2B — behavioral test for askClaudeForMatching, using a mocked
// fetch() so no real network call is made and no API cost is incurred.
//
// This test does NOT call the real Anthropic API. It does NOT call Google
// Sheets. It imports askClaudeForMatching directly and replaces global
// fetch with a controllable stand-in so we can simulate every Claude
// response shape we care about.
//
// Run with: npx ts-node --compiler-options '{"module":"CommonJS","types":["node"]}' src/test/claude-matching-function-qa.ts

import { askClaudeForMatching } from "../services/claude.service";
import type { MatchingClaudeContext } from "../types/claude-context.types";

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

// Minimal context shared across scenarios. Three candidates is enough to
// exercise "match found", "no match", and "out of range" cases.
const baseContext: MatchingClaudeContext = {
  kind: "matching",
  purpose: "production_task_match",
  query: "עריכת וידאו לרילס קפריסין",
  candidates: [
    { index: 11, label: "עריכת וידאו לרילס קפריסין" },
    { index: 22, label: "צילום סטוריז חתונה" },
    { index: 33, label: "פוסט שמלות חדש" },
  ],
  usesSystemPrompt: false,
  expectedReturn: "number_or_zero",
};

// Stand-in for the global fetch() used inside askClaudeForMatching. We swap
// this in before each scenario and restore the original afterwards so this
// test file doesn't leak a mocked fetch into any other test that might run
// in the same process.
const originalFetch = global.fetch;

type MockScenario = {
  description: string;
  // What "Claude" should appear to say back, or null to simulate a network
  // failure (the fetch call itself throwing).
  mockClaudeText: string | null;
  simulateThrow?: boolean;
};

const runScenario = async (
  scenario: MockScenario
): Promise<{ result: number | null; sentBody: any }> => {
  let capturedBody: any = null;

  global.fetch = (async (url: string, options: any) => {
    capturedBody = JSON.parse(options.body);

    if (scenario.simulateThrow) {
      throw new Error("simulated network failure");
    }

    return {
      json: async () => ({
        content: [{ type: "text", text: scenario.mockClaudeText }],
      }),
    } as any;
  }) as any;

  const result = await askClaudeForMatching(baseContext);
  return { result, sentBody: capturedBody };
};

const main = async (): Promise<void> => {
  console.log("=== askClaudeForMatching — Stage 2B behavioral audit ===\n");

  // -------------------------------------------------------------------
  // Scenario 1: Claude returns "1" -> first candidate should be matched.
  // -------------------------------------------------------------------
  {
    const { result, sentBody } = await runScenario({
      description: "Claude returns 1",
      mockClaudeText: "1",
    });

    check(
      'Claude response "1" resolves to the first candidate\'s index (11)',
      result === 11
    );

    const sentPrompt = sentBody?.messages?.[0]?.content ?? "";
    check(
      "Sent prompt does not contain the Karen persona / system prompt text",
      !sentPrompt.includes("Karen's personal content assistant")
    );
    check(
      'Sent prompt asks for a number only / "0"',
      sentPrompt.includes("רק מספר") && sentPrompt.includes('"0"')
    );
    check("Request uses max_tokens: 50 (matches existing matching functions)", sentBody?.max_tokens === 50);
  }

  // -------------------------------------------------------------------
  // Scenario 2: Claude returns "3" -> third candidate should be matched.
  // -------------------------------------------------------------------
  {
    const { result } = await runScenario({
      description: "Claude returns 3",
      mockClaudeText: "3",
    });

    check(
      'Claude response "3" resolves to the third candidate\'s index (33)',
      result === 33
    );
  }

  // -------------------------------------------------------------------
  // Scenario 3: Claude returns "0" -> no match, should return null.
  // -------------------------------------------------------------------
  {
    const { result } = await runScenario({
      description: "Claude returns 0",
      mockClaudeText: "0",
    });

    check('Claude response "0" returns null (no match)', result === null);
  }

  // -------------------------------------------------------------------
  // Scenario 4: Claude returns an out-of-range number -> should return
  // null rather than throwing or returning a wrong candidate.
  // -------------------------------------------------------------------
  {
    const { result } = await runScenario({
      description: "Claude returns 99 (out of range)",
      mockClaudeText: "99",
    });

    check(
      "Out-of-range Claude response (99) returns null, not a wrong candidate",
      result === null
    );
  }

  // -------------------------------------------------------------------
  // Scenario 5: Claude returns empty/unparseable text -> should return
  // null rather than throwing.
  // -------------------------------------------------------------------
  {
    const { result } = await runScenario({
      description: "Claude returns empty text",
      mockClaudeText: "",
    });

    check(
      "Empty Claude response returns null rather than throwing",
      result === null
    );
  }

  {
    const { result } = await runScenario({
      description: "Claude returns non-numeric text",
      mockClaudeText: "אין התאמה מתאימה",
    });

    check(
      "Non-numeric Claude response returns null rather than throwing",
      result === null
    );
  }

  // -------------------------------------------------------------------
  // Scenario 6: The fetch call itself fails (simulated network error) ->
  // should return null, matching the existing "no unsafe fallback"
  // behavior in sheets.service.ts (Stage E hardening).
  // -------------------------------------------------------------------
  {
    const { result } = await runScenario({
      description: "Network failure",
      mockClaudeText: null,
      simulateThrow: true,
    });

    check(
      "Network/API failure returns null, with no token-overlap fallback",
      result === null
    );
  }

  global.fetch = originalFetch;

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  global.fetch = originalFetch;
  console.error("Unexpected error while running claude-matching-function-qa:", error);
  process.exitCode = 1;
});
