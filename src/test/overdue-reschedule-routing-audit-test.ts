declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const controllerPath = path.join(process.cwd(), "src/controllers/whatsapp.controller.ts");
const source = fs.readFileSync(controllerPath, "utf8");

console.log("Running overdue reschedule routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "overdue_reschedule_date")');
const end = source.indexOf('if (pendingQuestion?.questionType === "planning_source_routing")', start);

assert(start !== -1 && end !== -1, "Could not isolate overdue_reschedule_date handler.");

const branch = source.slice(start, end);

assert(
  branch.includes('status: "overdue_reschedule_invalid_date"'),
  "overdue_reschedule_date must explicitly handle invalid date input."
);

assert(
  branch.includes('status: "overdue_reschedule_date_taken"'),
  "overdue_reschedule_date must keep pending when target date is already taken."
);

assert(
  branch.includes('status: "overdue_rescheduled"') &&
    branch.includes("clearPendingQuestion(sender)") &&
    branch.includes("updateGanttRowDate"),
  "overdue_reschedule_date must clear pending only when a valid reschedule is applied."
);

assert(
  branch.includes("isExplicitCommandWhileChoosingOverdueRescheduleDate"),
  "overdue_reschedule_date must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "overdue_reschedule_date explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.includes('status: "overdue_reschedule_cancelled"'),
  "overdue_reschedule_date must allow cancelling the reschedule flow."
);

assert(
  branch.indexOf("isExplicitCommandWhileChoosingOverdueRescheduleDate") < branch.indexOf("const normalizedDate"),
  "Explicit command escape must run before interpreting the message as a date."
);

console.log("✅ overdue-reschedule-routing-audit-test passed");
