import { isUsableContentId } from "../services/sheets.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

assert(isUsableContentId("WED-006") === true, "real contentId is usable");
assert(isUsableContentId(" PRW-002 ") === true, "trimmed real contentId is usable");
assert(isUsableContentId("") === false, "empty contentId is not usable");
assert(isUsableContentId("   ") === false, "blank contentId is not usable");
assert(isUsableContentId("טרם תוכנן") === false, "placeholder contentId is not usable");

console.log("\nContent ID guard scenarios passed.");
