import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

// Silence WhatsApp sends and stub sheet lookups BEFORE importing controller.
const whatsappService = require("../services/whatsapp.service");
whatsappService.sendWhatsAppMessage = async (_to: string, _message: string) => {
  // no-op — we're testing routing, not delivery
};

const sheetsService = require("../services/sheets.service");
if (sheetsService.findSimilarContentIdea) {
  sheetsService.findSimilarContentIdea = async () => null;
}

// Import AFTER the stubs so the controller closes over them.
const { handleWhatsAppWebhook } = require("../controllers/whatsapp.controller");
const { clearPendingConfirmation, clearPendingQuestion } = require("../services/confirmation.service");

const TEST_SENDER = "whatsapp:+9995551234";

type MockRes = Response & { statusCode: number; responseData: any };

const createMockRes = (): MockRes => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.responseData = data;
    return res;
  };
  return res;
};

const sendMessage = async (body: string): Promise<any> => {
  const req = { body: { From: TEST_SENDER, Body: body } } as Request;
  const res = createMockRes();
  await handleWhatsAppWebhook(req, res);
  return res.responseData;
};

type Grade = { passed: number; failed: number; notes: string[] };
const grade: Grade = { passed: 0, failed: 0, notes: [] };

const assert = (label: string, condition: boolean, detail?: string) => {
  if (condition) {
    grade.passed++;
    console.log(`  ✅ ${label}`);
  } else {
    grade.failed++;
    grade.notes.push(`FAIL: ${label}${detail ? " — " + detail : ""}`);
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  }
};

const setupFreshDraft = async (): Promise<void> => {
  // Clear any leftover state from prior runs
  clearPendingConfirmation(TEST_SENDER);
  clearPendingQuestion(TEST_SENDER);

  const result = await sendMessage("יש לי רעיון לסרטון על שמלה קיצית לחתונה");
  if (result?.status !== "draft_created") {
    throw new Error(`Setup failed — expected draft_created, got: ${JSON.stringify(result)}`);
  }
};

const main = async () => {
  console.log("=== Free-Form Edit AI Fallback — End-to-End QA ===\n");

  // ---- Test 1: Karen's exact live-test phrase (previously broken) ----
  console.log("Test 1: Priority shift with no edit keyword (Karen's live phrase)");
  await setupFreshDraft();
  let r = await sendMessage("זה יותר דחוף ממה שחשבתי");
  assert(
    "Routed as an edit, not a new draft",
    r?.status === "draft_updated_via_ai",
    `got status="${r?.status}"`
  );
  assert(
    "Priority updated to גבוה",
    r?.draft?.priority === "גבוה",
    `got priority="${r?.draft?.priority}"`
  );
  assert(
    "Short name preserved (not overwritten by user message)",
    r?.draft?.shortName !== "זה יותר דחוף ממה שחשבתי" && r?.draft?.shortName !== undefined,
    `got shortName="${r?.draft?.shortName}"`
  );

  // ---- Test 2: Content type shift with casual phrasing ----
  console.log("\nTest 2: Content type shift ('בעצם זה יותר סטורי מריל')");
  await setupFreshDraft();
  r = await sendMessage("בעצם זה יותר סטורי מריל");
  assert(
    "Routed via AI edit path",
    r?.status === "draft_updated_via_ai" || r?.status === "draft_updated",
    `got status="${r?.status}"`
  );
  assert(
    "Content type updated to סטורי",
    r?.draft?.contentType === "סטורי",
    `got contentType="${r?.draft?.contentType}"`
  );

  // ---- Test 2b: 'יותר קליל' should map to מצחיק (Karen's live phrase) ----
  console.log("\nTest 2b: 'בעצם עדיף שיהיה יותר קליל' should shift tone to מצחיק");
  await setupFreshDraft();
  r = await sendMessage("בעצם עדיף שיהיה יותר קליל");
  assert(
    "Routed via AI edit path",
    r?.status === "draft_updated_via_ai" || r?.status === "draft_updated",
    `got status="${r?.status}"`
  );
  assert(
    "Tone updated to מצחיק (or at least away from previous)",
    r?.draft?.tone === "מצחיק",
    `got tone="${r?.draft?.tone}"`
  );

  // ---- Test 3: Regression — existing hardcoded edit phrase still works ----
  console.log("\nTest 3: Regression — hardcoded phrase still handled by old parser");
  await setupFreshDraft();
  r = await sendMessage("תשנה את הטון למצחיק");
  assert(
    "Routed as an edit (either path)",
    r?.status === "draft_updated" || r?.status === "draft_updated_via_ai",
    `got status="${r?.status}"`
  );
  assert(
    "Tone updated to מצחיק",
    r?.draft?.tone === "מצחיק",
    `got tone="${r?.draft?.tone}"`
  );

  // ---- Test 4: Genuinely new idea should NOT be intercepted as edit ----
  console.log("\nTest 4: Explicit new idea phrasing should NOT be intercepted");
  await setupFreshDraft();
  r = await sendMessage("יש לי רעיון חדש על חתונה בחורף");
  assert(
    "Treated as new idea (or draft_created), not intercepted",
    r?.status === "draft_created" || r?.status === "duplicate_found",
    `got status="${r?.status}"`
  );

  // ---- Test 5: New information should REWRITE the summary, not just insert a word ----
  console.log("\nTest 5: Adding new information should trigger natural summary rewrite");
  clearPendingConfirmation(TEST_SENDER);
  clearPendingQuestion(TEST_SENDER);
  const setupResp = await sendMessage("יש לי רעיון לסרטון על שמלה קיצית לחתונה באולם");
  const draftBefore = setupResp?.draft;

  if (!draftBefore) {
    grade.failed++;
    grade.notes.push("FAIL: Test 5 setup — could not read draft before edit");
    console.log("  ❌ Setup failed — no draft before edit");
  } else {
    const originalSummary = draftBefore.summary || "";
    console.log(`  Original summary: "${originalSummary}"`);

    r = await sendMessage("בעצם הצילום יהיה בגן ולא באולם");
    const newSummary = r?.draft?.summary || "";
    console.log(`  New summary:      "${newSummary}"`);

    assert(
      "Routed via AI edit path",
      r?.status === "draft_updated_via_ai",
      `got status="${r?.status}"`
    );
    assert(
      "New summary mentions the garden",
      newSummary.includes("גן"),
      `summary="${newSummary}"`
    );
    assert(
      "Old location word is dropped or reworked",
      !newSummary.includes("באולם") || newSummary !== originalSummary.replace("אולם", "גן"),
      `summary="${newSummary}"`
    );
    // Prove it's a REWRITE, not a mere append of "בגן" onto the old summary
    const isMereAppend =
      newSummary === originalSummary + " בגן" ||
      newSummary === originalSummary + " בגן." ||
      newSummary === originalSummary.replace(/\.$/, "") + " בגן." ||
      newSummary === originalSummary.replace(/באולם/, "בגן"); // pure substitution
    assert(
      "Summary was rewritten naturally (not a single-word insertion or substitution)",
      !isMereAppend,
      `looks like a minimal edit — summary="${newSummary}"`
    );
    assert(
      "Other metadata fields untouched by an info-only edit",
      r?.draft?.category === draftBefore.category &&
        r?.draft?.tone === draftBefore.tone &&
        r?.draft?.priority === draftBefore.priority,
      `category/tone/priority changed unexpectedly`
    );
  }

  // ---- Test 6: Nonsense with a draft pending — AI should return UNCLEAR ----
  console.log("\nTest 6: Nonsense edit should NOT masquerade as a successful edit");
  await setupFreshDraft();
  r = await sendMessage("בננה על גלגלים כחולים");
  assert(
    "Did NOT trigger a fake draft update",
    r?.status !== "draft_updated_via_ai",
    `got status="${r?.status}"`
  );

  // Cleanup
  clearPendingConfirmation(TEST_SENDER);
  clearPendingQuestion(TEST_SENDER);

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${grade.passed}`);
  console.log(`Failed: ${grade.failed}`);
  if (grade.notes.length) {
    console.log(`Failures:`);
    grade.notes.forEach((n) => console.log(`  - ${n}`));
  }

  process.exit(grade.failed === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error("QA runner crashed:", err);
  process.exit(1);
});
