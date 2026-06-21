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

console.log("Running confirm gantt write routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "confirm_gantt_write")');
const end = source.indexOf('if (pendingQuestion?.questionType === "set_deadline")', start);

assert(start !== -1 && end !== -1, "Could not isolate confirm_gantt_write handler.");

const branch = source.slice(start, end);

assert(
  !branch.trimStart().startsWith('if (pendingQuestion?.questionType === "confirm_gantt_write") {\\n      const { contentId, contentName, date, dayName, ganttStatus, monthlyPlanning } = pendingQuestion.context as any;\\n      clearPendingQuestion(sender);'),
  "confirm_gantt_write must not clear pending question before understanding the answer."
);

assert(
  branch.includes("confirm_gantt_write_unclear"),
  "confirm_gantt_write must keep pending and answer clearly when the user response is unclear."
);

assert(
  branch.includes("isExplicitCommandWhileConfirmingGanttWrite"),
  "confirm_gantt_write must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "confirm_gantt_write explicit command escape must include archive, approve, restore, and deadline commands."
);

console.log("✅ confirm-gantt-write-routing-audit-test passed");
