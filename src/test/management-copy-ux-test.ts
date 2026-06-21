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

console.log("Running management copy UX test...");

const managementStart = source.indexOf("if (isRestoreCommand(incomingText))");
const managementEnd = source.indexOf("// ===== PRODUCTION STATUS UPDATE CHECK", managementStart);

assert(
  managementStart !== -1 && managementEnd !== -1,
  "Could not isolate management command copy area."
);

const managementBlock = source.slice(managementStart, managementEnd);

assert(
  !managementBlock.includes("[שם הרעיון]"),
  "Management copy should not expose bracket template [שם הרעיון]."
);

assert(
  !managementBlock.includes("[שם הסרטון]"),
  "Management copy should not expose bracket template [שם הסרטון]."
);

assert(
  !managementBlock.includes("[תאריך]"),
  "Management copy should not expose bracket template [תאריך]."
);

assert(
  !managementBlock.includes("Content_ID"),
  "Management copy should not ask Karen to use technical Content_ID."
);

assert(
  managementBlock.includes("למשל:"),
  "Management copy should give natural examples using למשל."
);

console.log("✅ management-copy-ux-test passed");
