import dotenv from "dotenv";
import { Request, Response } from "express";

dotenv.config();

// Stubs BEFORE importing the controller.
const whatsappService = require("../services/whatsapp.service");
let lastSentMessage = "";
whatsappService.sendWhatsAppMessage = async (_to: string, message: string) => {
  lastSentMessage = message;
};

const sheetsService = require("../services/sheets.service");
if (sheetsService.findSimilarContentIdea) {
  sheetsService.findSimilarContentIdea = async () => null;
}

// Track archive calls with source + contentId so we can assert the right
// per-item dispatch happens (library → archiveContentIdea path,
// approved → archiveContentByContentId path).
type ArchiveCall = { contentId?: string; source?: string; name?: string };
let archiveCalls: ArchiveCall[] = [];

const originalArchive = sheetsService.archiveContentIdea;
sheetsService.archiveContentIdea = async (_spreadsheetId: string, contentName: string) => {
  archiveCalls.push({ name: contentName });
  return { success: true, archivedName: contentName, source: "library" as const };
};

const originalArchiveById = sheetsService.archiveContentByContentId;
sheetsService.archiveContentByContentId = async (
  _spreadsheetId: string,
  contentId: string,
  source: "library" | "approved"
) => {
  archiveCalls.push({ contentId, source });
  return { success: true, archivedName: `archived-${contentId}` };
};

// Stub the fuzzy-match candidate fetcher so the QA runs without touching
// Google Sheets. FAKE_LIBRARY = ideas that live in בנק רעיונות,
// FAKE_APPROVED = ideas already moved to תכנים שאושרו.
const fuzzyMatchService = require("../services/fuzzy-match.service");
const FAKE_LIBRARY = [
  { source: "library", contentId: "L-001", idea: "זוגיות בזמן ארגון חתונה" },
  { source: "library", contentId: "L-002", idea: "מה עושים ביום לפני החתונה" },
  { source: "library", contentId: "L-003", idea: "מפגש ראשון עם ההורים בשמלת כלה" },
  { source: "library", contentId: "L-004", idea: "מהרגע שהציעו לי נישואים אני לא נחה" },
  { source: "library", contentId: "L-005", idea: "טרנד קפריסין בקיץ" },
];
const FAKE_APPROVED = [
  { source: "approved", contentId: "A-001", idea: "שמלה קיצית לחתונה בגן" },
  { source: "approved", contentId: "A-002", idea: "סרטון על שמלת כלה ויראלית" },
];

const originalFetchCandidates = fuzzyMatchService.fetchArchivableCandidates;
fuzzyMatchService.fetchArchivableCandidates = async () => [
  ...FAKE_LIBRARY,
  ...FAKE_APPROVED,
];

const { handleWhatsAppWebhook } = require("../controllers/whatsapp.controller");
const {
  clearPendingConfirmation,
  clearPendingQuestion,
  isBulkArchiveCommand,
  extractBulkArchiveItems,
} = require("../services/confirmation.service");
const { __resetHistoryForTests } = require("../services/conversation-memory.service");
const { findBestFuzzyIdeaMatch } = require("../services/fuzzy-match.service");

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
  console.log("=== Bulk Archive QA (fuzzy match, no API) ===\n");

  // ---- Unit: detectors ----
  console.log("Test 0: isBulkArchiveCommand + extractBulkArchiveItems basics");
  assert(
    "Numbered list → true",
    isBulkArchiveCommand("תעבירי לארכיון:\n1. שמלה קיצית\n2. טרנד קפריסין")
  );
  assert(
    "Bulleted list → true",
    isBulkArchiveCommand("תעבירי לארכיון:\n* שמלה קיצית\n* טרנד קפריסין")
  );
  assert(
    "Only one item → false",
    !isBulkArchiveCommand("תעבירי לארכיון:\n1. שמלה קיצית")
  );
  const items = extractBulkArchiveItems("תעבירי לארכיון:\n1. שמלה\n2. טרנד\n3. סרטון");
  assert("Extracts 3 items", items.length === 3);

  // ---- Fuzzy match unit tests — the core of the fix ----
  console.log("\nTest 1: FUZZY MATCH — Karen's 3 items map to 3 DISTINCT candidates");
  const candidates = [...FAKE_LIBRARY, ...FAKE_APPROVED];
  const q1 = findBestFuzzyIdeaMatch("זוגיות בזמן ארגון חתונה - ריבים", candidates);
  const q2 = findBestFuzzyIdeaMatch("מה עושים ביום לפני החתונה", candidates);
  const q3 = findBestFuzzyIdeaMatch("מפגש ראשון עם ההורים בשמלת כלה", candidates);
  console.log(`    → q1 → "${q1?.candidate.idea}" (score=${q1?.score})`);
  console.log(`    → q2 → "${q2?.candidate.idea}" (score=${q2?.score})`);
  console.log(`    → q3 → "${q3?.candidate.idea}" (score=${q3?.score})`);
  assert(
    "q1 matches 'זוגיות בזמן ארגון חתונה'",
    q1?.candidate.contentId === "L-001"
  );
  assert(
    "q2 matches 'מה עושים ביום לפני החתונה'",
    q2?.candidate.contentId === "L-002"
  );
  assert(
    "q3 matches 'מפגש ראשון עם ההורים בשמלת כלה'",
    q3?.candidate.contentId === "L-003"
  );
  assert(
    "All 3 matched to DIFFERENT candidates (Karen's live bug fixed)",
    q1?.candidate.contentId !== q2?.candidate.contentId &&
      q2?.candidate.contentId !== q3?.candidate.contentId &&
      q1?.candidate.contentId !== q3?.candidate.contentId
  );

  // ---- Fuzzy match — nonsense query returns null ----
  console.log("\nTest 2: FUZZY MATCH — unrelated query returns null (no false-positive)");
  const nonsense = findBestFuzzyIdeaMatch("בננה על גלגלים", candidates);
  assert("Nonsense query → null", nonsense === null);

  // ---- Fuzzy match — approved-content is reachable ----
  console.log("\nTest 3: FUZZY MATCH — approved-content candidates are matchable");
  const approvedQuery = findBestFuzzyIdeaMatch("שמלה קיצית לחתונה בגן", candidates);
  assert(
    "Approved-content match found",
    approvedQuery?.candidate.contentId === "A-001"
  );
  assert(
    "Match source is 'approved'",
    approvedQuery?.candidate.source === "approved"
  );

  // ---- E2E: Karen's live bug reproduced with the FIXED flow ----
  console.log("\nTest 4: KAREN'S LIVE BUG — 3 items → 3 distinct matches → archive succeeds");
  resetAll();
  const step1 = await sendMessage(
    "תעבירי לארכיון:\n1. זוגיות בזמן ארגון חתונה - ריבים\n2. מה עושים ביום לפני החתונה\n3. מפגש ראשון עם ההורים בשמלת כלה"
  );
  console.log(`    → status=${step1?.status}, matched=${JSON.stringify(step1?.matched?.map((m: any) => m.name))}`);
  assert(
    "Bulk archive confirm sent",
    step1?.status === "bulk_archive_confirm"
  );
  assert(
    "Matched all 3",
    step1?.matched?.length === 3
  );
  assert(
    "3 distinct names in the matched list (not '3 identical' like the live bug)",
    new Set(step1.matched.map((m: any) => m.name)).size === 3
  );

  const step2 = await sendMessage("כן");
  assert(
    "Confirm executed",
    step2?.status === "bulk_archive_done"
  );
  assert(
    "3 archive calls made, each with a distinct contentId",
    archiveCalls.length === 3 &&
      new Set(archiveCalls.map((c) => c.contentId)).size === 3
  );
  assert(
    "All 3 archives went through the by-id path (source specified)",
    archiveCalls.every((c) => c.contentId && c.source === "library")
  );

  // ---- E2E: approved-content archive ----
  console.log("\nTest 5: APPROVED-CONTENT — Karen can archive items from תכנים שאושרו");
  resetAll();
  const app1 = await sendMessage(
    "תעבירי לארכיון:\n1. שמלה קיצית לחתונה בגן\n2. סרטון על שמלת כלה ויראלית"
  );
  assert(
    "Confirm sent",
    app1?.status === "bulk_archive_confirm" && app1?.matched?.length === 2
  );
  assert(
    "Both matched items marked as source=approved",
    app1.matched.every((m: any) => m.source === "approved")
  );

  const app2 = await sendMessage("כן");
  assert(
    "Approved archives dispatched via contentId path",
    archiveCalls.length === 2 &&
      archiveCalls.every((c) => c.source === "approved") &&
      new Set(archiveCalls.map((c) => c.contentId)).size === 2
  );

  // ---- E2E: partial match ----
  console.log("\nTest 6: PARTIAL MATCH — matched + unmatched split correctly");
  resetAll();
  const partial = await sendMessage(
    "תעבירי לארכיון:\n1. זוגיות בזמן ארגון חתונה\n2. משהו לא קיים בכלל בשם ייחודי"
  );
  assert(
    "One matched, one unmatched",
    partial?.matched?.length === 1 && partial?.unmatched?.length === 1
  );

  // ---- E2E: user cancels ----
  console.log("\nTest 7: User cancels — no archives happen");
  resetAll();
  await sendMessage("תעבירי לארכיון:\n1. זוגיות בזמן ארגון חתונה\n2. טרנד קפריסין בקיץ");
  const cancel = await sendMessage("לא");
  assert("Cancelled", cancel?.status === "bulk_archive_cancelled");
  assert("No archives executed", archiveCalls.length === 0);

  // ---- E2E: mid-flow ambiguous answer keeps state ----
  console.log("\nTest 8: Ambiguous answer preserves state, follow-up 'כן' still works");
  resetAll();
  await sendMessage("תעבירי לארכיון:\n1. זוגיות בזמן ארגון חתונה\n2. טרנד קפריסין בקיץ");
  const ambig = await sendMessage("אולי מחר");
  assert(
    "State preserved (bulk_archive_awaiting_confirmation)",
    ambig?.status === "bulk_archive_awaiting_confirmation"
  );
  const finalYes = await sendMessage("כן");
  assert(
    "Follow-up 'כן' executes",
    finalYes?.status === "bulk_archive_done" && archiveCalls.length === 2
  );

  // ---- Regression: single archive still works ----
  console.log("\nTest 9: REGRESSION — single-archive path unchanged");
  resetAll();
  const single = await sendMessage("תעבירי את זוגיות בזמן ארגון חתונה לארכיון");
  assert(
    "Single archive routes to 'archived'",
    single?.status === "archived"
  );

  // Cleanup + restore
  resetAll();
  sheetsService.archiveContentIdea = originalArchive;
  sheetsService.archiveContentByContentId = originalArchiveById;
  fuzzyMatchService.fetchArchivableCandidates = originalFetchCandidates;

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
