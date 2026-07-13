// Relaunch (12.7.2026) — category simplification QA.
// Product decision: topical categories are retired. New drafts are always
// "כללי"; the sponsored/organic distinction lives in the existing שת"פ
// column (auto-detected). Edits preserve the current category so the trend
// Fast Lane (hardcoded "טרנד") keeps working.
// Run: npx ts-node --transpile-only src/test/category-simplification-qa.ts

import { readFileSync } from "fs";
import path from "path";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

const contentSource = readFileSync(path.resolve(__dirname, "../services/content.service.ts"), "utf-8");
const controllerSource = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");

check("draft prompt no longer lists topical categories", !contentSource.includes("קפריסין, חתונה, שמלות"));
check('draft prompt fixes category to "כללי"', contentSource.includes('Category: [תמיד "כללי"'));
check("edit prompt preserves the current category", contentSource.includes("השאירי בדיוק את הקטגוריה הנוכחית"));
check('parser fallback to "כללי" still in place', contentSource.includes('categoryMatch?.[1] || "כללי"'));
check('trend Fast Lane hardcode untouched (category: "טרנד")', controllerSource.includes('category: "טרנד"'));
check("sponsored/organic auto-detection untouched in sheets.service", readFileSync(path.resolve(__dirname, "../services/sheets.service.ts"), "utf-8").includes("ממומן"));

console.log(`\nCategory simplification QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
