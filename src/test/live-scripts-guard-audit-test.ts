declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const liveQaFiles = [
  "src/test/sprint-7-qa.ts",
  "src/test/sprint-8-multi-status-qa.ts",
  "src/test/planning-routing-real-audit.ts",
  "src/test/production-timestamps-migration-preview.ts",
  "src/test/production-timestamps-test.ts",
];

const migrationFiles = [
  "src/test/production-timestamps-migration.ts",
];

console.log("Running live scripts guard audit test...");

for (const fileName of liveQaFiles) {
  const source = fs.readFileSync(path.join(process.cwd(), fileName), "utf8");

  assert(source.includes("ALLOW_LIVE_QA"), `${fileName} must mention ALLOW_LIVE_QA.`);
  assert(source.includes("requireLiveQaOptIn"), `${fileName} must define/call requireLiveQaOptIn.`);
}

for (const fileName of migrationFiles) {
  const source = fs.readFileSync(path.join(process.cwd(), fileName), "utf8");

  assert(
    source.includes("ALLOW_PRODUCTION_TIMESTAMPS_MIGRATION"),
    `${fileName} must mention ALLOW_PRODUCTION_TIMESTAMPS_MIGRATION.`
  );
  assert(source.includes("requireMigrationOptIn"), `${fileName} must define/call requireMigrationOptIn.`);
  assert(source.includes("production-timestamps-migration-preview"), `${fileName} must instruct preview first.`);
}

console.log("✅ live-scripts-guard-audit-test passed");
