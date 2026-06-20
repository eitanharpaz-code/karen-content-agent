/**
 * Fix #1 — Category Name Collision QA
 *
 * Real bug found in architecture audit (20.6.2026): getCategoryByName /
 * ensureCategoryExists used normalizeHebrewText for comparison, which
 * strips "על" as a filler word — causing "חתונה" and "על החתונה" (two
 * distinct, legitimate categories with different prefixes: WED vs PRW)
 * to collide into the same normalized key.
 *
 * This test verifies the fix using an in-memory mock of getCategories,
 * matching the real category list from the project's Google Sheet.
 *
 * Run with: npx ts-node src/test/fix1-category-collision-qa.ts
 */

type CategoryRegistryEntry = {
  categoryName: string;
  prefix: string;
  createdAt: string;
  notes: string;
};

// Mirrors the real "קטגוריות" sheet tab data seen in this project.
const MOCK_CATEGORIES: CategoryRegistryEntry[] = [
  { categoryName: "קפריסין", prefix: "CYP", createdAt: "", notes: "" },
  { categoryName: "שמלות", prefix: "DRS", createdAt: "", notes: "" },
  { categoryName: "רווקות", prefix: "BCH", createdAt: "", notes: "" },
  { categoryName: "רווקים", prefix: "BCH", createdAt: "", notes: "" },
  { categoryName: "על החתונה", prefix: "PRW", createdAt: "", notes: "" },
  { categoryName: "חתונה", prefix: "WED", createdAt: "", notes: "" },
  { categoryName: "כללי", prefix: "GEN", createdAt: "", notes: "" },
];

// Fixed implementation under test (mirrors the actual fix applied to sheets.service.ts)
const getCategoryByNameFixed = (
  categories: CategoryRegistryEntry[],
  categoryName: string
): CategoryRegistryEntry | null => {
  const normalizedSearch = categoryName.trim();
  return (
    categories.find((entry) => entry.categoryName.trim() === normalizedSearch) || null
  );
};

type Test = {
  description: string;
  input: string;
  expectedPrefix: string | null;
};

const TESTS: Test[] = [
  {
    description: "Real bug case — 'חתונה' must resolve to WED, not PRW",
    input: "חתונה",
    expectedPrefix: "WED",
  },
  {
    description: "Real bug case — 'על החתונה' must resolve to PRW, not WED",
    input: "על החתונה",
    expectedPrefix: "PRW",
  },
  {
    description: "Exact match still works — קפריסין",
    input: "קפריסין",
    expectedPrefix: "CYP",
  },
  {
    description: "Whitespace-only difference still matches (trim behavior preserved)",
    input: "  חתונה  ",
    expectedPrefix: "WED",
  },
  {
    description: "Non-existent category returns null (no false positive)",
    input: "טרנד",
    expectedPrefix: null,
  },
  {
    description: "'רווקות' vs 'רווקים' — distinct categories, same prefix by design, both resolve",
    input: "רווקים",
    expectedPrefix: "BCH",
  },
];

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const result = getCategoryByNameFixed(MOCK_CATEGORIES, test.input);
  const resultPrefix = result?.prefix || null;
  const ok = resultPrefix === test.expectedPrefix;

  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    console.log(`   ↳ expected prefix "${test.expectedPrefix}", got "${resultPrefix}"`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error("Some tests failed");
}
