// Stage G — Agent state persistence
//
// Problem this solves: pendingConfirmations, pendingQuestions and
// interactionLog were in-memory Maps, silently wiped on every server
// restart/redeploy — mid-conversation confirmations with Karen were lost.
//
// Design (per Stage G spec):
// - Single JSON file: data/agent-state.json (gitignored)
// - Synchronous FULL write on every mutation (simple > clever at this scale:
//   one user, tiny state). A real DB is deferred to Stage I (multi-user/SaaS).
// - Loaded synchronously at module import time, so state is hydrated before
//   any service can touch it. No changes to app.ts required.
//
// Robustness (beyond the original spec, approved 7.7.2026):
// - Atomic writes: write to a .tmp file then renameSync, so a crash
//   mid-write can never leave a half-written state file.
// - Corrupt-file recovery: if the file exists but cannot be parsed, it is
//   moved aside to agent-state.corrupt-<timestamp> and the server starts
//   with empty state. Losing state is acceptable; failing to boot is not.
//
// Dependency direction is strictly one-way: confirmation.service and
// daily-brief.service import this module; this module imports nothing from
// them (section values are typed as unknown here; callers own the types).

import fs from "fs";
import path from "path";

export type StateSection =
  | "pendingConfirmations"
  | "pendingQuestions"
  | "interactionLog"
  | "conversationHistory"
  | "silenceNudge";

type PersistedState = {
  silenceNudge: Record<string, unknown>;
  pendingConfirmations: Record<string, unknown>;
  pendingQuestions: Record<string, unknown>;
  interactionLog: Record<string, unknown>;
  conversationHistory: Record<string, unknown>;
  savedAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "agent-state.json");
const TMP_FILE = path.join(DATA_DIR, "agent-state.json.tmp");

const emptyState = (): PersistedState => ({
  silenceNudge: {},
  pendingConfirmations: {},
  pendingQuestions: {},
  interactionLog: {},
  conversationHistory: {},
  savedAt: new Date().toISOString(),
});

const loadStateFromDisk = (): PersistedState => {
  if (!fs.existsSync(STATE_FILE)) {
    console.log("[Persistence] No state file found — starting with empty state.");
    return emptyState();
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    // Minimal shape validation: every section must be a plain object.
    const sections: StateSection[] = [
      "silenceNudge",
      "pendingConfirmations",
      "pendingQuestions",
      "interactionLog",
      "conversationHistory",
    ];
    const state = emptyState();
    for (const section of sections) {
      if (parsed && typeof parsed[section] === "object" && parsed[section] !== null) {
        state[section] = parsed[section];
      }
    }

    const keyCounts = sections
      .map((s) => `${s}: ${Object.keys(state[s]).length}`)
      .join(", ");
    console.log(`[Persistence] State loaded from ${STATE_FILE} (${keyCounts})`);
    return state;
  } catch (error) {
    // Corrupt file: move it aside and boot clean rather than crashing.
    const corruptPath = path.join(
      DATA_DIR,
      `agent-state.corrupt-${Date.now()}`
    );
    try {
      fs.renameSync(STATE_FILE, corruptPath);
      console.error(
        `[Persistence] State file was corrupt — moved to ${corruptPath}. Starting with empty state. Error: ${error}`
      );
    } catch (renameError) {
      console.error(
        `[Persistence] State file corrupt AND could not be moved aside (${renameError}). Starting with empty state.`
      );
    }
    return emptyState();
  }
};

const saveStateToDisk = (): void => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    state.savedAt = new Date().toISOString();
    // Atomic write: tmp file + rename. rename on the same filesystem is
    // atomic, so readers can never observe a half-written file.
    fs.writeFileSync(TMP_FILE, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(TMP_FILE, STATE_FILE);
  } catch (error) {
    // A failed save must never crash the request that triggered it.
    // Worst case we degrade to pre-Stage-G behavior (state lost on restart).
    console.error(`[Persistence] Failed to save state: ${error}`);
  }
};

// Hydrated once, synchronously, at module import time.
const state: PersistedState = loadStateFromDisk();

export const getValue = <T>(section: StateSection, key: string): T | undefined => {
  return state[section][key] as T | undefined;
};

export const setValue = (section: StateSection, key: string, value: unknown): void => {
  state[section][key] = value;
  saveStateToDisk();
};

export const deleteValue = (section: StateSection, key: string): void => {
  if (key in state[section]) {
    delete state[section][key];
    saveStateToDisk();
  }
};

// Test-only helper: re-reads the file from disk into memory, simulating a
// process restart without actually restarting. Not used by production code.
export const __reloadFromDiskForTests = (): void => {
  const fresh = loadStateFromDisk();
  state.pendingConfirmations = fresh.pendingConfirmations;
  state.pendingQuestions = fresh.pendingQuestions;
  state.interactionLog = fresh.interactionLog;
  state.conversationHistory = fresh.conversationHistory;
};
