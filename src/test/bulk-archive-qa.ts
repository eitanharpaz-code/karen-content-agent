import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

// Stubs BEFORE importing the controller.
const whatsappService = require("../services/whatsapp.service");
let lastSentMessage = "";
whatsappService.sendWhatsAppMessage = async (_to: string, message: string) => {
  lastSentMessage = message;
};

// Fake sheet: three known ideas. getContentIdeaSummary is stubbed to
// return a match when the query overlaps meaningfully with a real idea.
// This mimics the Claude-matching behavior without spending API tokens
// on every match (per-item AI calls in the real flow use Haiku and cost
// pennies, but the QA runs against a deterministic stub for stability).
const FAKE_IDEAS = [
  "שמלה קיצית לחתונה",
  "טרנד קפריסין בקיץ",
  "סרטון על שמלת כלה ויראלית",
];

const sheetsService = require("../services/sheets.service");
if (sheetsService.findSimilarContentIdea) {
  sheetsService.findSimilarContentIdea = async () => null;
}

let archiveCalls: string[] = [];
const originalArchive = sheetsService.archiveContentIdea;
sheetsService.archiveContentIdea = async (_spreadsheetId: string, contentName: string) => {
  archiveCalls.push(contentName);
  return { success: true, archivedName: contentName };
};

const originalGetSummary = sheetsService.getContentIdeaSummary;
sheetsService.getContentIdeaSummary = async (_spreadsheetId: string, searchName: string) => {
  const norm = searchName.trim().toLowerCase();
  // Overlap heuristic: shared substring of >=3 chars (a real name and the
  // user's query usually share a topical noun).
  const found = FAKE_IDEAS.find((idea) => {
    const ideaNorm = idea.toLowerCase();
    const tokens = norm.split(/\s+/).filter((t) => t.length >= 3);
    return tokens.some((t) => ideaNorm.includes(t));
  });
  return found ? { shortName: found, idea: found } : null;
};

const { handleWhatsAppWebhook } = require("../controllers/whatsapp.controller");
const {
  clearPendingConfirmation,
  clearPendingQuestion,
  isBulkArchiveCommand,
  extractBulkArchiveItems,
} = require("../services/confirmation.service");
const { __resetHistoryForTests } = require("../services/conversation-memory.service");

const TEST_SENDER = "whatsapp:+9995555555";

type MockRes = Response & { statusCode: number; responseData: any };
const createMockRes = (): MockRes => {
  const res: any = {};
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.responseData = data; return res; };
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
  archiveCalls = [];
};

const main = async () => {
  console.log("=== Bulk Archive QA ===\n");

  // ---- Unit: detectors ----
  console.log("Test 0: isBulkArchiveCommand — signal detection");
  assert(
    "Numbered list → true",
    isBulkArchiveCommand("תעבירי לארכיון:\n1. שמלה קיצית\n2. טרנד קפריסין")
  );
  assert(
    "Bulleted list → true",
    isBulkArchiveCommand("תעבירי לארכיון:\n* שמלה קיצית\n* טרנד קפריסין")
  );
  assert(
    "Only one item → false (single-archive path handles it)",
    !isBulkArchiveCommand("תעבירי לארכיון:\n1. שמלה קיצית")
  );
  assert(
    "Not an archive command at all → false",
    !isBulkArchiveCommand("מה בגאנט השבוע\n1. reel\n2. post")
  );

  // ---- Unit: item extraction ----
  console.log("\nTest 1: extractBulkArchiveItems — parsing");
  const items = extractBulkArchiveItems(
    "תעבירי לארכיון:\n1. שמלה קיצית לחתונה\n2. טרנד קפריסין בקיץ\n3. סרטון על שמלת כלה"
  );
  assert("Extracts 3 items", items.length === 3);
  assert("First: 'שמלה קיצית לחתונה'", items[0] === "שמלה קיצית לחתונה");
  assert("Second: 'טרנד קפריסין בקיץ'", items[1] === "טרנד קפריסין בקיץ");
  assert("Third: 'סרטון על שמלת כלה'", items[2] === "סרטון על שמלת כלה");

  const bulletItems = extractBulkArchiveItems(
    "תעבירי לארכיון:\n* שמלה\n- טרנד\n• סרטון"
  );
  assert("Bulleted variants also parse", bulletItems.length === 3);

  const trailingPunct = extractBulkArchiveItems(
    "תעבירי לארכיון:\n1. שמלה קיצית לחתונה?\n2. טרנד קפריסין!"
  );
  assert(
    "Trailing punctuation stripped",
    trailingPunct[0] === "שמלה קיצית לחתונה" && trailingPunct[1] === "טרנד קפריסין"
  );

  // ---- E2E: happy path — Karen's actual scenario ----
  console.log("\nTest 2: KAREN'S SCENARIO — bulk archive with list, confirm, execute");
  resetAll();
  const step1 = await sendMessage(
    "תעבירי לארכיון:\n1. שמלה קיצית לחתונה\n2. טרנד קפריסין בקיץ\n3. סרטון על שמלת כלה ויראלית"
  );
  console.log(`    → step1 status=${step1?.status}, matched=${JSON.stringify(step1?.matched)}, unmatched=${JSON.stringify(step1?.unmatched)}`);
  assert(
    "Step 1: bulk archive confirm prompt sent",
    step1?.status === "bulk_archive_confirm",
    `got status="${step1?.status}"`
  );
  assert(
    "Step 1: matched all 3 items",
    Array.isArray(step1?.matched) && step1.matched.length === 3
  );
  assert(
    "Step 1: no unmatched items",
    Array.isArray(step1?.unmatched) && step1.unmatched.length === 0
  );
  assert(
    "Step 1: archive NOT executed yet — waiting for confirmation",
    archiveCalls.length === 0
  );

  const step2 = await sendMessage("כן");
  console.log(`    → step2 status=${step2?.status}, archived=${JSON.stringify(step2?.archived)}, failed=${JSON.stringify(step2?.failed)}`);
  assert(
    "Step 2: bulk archive done",
    step2?.status === "bulk_archive_done"
  );
  assert(
    "Step 2: all 3 archives executed",
    archiveCalls.length === 3
  );
  assert(
    "Step 2: no failed archives",
    Array.isArray(step2?.failed) && step2.failed.length === 0
  );

  // ---- E2E: user cancels ----
  console.log("\nTest 3: User cancels the bulk archive");
  resetAll();
  await sendMessage("תעבירי לארכיון:\n1. שמלה קיצית\n2. טרנד קפריסין");
  const cancelResp = await sendMessage("לא");
  assert(
    "Cancel returns bulk_archive_cancelled",
    cancelResp?.status === "bulk_archive_cancelled"
  );
  assert(
    "No archives executed",
    archiveCalls.length === 0
  );

  // ---- E2E: partial match — some items don't exist in sheet ----
  console.log("\nTest 4: Some items not found in sheet — still confirm, mention unmatched");
  resetAll();
  const partial = await sendMessage(
    "תעבירי לארכיון:\n1. שמלה קיצית לחתונה\n2. משהו שלא קיים בשם ייחודי"
  );
  console.log(`    → matched=${JSON.stringify(partial?.matched)}, unmatched=${JSON.stringify(partial?.unmatched)}`);
  assert(
    "Confirm prompt sent even with partial match",
    partial?.status === "bulk_archive_confirm"
  );
  assert(
    "Matched 1 item",
    partial?.matched?.length === 1
  );
  assert(
    "Unmatched 1 item recorded",
    partial?.unmatched?.length === 1
  );

  // ---- E2E: no matches at all ----
  console.log("\nTest 5: No matches — no confirmation state stored");
  resetAll();
  const noMatch = await sendMessage(
    "תעבירי לארכיון:\n1. משהו שלא קיים\n2. גם זה לא קיים"
  );
  assert(
    "Returns bulk_archive_no_matches (not stuck in confirm state)",
    noMatch?.status === "bulk_archive_no_matches"
  );

  // ---- E2E: mid-flow ambiguous input → repeat prompt, don't lose state ----
  console.log("\nTest 6: Non-yes/no answer during confirmation → prompt again, keep state");
  resetAll();
  await sendMessage("תעבירי לארכיון:\n1. שמלה קיצית\n2. טרנד קפריסין");
  const ambig = await sendMessage("אולי מחר");
  assert(
    "Ambiguous answer → bulk_archive_awaiting_confirmation (state preserved)",
    ambig?.status === "bulk_archive_awaiting_confirmation"
  );
  const finalYes = await sendMessage("כן");
  assert(
    "Follow-up 'כן' still executes the archive",
    finalYes?.status === "bulk_archive_done" && archiveCalls.length === 2
  );

  // ---- Regression: single archive still works via extractArchiveTarget ----
  console.log("\nTest 7: REGRESSION — single archive unaffected");
  resetAll();
  const singleR = await sendMessage("תעבירי את שמלה קיצית לחתונה לארכיון");
  assert(
    "Single archive still routes to 'archived'",
    singleR?.status === "archived"
  );

  // Cleanup + restore
  resetAll();
  sheetsService.archiveContentIdea = originalArchive;
  sheetsService.getContentIdeaSummary = originalGetSummary;

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
