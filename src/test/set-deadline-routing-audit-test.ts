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

console.log("Running set deadline routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "set_deadline")');
const end = source.indexOf("if (pendingQuestion && isRejectionMessage(incomingText))", start);

assert(start !== -1 && end !== -1, "Could not isolate set_deadline handler.");

const branch = source.slice(start, end);

assert(
  branch.includes('status: "deadline_skipped"') &&
    branch.includes("clearPendingQuestion(sender)"),
  "set_deadline must allow skipping and clear the pending state."
);

assert(
  branch.includes('status: "deadline_invalid_date"'),
  "set_deadline must explicitly handle invalid date input."
);

assert(
  branch.includes('status: "deadline_set"') &&
    branch.includes("clearPendingQuestion(sender)") &&
    branch.includes("updateDeadline"),
  "set_deadline must clear pending only when a deadline is applied or skipped."
);

assert(
  branch.includes("isExplicitCommandWhileSettingDeadline"),
  "set_deadline must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "set_deadline explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.indexOf("isExplicitCommandWhileSettingDeadline") < branch.indexOf("if (isRejectionMessage(incomingText))"),
  "Explicit command escape must run before interpreting the message as a deadline reply."
);

console.log("✅ set-deadline-routing-audit-test passed");
