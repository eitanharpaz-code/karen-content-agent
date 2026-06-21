declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sheetsPath = path.join(process.cwd(), "src/services/sheets.service.ts");
const source = fs.readFileSync(sheetsPath, "utf8");

console.log("Running Stage E Claude confidence audit test...");

const start = source.indexOf("export const findProductionTaskByName = async");
const end = source.indexOf("// Sprint 7: Update production status", start);

assert(start !== -1 && end !== -1, "Could not isolate findProductionTaskByName.");

const branch = source.slice(start, end);

assert(
  source.includes("PRODUCTION_MATCH_GENERIC_TOKENS"),
  "Stage E must define production-domain generic tokens that should not be enough for a Claude match."
);

assert(
  source.includes("hasMeaningfulProductionTaskOverlap"),
  "Stage E must define a helper that checks meaningful non-generic overlap before accepting Claude."
);

assert(
  branch.includes("hasMeaningfulProductionTaskOverlap(contentName, candidateName)"),
  "findProductionTaskByName must check meaningful overlap for the Claude-selected candidate."
);

assert(
  branch.indexOf("hasMeaningfulProductionTaskOverlap(contentName, candidateName)") <
    branch.indexOf("return { rowIndex: candidates[index].rowIndex, row: candidates[index].row }"),
  "Claude confidence guard must run before returning the selected production task row."
);

assert(
  branch.includes("Rejected weak Claude match") &&
    branch.includes("return null"),
  "Weak Claude matches must be rejected with null, not returned as production task matches."
);

console.log("✅ stage-e-claude-confidence-audit-test passed");
