// Stage H QA — pending-state TTL (routing audit finding F0).
// Run: npx ts-node --transpile-only src/test/stage-h-ttl-qa.ts
//
// Verifies that pendingQuestion / pendingConfirmation entries expire after
// PENDING_STATE_TTL_MS, that legacy (pre-envelope) entries are grandfathered
// in, and that broken timestamps expire instead of living forever.
// NOTE: uses a dedicated test sender key, so it never touches Karen's state.

import {
  storePendingQuestion,
  getPendingQuestion,
  clearPendingQuestion,
  storePendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  PENDING_STATE_TTL_MS,
} from "../services/confirmation.service";
import { setValue } from "../services/persistence.service";

const user = "whatsapp:+ttl-qa-test";
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// 1. Fresh store → read returns value
storePendingQuestion(user, { questionType: "monthly_planning", context: { month: 7 } });
check("fresh pendingQuestion is returned", getPendingQuestion(user)?.questionType === "monthly_planning");

// 2. Expired envelope → read returns undefined and deletes the entry
const expiredTs = new Date(Date.now() - PENDING_STATE_TTL_MS - 60_000).toISOString();
setValue("pendingQuestions", user, { __envelope: true, storedAt: expiredTs, value: { questionType: "stale_q" } });
check("expired pendingQuestion treated as absent", getPendingQuestion(user) === undefined);
check("expired entry deleted (second read still absent)", getPendingQuestion(user) === undefined);

// 3. Legacy bare value (pre-TTL shape) → grandfathered in, still returned
setValue("pendingQuestions", user, { questionType: "legacy_q" });
check("legacy bare pendingQuestion still returned", getPendingQuestion(user)?.questionType === "legacy_q");
clearPendingQuestion(user);

// 4. Fresh pendingConfirmation
const draft: any = {
  shortName: "בדיקת TTL",
  category: "כללי",
  tone: "אותנטי",
  priority: "בינוני",
  contentType: "ריל",
  summary: "טיוטת בדיקה לטסט תפוגה",
};
storePendingConfirmation(user, draft);
check("fresh pendingConfirmation is returned", getPendingConfirmation(user)?.shortName === "בדיקת TTL");

// 5. Expired pendingConfirmation
setValue("pendingConfirmations", user, { __envelope: true, storedAt: expiredTs, value: draft });
check("expired pendingConfirmation treated as absent", getPendingConfirmation(user) === undefined);

// 6. Broken timestamp → expired, never immortal
setValue("pendingConfirmations", user, { __envelope: true, storedAt: "not-a-date", value: draft });
check("broken timestamp treated as expired", getPendingConfirmation(user) === undefined);

// 7. Just-under-TTL entry → still alive
const freshTs = new Date(Date.now() - PENDING_STATE_TTL_MS + 60_000).toISOString();
setValue("pendingConfirmations", user, { __envelope: true, storedAt: freshTs, value: draft });
check("entry just under TTL still returned", getPendingConfirmation(user)?.shortName === "בדיקת TTL");
clearPendingConfirmation(user);

console.log(`\nStage H TTL QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
