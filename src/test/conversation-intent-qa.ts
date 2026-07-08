import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

const whatsappService = require("../services/whatsapp.service");
whatsappService.sendWhatsAppMessage = async (_to: string, _message: string) => {
  // no-op
};

const sheetsService = require("../services/sheets.service");
if (sheetsService.findSimilarContentIdea) {
  sheetsService.findSimilarContentIdea = async () => null;
}

const { handleWhatsAppWebhook } = require("../controllers/whatsapp.controller");
const {
  clearPendingConfirmation,
  clearPendingQuestion,
} = require("../services/confirmation.service");
const { classifyMessageIntent, isPureGreeting } = require("../services/conversation-intent.service");

const TEST_SENDER = "whatsapp:+9995559999";

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

const grade = { passed: 0, failed: 0, notes: [] as string[] };

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

const resetState = () => {
  clearPendingConfirmation(TEST_SENDER);
  clearPendingQuestion(TEST_SENDER);
};

// Statuses that mean "no new draft was created" — acceptable outcomes for
// non-idea messages. Different upstream handlers may catch the same message
// depending on state; all of them are fine as long as no draft was created.
const NON_DRAFT_STATUSES = new Set([
  "conversational_reply",
  "general_help",
  "meta_conversation",
  "unclear_message_help",
  "question_clarification",
]);

const main = async () => {
  console.log("=== Conversation Intent Classifier QA ===\n");

  // ---- Test 0: sync gate ----
  console.log("Test 0: Sync gate — isPureGreeting recognises common greetings");
  assert("'היי' pure greeting", isPureGreeting("היי"));
  assert("'שלום' pure greeting", isPureGreeting("שלום"));
  assert("'בוקר טוב' pure greeting", isPureGreeting("בוקר טוב"));
  assert("'תודה' pure greeting", isPureGreeting("תודה"));
  assert("'hi' pure greeting", isPureGreeting("hi"));
  assert(
    "greeting + content is NOT a pure greeting",
    !isPureGreeting("היי יש לי רעיון על שמלות")
  );

  // ---- Test 1: KAREN'S EXACT LIVE BUG — greeting with a pending draft ----
  // In production her state had a lingering pending draft, so
  // isGeneralChatOrHelpMessage was bypassed (`!existingDraft` gate) and
  // "היי" fell through to createContentDraft. The classifier must catch it.
  console.log("\nTest 1: KAREN'S LIVE BUG — 'היי' with a pending draft must NOT create a new draft");
  resetState();
  // Establish a pending draft first, exactly like Karen's session state
  const setupResp = await sendMessage("יש לי רעיון על שמלה קיצית");
  assert(
    "Setup: initial draft created",
    setupResp?.status === "draft_created" || setupResp?.status === "duplicate_found",
    `setup status="${setupResp?.status}"`
  );

  // Now send the greeting that broke live
  let r = await sendMessage("היי");
  console.log(`    → status=${r?.status}, intent=${r?.intent || "(n/a)"}`);
  assert(
    "'היי' did NOT create/overwrite a draft",
    r?.status !== "draft_created" && r?.status !== "draft_updated_via_ai",
    `got status="${r?.status}"`
  );
  assert(
    "'היי' routed via classifier (conversational_reply) — bug fix confirmed",
    r?.status === "conversational_reply",
    `got status="${r?.status}"`
  );

  // ---- Test 2: 'בוקר טוב' with a pending draft ----
  console.log("\nTest 2: 'בוקר טוב' with pending draft");
  resetState();
  await sendMessage("יש לי רעיון על שמלה קיצית");
  r = await sendMessage("בוקר טוב");
  console.log(`    → status=${r?.status}`);
  assert(
    "No draft created/overwritten",
    !["draft_created", "draft_updated_via_ai"].includes(r?.status),
    `got status="${r?.status}"`
  );
  assert(
    "Routed via classifier",
    r?.status === "conversational_reply",
    `got status="${r?.status}"`
  );

  // ---- Test 3: 'תודה' with a pending draft ----
  console.log("\nTest 3: 'תודה' with pending draft");
  resetState();
  await sendMessage("יש לי רעיון על שמלה קיצית");
  r = await sendMessage("תודה");
  console.log(`    → status=${r?.status}`);
  assert(
    "No draft created/overwritten",
    !["draft_created", "draft_updated_via_ai"].includes(r?.status),
    `got status="${r?.status}"`
  );

  // ---- Test 4: 'היי' with NO pending draft — any non-draft outcome is fine ----
  console.log("\nTest 4: 'היי' with no pending draft (upstream general_help may catch it)");
  resetState();
  r = await sendMessage("היי");
  console.log(`    → status=${r?.status}`);
  assert(
    "No draft created",
    NON_DRAFT_STATUSES.has(r?.status),
    `got status="${r?.status}"`
  );

  // ---- Test 5: Real new idea — must still create draft ----
  console.log("\nTest 5: Real new idea still creates draft");
  resetState();
  r = await sendMessage("יש לי רעיון לסרטון על שמלה קיצית לחתונה");
  assert(
    "Real idea → draft_created",
    r?.status === "draft_created" || r?.status === "duplicate_found",
    `got status="${r?.status}"`
  );

  // ---- Test 6: Bare idea (no "יש לי רעיון" prefix) still creates draft ----
  console.log("\nTest 6: Bare idea phrasing");
  resetState();
  r = await sendMessage("חשבתי לעשות סרטון על איך לבחור שמלה לחתונת חוץ");
  console.log(`    → status=${r?.status}`);
  assert(
    "Bare idea → draft_created (classifier must recognise it as new_idea)",
    r?.status === "draft_created" || r?.status === "duplicate_found",
    `got status="${r?.status}"`
  );

  // ---- Test 7: Bare idea with pending draft — this is where classifier is critical ----
  // With pending draft AND no "יש לי רעיון" marker, older behaviour would try to
  // apply as edit or fall through. We want new_idea to win.
  // (Depending on how similar/distinct the ideas are, could be draft_updated_via_ai
  //  as an edit — either way, no crash and no unclear/help response.)
  console.log("\nTest 7: Bare idea + existing draft → either edit-apply or new draft");
  resetState();
  await sendMessage("יש לי רעיון על שמלה קיצית");
  r = await sendMessage("חשבתי גם על סרטון על טרנד חדש בקפריסין");
  console.log(`    → status=${r?.status}`);
  assert(
    "Doesn't fall to help/unclear/conversational",
    !NON_DRAFT_STATUSES.has(r?.status),
    `got status="${r?.status}"`
  );

  // ---- Test 8: Direct classifier — explicit idea marker ----
  console.log("\nTest 8: Direct classifier — explicit idea");
  const explicitIdea = await classifyMessageIntent("יש לי רעיון על טרנד חדש בקפריסין");
  assert("Explicit idea → new_idea", explicitIdea === "new_idea", `got "${explicitIdea}"`);

  // ---- Test 9: Direct classifier — small talk ----
  console.log("\nTest 9: Direct classifier — small talk");
  const smallTalk = await classifyMessageIntent("איך היה הבוקר שלך?");
  assert(
    "Small talk → small_talk or greeting",
    smallTalk === "small_talk" || smallTalk === "greeting",
    `got "${smallTalk}"`
  );

  // Cleanup
  resetState();

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
