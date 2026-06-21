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

console.log("Running planning source routing pending audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "planning_source_routing")');
const end = source.indexOf("const duplicateSensitivePendingTypes", start);

assert(start !== -1 && end !== -1, "Could not isolate planning_source_routing handler.");

const branch = source.slice(start, end);

assert(
  branch.includes("handlePlanningSourceRoutingReply(state, incomingText)"),
  "planning_source_routing must route replies through handlePlanningSourceRoutingReply."
);

assert(
  branch.includes('result.action === "clarify"') &&
    branch.includes('questionType: "planning_source_routing"') &&
    branch.includes("context: state"),
  "planning_source_routing clarify responses must keep the pending state."
);

assert(
  branch.includes('result.action === "new_idea" || result.action === "cancelled"') &&
    branch.includes("clearPendingQuestion(sender)"),
  "planning_source_routing cancelled/new_idea responses must clear the pending state."
);

assert(
  branch.includes("isExplicitCommandWhilePlanningSourceRouting"),
  "planning_source_routing must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "planning_source_routing explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.indexOf("isExplicitCommandWhilePlanningSourceRouting") < branch.indexOf("handlePlanningSourceRoutingReply(state, incomingText)"),
  "Explicit command escape must run before interpreting the message as a planning-source reply."
);

console.log("✅ planning-source-routing-pending-audit-test passed");
