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

console.log("Running gantt collision routing audit test...");

const collisionStart = source.indexOf('if (pendingQuestion?.questionType === "gantt_collision")');
const collisionEnd = source.indexOf('if (pendingQuestion?.questionType === "gantt_move_existing")', collisionStart);

assert(collisionStart !== -1 && collisionEnd !== -1, "Could not isolate gantt_collision handler.");

const collisionBranch = source.slice(collisionStart, collisionEnd);

assert(
  !collisionBranch.trimStart().startsWith('if (pendingQuestion?.questionType === "gantt_collision") {\\n      const { newContentId, newContentName, newDate, newDayName, existingContentId, existingName, ganttStatus } = pendingQuestion.context as any;\\n      clearPendingQuestion(sender);'),
  "gantt_collision must not clear pending question before understanding the answer."
);

assert(
  collisionBranch.includes("gantt_collision_unclear"),
  "gantt_collision must keep pending and answer clearly when the user response is unclear."
);

assert(
  collisionBranch.includes("isExplicitCommandWhileResolvingGanttCollision"),
  "gantt_collision must allow explicit management commands to escape the pending state."
);

assert(
  collisionBranch.includes("isArchiveCommand(incomingText)") &&
    collisionBranch.includes("isApproveForProductionCommand(incomingText)") &&
    collisionBranch.includes("isRestoreCommand(incomingText)") &&
    collisionBranch.includes("isDeadlineUpdate(incomingText)"),
  "gantt_collision explicit command escape must include archive, approve, restore, and deadline commands."
);

const moveStart = collisionEnd;
const moveEnd = source.indexOf('if (pendingQuestion?.questionType === "gantt_write_new_date")', moveStart);

assert(moveStart !== -1 && moveEnd !== -1, "Could not isolate gantt_move_existing handler.");

const moveBranch = source.slice(moveStart, moveEnd);

assert(
  moveBranch.includes('status: "gantt_move_invalid_date"'),
  "gantt_move_existing must explicitly handle invalid date input."
);

assert(
  moveBranch.includes("isExplicitCommandWhileMovingExistingGanttItem"),
  "gantt_move_existing must allow explicit management commands to escape the pending state."
);

assert(
  moveBranch.includes("isArchiveCommand(incomingText)") &&
    moveBranch.includes("isApproveForProductionCommand(incomingText)") &&
    moveBranch.includes("isRestoreCommand(incomingText)") &&
    moveBranch.includes("isDeadlineUpdate(incomingText)"),
  "gantt_move_existing explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  moveBranch.indexOf("isExplicitCommandWhileMovingExistingGanttItem") < moveBranch.indexOf("const confirmedSuggestedDate"),
  "Explicit command escape must run before interpreting the message as a move date."
);

console.log("✅ gantt-collision-routing-audit-test passed");
