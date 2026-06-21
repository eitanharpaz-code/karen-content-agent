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

console.log("Running gantt write new date routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "gantt_write_new_date")');
const end = source.indexOf('if (pendingQuestion?.questionType === "monthly_planning")', start);

assert(start !== -1 && end !== -1, "Could not isolate gantt_write_new_date handler.");

const branch = source.slice(start, end);

assert(
  branch.includes('status: "gantt_write_new_date_invalid_date"'),
  "gantt_write_new_date must explicitly handle unclear or invalid date input."
);

assert(
  branch.includes('questionType: "gantt_write_new_date"') &&
    branch.includes("context: originalContext") &&
    branch.indexOf("context: originalContext") < branch.indexOf('status: "gantt_write_new_date_invalid_date"'),
  "gantt_write_new_date must keep the pending state when date input is invalid."
);

assert(
  branch.includes("isExplicitCommandWhileChoosingGanttDate"),
  "gantt_write_new_date must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "gantt_write_new_date explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.indexOf("isExplicitCommandWhileChoosingGanttDate") < branch.indexOf('if (["ביטול"'),
  "Explicit command escape must run before interpreting the message as date-flow input."
);

console.log("✅ gantt-write-new-date-routing-audit-test passed");
