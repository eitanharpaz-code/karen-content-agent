import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

// Stub outbound side effects and any sheets writes BEFORE importing the
// controller so the QA runs without touching Google Sheets or Twilio.
const whatsappService = require("../services/whatsapp.service");
whatsappService.sendWhatsAppMessage = async (_to: string, _message: string) => {
  // no-op
};

const sheetsService = require("../services/sheets.service");
if (sheetsService.findSimilarContentIdea) {
  sheetsService.findSimilarContentIdea = async () => null;
}

// Track archive calls so we can assert routing landed on the archive handler
// with the correct target name.
let archiveCalls: Array<{ spreadsheetId: string; contentName: string }> = [];
const originalArchive = sheetsService.archiveContentIdea;
sheetsService.archiveContentIdea = async (spreadsheetId: string, contentName: string) => {
  archiveCalls.push({ spreadsheetId, contentName });
  return { success: true, archivedName: contentName };
};

const { handleWhatsAppWebhook } = require("../controllers/whatsapp.controller");
const {
  clearPendingConfirmation,
  clearPendingQuestion,
  extractArchiveTarget,
} = require("../services/confirmation.service");
const { __resetHistoryForTests } = require("../services/conversation-memory.service");

const TEST_SENDER = "whatsapp:+9995556666";

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

const resetAll = () => {
  clearPendingConfirmation(TEST_SENDER);
  clearPendingQuestion(TEST_SENDER);
  __resetHistoryForTests(TEST_SENDER);
  archiveCalls = [];
};

const main = async () => {
  console.log("=== Archive Command QA ===\n");

  // ---- Unit: extractArchiveTarget with and without את ----
  console.log("Test 0: extractArchiveTarget — patterns");
  assert(
    "with 'את': 'תעבירי את שמלה קיצית לארכיון' → 'שמלה קיצית'",
    extractArchiveTarget("תעבירי את שמלה קיצית לארכיון") === "שמלה קיצית"
  );
  assert(
    "without 'את' (KAREN'S CASE): 'תעבירי זוגיות בזמן ארגון חתונה לארכיון' → 'זוגיות בזמן ארגון חתונה'",
    extractArchiveTarget("תעבירי זוגיות בזמן ארגון חתונה לארכיון") === "זוגיות בזמן ארגון חתונה"
  );
  assert(
    "without 'את': 'העבירי שמלה חורפית לארכיון' → 'שמלה חורפית'",
    extractArchiveTarget("העבירי שמלה חורפית לארכיון") === "שמלה חורפית"
  );
  assert(
    "without 'את' + בארכיון: 'תעבירי טרנד קיץ בארכיון' → 'טרנד קיץ'",
    extractArchiveTarget("תעבירי טרנד קיץ בארכיון") === "טרנד קיץ"
  );
  assert(
    "guard against zero-length target: 'תעבירי לארכיון' alone → null",
    extractArchiveTarget("תעבירי לארכיון") === null
  );

  // ---- E2E: Karen's exact live phrase now routes to archive ----
  console.log("\nTest 1: KAREN'S LIVE BUG — 'תעבירי X לארכיון' without 'את'");
  resetAll();
  const r1 = await sendMessage("תעבירי זוגיות בזמן ארגון חתונה לארכיון");
  console.log(`    → status=${r1?.status}`);
  console.log(`    → archiveContentIdea calls: ${archiveCalls.length}`);
  assert(
    "Routed to archive handler (not clarification)",
    r1?.status === "archived",
    `got status="${r1?.status}"`
  );
  assert(
    "archiveContentIdea called with correct target",
    archiveCalls.length === 1 && archiveCalls[0].contentName === "זוגיות בזמן ארגון חתונה",
    `calls=${JSON.stringify(archiveCalls)}`
  );

  // ---- E2E: message that used to be hijacked by isEditRequest ----
  console.log("\nTest 2: BUG 1 — archive body text with edit-indicator words no longer hijacked");
  resetAll();
  // "צריך" is in editIndicators list. Before the fix, this message was
  // caught by isEditRequest and returned the "לא בטוחה שתפסתי" menu.
  const r2 = await sendMessage("תעבירי את שמלה חורפית לארכיון, צריך החלטה");
  console.log(`    → status=${r2?.status}`);
  assert(
    "Routed to archive despite 'צריך' in body",
    r2?.status === "archived",
    `got status="${r2?.status}"`
  );
  assert(
    "Correct target extracted",
    archiveCalls.length === 1 && archiveCalls[0].contentName === "שמלה חורפית",
    `calls=${JSON.stringify(archiveCalls)}`
  );

  // ---- E2E: regression — original 'עם את' phrasing still works ----
  console.log("\nTest 3: REGRESSION — 'תעבירי את X לארכיון' (with את) still works");
  resetAll();
  const r3 = await sendMessage("תעבירי את טרנד קפריסין בקיץ לארכיון");
  console.log(`    → status=${r3?.status}`);
  assert(
    "'תעבירי את X לארכיון' still routes to archive",
    r3?.status === "archived"
  );
  assert(
    "Correct target extracted with 'את'",
    archiveCalls.length === 1 && archiveCalls[0].contentName === "טרנד קפריסין בקיץ"
  );

  // ---- E2E: archive command with 'אני רוצה' body no longer hijacked ----
  console.log("\nTest 4: BUG 1 — archive body with 'אני רוצה' no longer hijacked");
  resetAll();
  const r4 = await sendMessage("תעבירי שמלה קצרה לארכיון, אני רוצה להתקדם");
  console.log(`    → status=${r4?.status}`);
  assert(
    "Routed to archive despite 'אני רוצה' in body",
    r4?.status === "archived",
    `got status="${r4?.status}"`
  );

  // ---- Verify: 'ביטול' still clears state (Bug 3 safety) ----
  console.log("\nTest 5: 'ביטול' escape hatch still available");
  resetAll();
  const resetResp = await sendMessage("ביטול");
  assert(
    "'ביטול' returns state_reset",
    resetResp?.status === "state_reset"
  );

  // Cleanup + restore
  resetAll();
  sheetsService.archiveContentIdea = originalArchive;

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
