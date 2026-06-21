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

console.log("Running monthly planning visibility guard test...");

const branchStart = source.indexOf('if (pendingQuestion?.questionType === "monthly_planning")');
const branchEnd = source.indexOf('if (pendingQuestion?.questionType === "gantt_upload_time")', branchStart);

assert(
  branchStart !== -1 && branchEnd !== -1,
  "Could not isolate monthly_planning branch."
);

const branch = source.slice(branchStart, branchEnd);

assert(
  branch.includes("monthlyPlanningVisibilityIntent"),
  "monthly_planning branch must detect visibility/helper questions before parsing content choices."
);

assert(
  branch.includes('status: "monthly_planning_visibility_query_guarded"'),
  "monthly_planning visibility/helper questions must return a guarded status."
);

assert(
  branch.includes('storePendingQuestion(sender, { questionType: "monthly_planning", context: { month, year, monthName, remainingContent } })'),
  "monthly_planning visibility/helper questions must keep monthly_planning pending."
);

const guardIndex = branch.indexOf("monthlyPlanningVisibilityIntent");
const choiceIndex = branch.indexOf("const normalizedChoice");

assert(
  guardIndex !== -1 && choiceIndex !== -1 && guardIndex < choiceIndex,
  "monthly_planning visibility guard must run before content-choice parsing."
);

console.log("✅ monthly-planning-visibility-guard-test passed");
