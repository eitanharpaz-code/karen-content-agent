// Stage G — persistence.service behavioral audit
//
// Fully offline: no API key, no network, no Google Sheets. Uses a real
// temp file cycle in ./data. Run with:
// npx ts-node --compiler-options '{"module":"CommonJS","types":["node"]}' src/test/persistence-qa.ts
//
// IMPORTANT: this test moves any existing data/agent-state.json aside
// before running and restores it afterwards, so running it on a machine
// with live agent state is safe.

import fs from "fs";
import path from "path";
// Static import (dynamic import() requires explicit extensions under
// tsconfig module Node16). This means the module hydrates from whatever
// agent-state.json exists BEFORE the test moves it aside — harmless, since
// the test only uses fabricated keys (user-1, user-2), moves the real file
// aside before its first write, and restores it in the finally block.
import {
  getValue,
  setValue,
  deleteValue,
  __reloadFromDiskForTests,
} from "../services/persistence.service";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "agent-state.json");
const BACKUP_FILE = path.join(DATA_DIR, "agent-state.json.pre-test-backup");

let passCount = 0;
let failCount = 0;

const check = (description: string, condition: boolean): void => {
  if (condition) {
    passCount++;
    console.log(`  PASS: ${description}`);
  } else {
    failCount++;
    console.log(`  FAIL: ${description}`);
  }
};

const main = async (): Promise<void> => {
  console.log("=== persistence.service — Stage G behavioral audit ===\n");

  // ---- Protect any real state on this machine ----
  if (fs.existsSync(STATE_FILE)) {
    fs.renameSync(STATE_FILE, BACKUP_FILE);
    console.log("(existing agent-state.json moved aside for the test)\n");
  }

  try {
    // The module already hydrated from the real file (static import runs
    // first). Reload now that the real file is moved aside, so the test
    // starts from a clean slate.
    __reloadFromDiskForTests();

    // -----------------------------------------------------------------
    // [1] Basic roundtrip: set → file exists → get returns the value
    // -----------------------------------------------------------------
    console.log("[1] Basic set/get roundtrip and file creation");

    setValue("pendingQuestions", "user-1", {
      questionType: "confirm_deadline",
      context: { contentId: "PRW-014" },
    });

    check("state file is created on first write", fs.existsSync(STATE_FILE));

    const q = getValue<{ questionType: string; context?: Record<string, unknown> }>(
      "pendingQuestions",
      "user-1"
    );
    check("getValue returns the stored pendingQuestion", q?.questionType === "confirm_deadline");
    check(
      "nested context object survives storage",
      (q?.context as any)?.contentId === "PRW-014"
    );

    check(
      "getValue for a missing key returns undefined",
      getValue("pendingQuestions", "no-such-user") === undefined
    );

    // -----------------------------------------------------------------
    // [2] Restart simulation: reload from disk, state must survive
    // -----------------------------------------------------------------
    console.log("\n[2] Restart simulation (reload from disk)");

    setValue("pendingConfirmations", "user-1", {
      shortName: "רענון אישורי הגעה",
      category: "על החתונה",
      tone: "מצחיק",
      priority: "בינוני",
      summary: "סרטון על האובססיה לאתר אישורי ההגעה",
      originalUserInput: "רעיון על אישורי הגעה",
    });
    setValue("interactionLog", "whatsapp:+9725555", "2026-07-07");

    __reloadFromDiskForTests();

    check(
      "pendingConfirmation survives a simulated restart",
      getValue<any>("pendingConfirmations", "user-1")?.shortName === "רענון אישורי הגעה"
    );
    check(
      "pendingQuestion survives a simulated restart",
      getValue<any>("pendingQuestions", "user-1")?.questionType === "confirm_deadline"
    );
    check(
      "interactionLog entry survives a simulated restart",
      getValue<string>("interactionLog", "whatsapp:+9725555") === "2026-07-07"
    );

    // -----------------------------------------------------------------
    // [3] Deletion: deleted keys stay deleted after reload
    // -----------------------------------------------------------------
    console.log("\n[3] Deletion persists");

    deleteValue("pendingQuestions", "user-1");
    check(
      "deleted key is gone in memory",
      getValue("pendingQuestions", "user-1") === undefined
    );

    __reloadFromDiskForTests();
    check(
      "deleted key is still gone after a simulated restart",
      getValue("pendingQuestions", "user-1") === undefined
    );
    check(
      "other sections are untouched by the deletion",
      getValue<any>("pendingConfirmations", "user-1")?.shortName === "רענון אישורי הגעה"
    );

    // -----------------------------------------------------------------
    // [4] Corrupt file recovery: boot clean, move corrupt file aside
    // -----------------------------------------------------------------
    console.log("\n[4] Corrupt state file recovery");

    fs.writeFileSync(STATE_FILE, "{ this is not valid JSON !!!", "utf-8");
    __reloadFromDiskForTests();

    check(
      "corrupt file yields empty state instead of crashing",
      getValue("pendingConfirmations", "user-1") === undefined
    );

    const corruptFiles = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("agent-state.corrupt-"));
    check("corrupt file was moved aside for inspection", corruptFiles.length >= 1);

    // Clean up corrupt artifacts created by this test
    for (const f of corruptFiles) {
      fs.unlinkSync(path.join(DATA_DIR, f));
    }

    // -----------------------------------------------------------------
    // [5] Writes after recovery work normally
    // -----------------------------------------------------------------
    console.log("\n[5] Writes after recovery");

    setValue("interactionLog", "user-2", "2026-07-07");
    __reloadFromDiskForTests();
    check(
      "state written after corruption recovery persists",
      getValue<string>("interactionLog", "user-2") === "2026-07-07"
    );

    check(
      "no leftover tmp file after writes (atomic rename completed)",
      !fs.existsSync(path.join(DATA_DIR, "agent-state.json.tmp"))
    );
  } finally {
    // ---- Restore any real state ----
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
    if (fs.existsSync(BACKUP_FILE)) {
      fs.renameSync(BACKUP_FILE, STATE_FILE);
      console.log("\n(original agent-state.json restored)");
    }
  }

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error(`Unexpected error while running persistence-qa: ${error}`);
  process.exit(1);
});
