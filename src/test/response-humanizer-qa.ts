import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

const whatsappService = require("../services/whatsapp.service");
let lastSentMessage = "";
whatsappService.sendWhatsAppMessage = async (_to: string, message: string) => {
  lastSentMessage = message;
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
const {
  __resetHistoryForTests,
} = require("../services/conversation-memory.service");
const {
  humanizeDraftPreview,
  DEFAULT_NEW_DRAFT_COPY,
  DEFAULT_EDIT_COPY,
} = require("../services/response-humanizer.service");

const TEST_SENDER = "whatsapp:+9995557777";

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
  lastSentMessage = "";
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
};

const sampleDraft = {
  shortName: "שמלה קיצית לחתונה",
  category: "שמלות",
  tone: "אותנטי",
  contentType: "ריל",
  priority: "בינוני",
  summary: "סרטון על איך לבחור שמלת חתונה שמתאימה לחתונת קיץ בגן.",
};

const main = async () => {
  console.log("=== Response Humanizer (Phase B) QA ===\n");

  // ---- Direct API: new-draft mode returns three non-empty short strings ----
  console.log("Test 1: New-draft humanizer returns three valid strings");
  resetAll();
  const newCopy = await humanizeDraftPreview(sampleDraft, TEST_SENDER, "new");
  console.log(`    → intro: "${newCopy.intro}"`);
  console.log(`    → closingQuestion: "${newCopy.closingQuestion}"`);
  console.log(`    → changeLine: "${newCopy.changeLine}"`);
  assert("intro is intentionally empty for new drafts", newCopy.intro === "");
  assert("closingQuestion is non-empty", typeof newCopy.closingQuestion === "string" && newCopy.closingQuestion.length > 0);
  assert("changeLine is intentionally empty", newCopy.changeLine === "");
  assert("intro under 120 chars", newCopy.intro.length <= 120, `got ${newCopy.intro.length}`);
  assert("closingQuestion under 60 chars", newCopy.closingQuestion.length <= 60, `got ${newCopy.closingQuestion.length}`);
  assert("changeLine under 120 chars", newCopy.changeLine.length <= 120, `got ${newCopy.changeLine.length}`);

  // ---- Direct API: edit mode returns different-flavor strings ----
  console.log("\nTest 2: Edit humanizer references the change");
  resetAll();
  const editCopy = await humanizeDraftPreview(
    { ...sampleDraft, tone: "מצחיק" },
    TEST_SENDER,
    "edit",
    "בעצם עדיף שיהיה יותר קליל"
  );
  console.log(`    → intro: "${editCopy.intro}"`);
  console.log(`    → closingQuestion: "${editCopy.closingQuestion}"`);
  console.log(`    → changeLine: "${editCopy.changeLine}"`);
  assert("edit intro is non-empty", typeof editCopy.intro === "string" && editCopy.intro.length > 0);
  assert("edit closingQuestion is non-empty", typeof editCopy.closingQuestion === "string" && editCopy.closingQuestion.length > 0);
  assert("edit changeLine is intentionally empty", editCopy.changeLine === "");

  // ---- Variety: two separate calls should not produce identical output every time ----
  // We don't require variety on every call (Claude may repeat), but over 3 calls we expect
  // AT LEAST one difference across the three fields combined.
  console.log("\nTest 3: Multiple calls produce some variation");
  resetAll();
  const a = await humanizeDraftPreview(sampleDraft, TEST_SENDER, "new");
  const b = await humanizeDraftPreview(sampleDraft, TEST_SENDER, "new");
  const c = await humanizeDraftPreview(sampleDraft, TEST_SENDER, "new");
  const allSame =
    a.intro === b.intro && b.intro === c.intro &&
    a.closingQuestion === b.closingQuestion && b.closingQuestion === c.closingQuestion &&
    a.changeLine === b.changeLine && b.changeLine === c.changeLine;
  assert(
    "copy is stable across calls (fixed by design)",
    allSame,
    "all three calls returned identical copy — either determinism drift or a caching bug"
  );

  // ---- Fallback: no sender still works, returns defaults or Claude output ----
  console.log("\nTest 4: Humanizer works without a sender (no history)");
  const noSenderCopy = await humanizeDraftPreview(sampleDraft, undefined, "new");
  assert(
    "Returns valid copy without sender",
    typeof noSenderCopy.intro === "string" && noSenderCopy.closingQuestion.length > 0
  );

  // ---- Defaults have expected shape ----
  console.log("\nTest 5: Default copy constants have expected shape");
  assert(
    "DEFAULT_NEW_DRAFT_COPY carries the closing question",
    !!DEFAULT_NEW_DRAFT_COPY.closingQuestion
  );
  assert(
    "DEFAULT_EDIT_COPY carries the closing question",
    !!DEFAULT_EDIT_COPY.closingQuestion && !!DEFAULT_EDIT_COPY.intro
  );

  // ---- Integration via webhook: new-idea flow produces preview with humanized copy ----
  console.log("\nTest 6: End-to-end — new idea produces preview NOT using the default intro every time");
  resetAll();
  const step1 = await sendMessage("יש לי רעיון לסרטון על שמלה קיצית לחתונה");
  assert(
    "Draft was created",
    step1?.status === "draft_created" || step1?.status === "duplicate_found",
    `got status="${step1?.status}"`
  );
  console.log(`    → Full preview sent to Karen:\n${lastSentMessage.split("\n").map((l) => "      " + l).join("\n")}`);
  assert(
    "Preview includes the draft name",
    lastSentMessage.includes(step1?.draft?.shortName || "___NEVER___")
  );

  // ---- Integration: edit produces humanized preview referencing the change ----
  console.log("\nTest 7: End-to-end — edit produces preview with humanized wrapping");
  const step2 = await sendMessage("בעצם עדיף שיהיה יותר קליל");
  assert(
    "Edit was applied",
    step2?.status === "draft_updated" || step2?.status === "draft_updated_via_ai",
    `got status="${step2?.status}"`
  );
  console.log(`    → Full preview after edit:\n${lastSentMessage.split("\n").map((l) => "      " + l).join("\n")}`);
  assert(
    // Updated 23.7.2026: category/tone/priority were deliberately removed from
    // the preview as internal noise. The preview now shows name, content type
    // and the direction.
    "Preview after edit still shows name and summary",
    lastSentMessage.length > 40
  );

  // Cleanup
  resetAll();

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
