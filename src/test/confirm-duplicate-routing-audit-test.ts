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

console.log("Running confirm duplicate routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "confirm_duplicate")');
const end = source.indexOf("if (pendingQuestion && isRejectionMessage(incomingText))", start);

assert(start !== -1 && end !== -1, "Could not isolate confirm_duplicate handler.");

const branch = source.slice(start, end);

assert(
  branch.includes("isExplicitCommandWhileConfirmingDuplicate"),
  "confirm_duplicate must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "confirm_duplicate explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.includes("isRejectionMessage(incomingText)") &&
    branch.includes('status: "duplicate_rejected"') &&
    branch.includes("clearPendingQuestion(sender)"),
  "confirm_duplicate must handle rejection directly and clear pending."
);

assert(
  branch.includes("isConfirmationMessage(incomingText)") &&
    branch.includes('status: "duplicate_confirmed_draft_created"') &&
    branch.includes("createContentDraft(originalInput)") &&
    branch.includes("storePendingConfirmation(sender, draftSummary)") &&
    branch.includes("clearPendingQuestion(sender)"),
  "confirm_duplicate must handle confirmation directly and create a draft."
);

assert(
  branch.includes('status: "confirm_duplicate_unclear"'),
  "confirm_duplicate must keep pending and answer clearly when the user response is unclear."
);

assert(
  branch.indexOf("isExplicitCommandWhileConfirmingDuplicate") < branch.indexOf("isRejectionMessage(incomingText)") &&
    branch.indexOf("isRejectionMessage(incomingText)") < branch.indexOf("isConfirmationMessage(incomingText)"),
  "confirm_duplicate must check explicit commands before yes/no handling."
);

console.log("✅ confirm-duplicate-routing-audit-test passed");
