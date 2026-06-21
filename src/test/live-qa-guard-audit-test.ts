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
];

console.log("Running live QA guard audit test...");

for (const fileName of liveQaFiles) {
  const source = fs.readFileSync(path.join(process.cwd(), fileName), "utf8");

  assert(
    source.includes("ALLOW_LIVE_QA"),
    `${fileName} must mention ALLOW_LIVE_QA.`
  );

  assert(
    source.includes("const requireLiveQaOptIn = () =>"),
    `${fileName} must define requireLiveQaOptIn.`
  );

  assert(
    source.includes("requireLiveQaOptIn();"),
    `${fileName} must call requireLiveQaOptIn before running.`
  );
}

console.log("✅ live-qa-guard-audit-test passed");
