declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log("Running remove copy visibility audit test...");

const visibilitySource = fs.readFileSync(
  path.join(process.cwd(), "src/services/visibility.service.ts"),
  "utf8"
);

const sheetsSource = fs.readFileSync(
  path.join(process.cwd(), "src/services/sheets.service.ts"),
  "utf8"
);

const controllerSource = fs.readFileSync(
  path.join(process.cwd(), "src/controllers/whatsapp.controller.ts"),
  "utf8"
);

assert(!visibilitySource.includes('"missing_copy"'), "missing_copy must not remain as a VisibilityIntent.");
assert(!visibilitySource.includes("copyPhrases"), "copyPhrases must not remain in visibility detection.");
assert(!visibilitySource.includes('stage: "copy"'), "category-stage copy filter must not remain.");
assert(!visibilitySource.includes("חסר קופי"), "visibility responses must not say missing copy.");
assert(!visibilitySource.includes("מה צריך קופי"), "visibility list title must not ask for copy.");
assert(!sheetsSource.includes("getTasksMissingCopy"), "getTasksMissingCopy must not remain.");
assert(!controllerSource.includes("getTasksMissingCopy"), "controller must not import or call getTasksMissingCopy.");
assert(
  controllerSource.includes("case \"missing_cover\"") &&
    controllerSource.includes("case \"not_uploaded\""),
  "nearby visibility routing cases must remain intact."
);

console.log("✅ remove-copy-visibility-audit-test passed");
