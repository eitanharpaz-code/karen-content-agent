/**
 * Stage F0 — New Idea Command Detection QA
 *
 * Tests isNewIdeaCommand / getNewIdeaText / getNewIdeaContentType against
 * real messages that previously failed in production (see WhatsApp logs
 * from 17-18.6.2026).
 *
 * Run with: npx ts-node src/test/sprint-f0-new-idea-qa.ts
 */

import {
  isNewIdeaCommand,
  getNewIdeaText,
  getNewIdeaContentType,
  isResetRequest,
} from "../services/confirmation.service";

type Test = {
  description: string;
  input: string;
  expectIsNewIdea: boolean;
  expectText?: string; // substring check, not exact match (idea text can be long)
  expectContentType?: "פוסט" | "ריל" | null;
};

const TESTS: Test[] = [
  // --- Real production failures (17.6.2026) ---
  {
    description: "רעיון חדש לסרטון + line break, no colon (real failure #1)",
    input: "רעיון חדש לסרטון \n על זה שאתה מקבל הצעת נישואין כשיש לך מלא חברים והכל שמח",
    expectIsNewIdea: true,
    expectText: "על זה שאתה מקבל הצעת נישואין",
    expectContentType: "ריל",
  },
  {
    description: "רעיון חדש (no qualifier), no colon, free text (real failure #2)",
    input: "רעיון חדש אתה מקבל הצעת נישואין כשיש לך מלא וחברים",
    expectIsNewIdea: true,
    expectText: "אתה מקבל הצעת נישואין",
    expectContentType: null,
  },

  // --- Existing supported formats must still work ---
  {
    description: "רעיון חדש: with colon (existing format)",
    input: "רעיון חדש: קונספט טעימות לחתונה",
    expectIsNewIdea: true,
    expectText: "קונספט טעימות לחתונה",
    expectContentType: null,
  },
  {
    description: "רעיון חדש לפוסט: with colon (existing format)",
    input: "רעיון חדש לפוסט: איך לבחור שמלה",
    expectIsNewIdea: true,
    expectText: "איך לבחור שמלה",
    expectContentType: "פוסט",
  },
  {
    description: "רעיון חדש לריל (no colon, exact existing format)",
    input: "רעיון חדש לריל",
    expectIsNewIdea: true,
    expectContentType: "ריל",
  },

  // --- Must NOT break isResetRequest ---
  {
    description: "Exact 'רעיון חדש' alone must stay a reset command, not new-idea",
    input: "רעיון חדש",
    expectIsNewIdea: false,
  },

  // --- Must NOT false-positive on unrelated messages ---
  {
    description: "Status question must not be detected as new idea",
    input: "מה הסטטוס של שמלה שלישית",
    expectIsNewIdea: false,
  },
  {
    description: "Plain greeting must not be detected as new idea",
    input: "בוקר טוב",
    expectIsNewIdea: false,
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const isNewIdea = isNewIdeaCommand(test.input);
  let ok = isNewIdea === test.expectIsNewIdea;
  const reasons: string[] = [];

  if (!ok) {
    reasons.push(`isNewIdeaCommand: expected ${test.expectIsNewIdea}, got ${isNewIdea}`);
  }

  if (ok && test.expectIsNewIdea && test.expectText !== undefined) {
    const extracted = getNewIdeaText(test.input);
    if (!extracted || !extracted.includes(test.expectText)) {
      ok = false;
      reasons.push(`getNewIdeaText: expected to include "${test.expectText}", got "${extracted}"`);
    }
  }

  if (ok && test.expectIsNewIdea && test.expectContentType !== undefined) {
    const contentType = getNewIdeaContentType(test.input);
    if (contentType !== test.expectContentType) {
      ok = false;
      reasons.push(`getNewIdeaContentType: expected ${test.expectContentType}, got ${contentType}`);
    }
  }

  // Cross-check: isResetRequest must never simultaneously fire for a real new-idea message
  if (ok && test.expectIsNewIdea) {
    const alsoReset = isResetRequest(test.input);
    if (alsoReset) {
      ok = false;
      reasons.push(`isResetRequest also returned true for a new-idea message — ambiguous routing`);
    }
  }

  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    reasons.forEach((r) => console.log(`   ↳ ${r}`));
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error("Some tests failed");
}
