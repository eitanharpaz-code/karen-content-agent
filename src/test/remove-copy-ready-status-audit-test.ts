declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log("Running remove copy_ready production status audit test...");

const typePath = path.join(process.cwd(), "src/types/production-status.types.ts");
const statusServicePath = path.join(process.cwd(), "src/services/production-status.service.ts");

const typeSource = fs.readFileSync(typePath, "utf8");
const statusServiceSource = fs.readFileSync(statusServicePath, "utf8");

assert(
  !typeSource.includes('"copy_ready"'),
  "copy_ready must not remain in ProductionStatusType."
);

const expansionStart = statusServiceSource.indexOf("export const expandStatusTypesWithDependencies");
const expansionEnd = statusServiceSource.indexOf("export const detectStatusUpdate", expansionStart);

assert(
  expansionStart !== -1 && expansionEnd !== -1,
  "Could not isolate expandStatusTypesWithDependencies."
);

const expansion = statusServiceSource.slice(expansionStart, expansionEnd);

assert(
  !expansion.includes("copy_ready"),
  "copy_ready must not remain in production status expansion logic."
);

assert(
  !statusServiceSource.includes("statusType: \"copy_ready\""),
  "copy_ready must not remain as a production status mapping."
);

console.log("✅ remove-copy-ready-status-audit-test passed");
