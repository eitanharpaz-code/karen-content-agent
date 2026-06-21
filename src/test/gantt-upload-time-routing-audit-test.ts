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

console.log("Running gantt upload time routing audit test...");

const start = source.indexOf('if (pendingQuestion?.questionType === "gantt_upload_time")');
const end = source.indexOf('if (pendingQuestion?.questionType === "confirm_gantt_write")', start);

assert(start !== -1 && end !== -1, "Could not isolate gantt_upload_time handler.");

const branch = source.slice(start, end);

assert(
  branch.includes('status: "gantt_upload_time_invalid"'),
  "gantt_upload_time must explicitly handle invalid time input."
);

assert(
  branch.indexOf('status: "gantt_upload_time_invalid"') < branch.indexOf("const normalizedUploadTime"),
  "Invalid time handling must happen before writing upload time."
);

assert(
  branch.includes("isExplicitCommandWhileChoosingUploadTime"),
  "gantt_upload_time must allow explicit management commands to escape the pending state."
);

assert(
  branch.includes("isArchiveCommand(incomingText)") &&
    branch.includes("isApproveForProductionCommand(incomingText)") &&
    branch.includes("isRestoreCommand(incomingText)") &&
    branch.includes("isDeadlineUpdate(incomingText)"),
  "gantt_upload_time explicit command escape must include archive, approve, restore, and deadline commands."
);

assert(
  branch.indexOf("isExplicitCommandWhileChoosingUploadTime") < branch.indexOf("const skipUploadTime"),
  "Explicit command escape must run before interpreting the message as upload-time input."
);

console.log("✅ gantt-upload-time-routing-audit-test passed");
