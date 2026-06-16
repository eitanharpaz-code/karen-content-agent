import { detectStatusUpdate } from "../services/production-status.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const expected = "לוקיישנ לחתונה קולאב עיריית תל אביב";

const cases = [
  "הסרטון לוקיישן לחתונה קולאב עיריית תל אביב עלה",
  "לוקיישן לחתונה קולאב עיריית תל אביב עלה לאוויר",
  "פרסמתי את לוקיישן לחתונה קולאב עיריית תל אביב",
  "העליתי את \"לוקיישן לחתונה קולאב עיריית תל אביב\"",
];

cases.forEach((text) => {
  const result = detectStatusUpdate(text);

  assert(result !== null, `status detected for: ${text}`);
  assert(result?.statusType === "uploaded", `uploaded detected for: ${text}`);
  assert(
    result?.contentName === expected,
    `content name cleaned for: ${text}. got "${result?.contentName}"`
  );
});

console.log("\nProduction status suffix scenarios passed.");
