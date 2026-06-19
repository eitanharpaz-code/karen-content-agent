/**
 * Stage D — Planning Source Routing: ideaCta Echo Detection QA
 *
 * Real production failure (from WhatsApp logs, ~17.6.2026): the prompt
 * for "approvedUnscheduled" options offers the CTA "תראי לי רעיונות לריל"
 * as a way to skip to new-idea brainstorming. When the user typed that
 * exact text back, handlePlanningSourceRoutingReply did not recognize it
 * (it only checked numbered/named option matches and yes/no), and fell
 * through to "לא הצלחתי להבין איזו אפשרות לבחור."
 *
 * This test verifies the CTA is now recognized, and that pre-existing
 * paths (numeric choice, option-by-name, ambiguous, no-match) still work.
 *
 * Run with: npx ts-node src/test/sprint-d-planning-source-routing-qa.ts
 */

import {
  createPlanningSourceRoutingState,
  handlePlanningSourceRoutingReply,
  type PlanningSourceRoutingInput,
} from "../services/planning-source-routing.service";

const baseInput: PlanningSourceRoutingInput = {
  signalMessage: "השבוע חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [
    { contentId: "PRW-020", title: "מפגש ראשון עם ההורים בשמלת כלה" },
    { contentId: "PRW-021", title: "שמלת כלה ויראלית" },
    { contentId: "PRW-022", title: "בגדי התארגנות שתפ" },
    { contentId: "PRW-023", title: "תכשיטים מנוי של איתן" },
    { contentId: "PRW-024", title: "צילום שמלות" },
  ],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
};

type Test = {
  description: string;
  reply: string;
  expectAction: string;
};

const TESTS: Test[] = [
  // --- Real production failure ---
  {
    description: "Real failure — echoing the offered CTA 'תראי לי רעיונות לריל'",
    reply: "תראי לי רעיונות לריל",
    expectAction: "new_idea",
  },

  // --- Pre-existing behaviors must not regress ---
  {
    description: "Numeric choice '1' must still select the first option",
    reply: "1",
    expectAction: "selected",
  },
  {
    description: "Exact option name must still select",
    reply: "צילום שמלות",
    expectAction: "selected",
  },
  {
    description: "'לא' must still advance to next source / new_idea",
    reply: "לא",
    expectAction: "new_idea", // no other sources have options in this fixture, so it jumps straight to newIdea
  },
  {
    description: "Unrelated gibberish must still fall through to clarify",
    reply: "אקדבرا",
    expectAction: "clarify",
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const state = createPlanningSourceRoutingState(baseInput);
  const result = handlePlanningSourceRoutingReply(state, test.reply);
  const ok = result.action === test.expectAction;
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    console.log(`   ↳ expected action "${test.expectAction}", got "${result.action}"`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error("Some tests failed");
}
