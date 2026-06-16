import { detectOverdueDecisionIntent } from "../services/overdue-decision.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

assert(
  detectOverdueDecisionIntent("עלה")?.type === "published",
  "short published reply closes the displayed overdue item"
);
assert(
  detectOverdueDecisionIntent("כבר העליתי")?.type === "published",
  "natural published reply is recognized"
);

const datedReschedule = detectOverdueDecisionIntent("לדחות ל-18/6");
assert(
  datedReschedule?.type === "reschedule" &&
    datedReschedule.dateText === "18/6",
  "reschedule reply keeps the requested date"
);

const missingDate = detectOverdueDecisionIntent("לדחות");
assert(
  missingDate?.type === "reschedule" &&
    missingDate.dateText === null,
  "reschedule without a date asks a follow-up"
);

assert(
  detectOverdueDecisionIntent("לארכיון")?.type === "archive",
  "archive reply closes the reminder loop"
);
assert(
  detectOverdueDecisionIntent("עוד לא")?.type === "undecided",
  "uncertain reply keeps the decision open"
);
assert(
  detectOverdueDecisionIntent("לא עלה") === null,
  "ambiguous negative reply is not treated as published or archived"
);
assert(
  detectOverdueDecisionIntent('העליתי את "תוכן אחר"') === null,
  "full status updates continue through the existing named-content flow"
);

console.log("\nOverdue decision scenarios passed.");
