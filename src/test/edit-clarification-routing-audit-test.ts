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

console.log("Running edit clarification routing audit test...");

assert(
  source.includes('pendingQuestion?.questionType === "edit_or_new_clarification"'),
  "Expected edit_or_new_clarification branch to exist."
);

const branchStart = source.indexOf('pendingQuestion?.questionType === "edit_or_new_clarification"');
const branchEnd = source.indexOf('if (pendingQuestion?.questionType === "overdue_reschedule_date")', branchStart);

assert(
  branchStart !== -1 && branchEnd !== -1,
  "Could not isolate edit_or_new_clarification branch."
);

const branch = source.slice(branchStart, branchEnd);

assert(
  branch.includes('status: "edit_or_new_clarification_still_unclear"'),
  "Unclear clarification answers must return edit_or_new_clarification_still_unclear."
);

assert(
  branch.includes('storePendingQuestion(sender, { questionType: "edit_or_new_clarification", context: {} })'),
  "Unclear clarification answers must keep the clarification pending."
);

assert(
  !branch.includes("clearPendingQuestion(sender);\n        console.log(`[Route Debug] edit_or_new_clarification: answer not understood, falling through`);"),
  "Unclear clarification answers must not clear pending question and fall through."
);

console.log("✅ edit-clarification-routing-audit-test passed");
