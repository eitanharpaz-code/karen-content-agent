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

console.log("Running draft continuation routing audit test...");

assert(
  source.includes("if (existingDraft && isContinuation)"),
  "Expected controller to have an existingDraft continuation branch."
);

const continuationBranchStart = source.indexOf("if (existingDraft && isContinuation)");
const continuationBranchEnd = source.indexOf("// ===== FIX 5: Lightweight confidence gating", continuationBranchStart);

assert(
  continuationBranchStart !== -1 && continuationBranchEnd !== -1,
  "Could not isolate continuation branch."
);

const continuationBranch = source.slice(continuationBranchStart, continuationBranchEnd);

assert(
  continuationBranch.includes("const updatedDraft"),
  "Continuation branch must create an updatedDraft."
);

assert(
  continuationBranch.includes("storePendingConfirmation(sender, updatedDraft)"),
  "Continuation branch must store updatedDraft so the later confirmation saves the updated version."
);

assert(
  continuationBranch.includes("buildDraftPreviewMessage(updatedDraft"),
  "Continuation branch must preview updatedDraft, not the stale existingDraft."
);

assert(
  continuationBranch.includes('status: "draft_continuation_updated"'),
  "Continuation branch must return draft_continuation_updated."
);

assert(
  continuationBranch.includes("draft: updatedDraft"),
  "Continuation response must return updatedDraft."
);

assert(
  !continuationBranch.includes('status: "continuation_acknowledged"'),
  "Continuation branch must not keep the old continuation_acknowledged status."
);

console.log("✅ draft-continuation-routing-audit-test passed");
