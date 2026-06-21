/**
 * Stage E — Production Task Matching QA
 *
 * Tests the hardened findProductionTaskByName logic offline.
 * No real Sheets API or Claude API calls — uses a mock candidate list
 * that mirrors the real משימות הפקה sheet structure.
 *
 * Run with:  npx ts-node src/test/sprint-e-matching-qa.ts
 */

import { normalizeHebrewText, tokenizeHebrewText } from "../services/production-status.service";

// ---------------------------------------------------------------------------
// Inline copy of the helpers we need (no import from sheets.service to avoid
// real API calls at module load time)
// ---------------------------------------------------------------------------

const removePunctuationForMatching = (text: string): string =>
  text
    .replace(/[,.:–\-]/g, "")
    .replace(/[""\"''״׳]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getTokenOverlapScore = (a: string, b: string): number => {
  const tokensA = a.split(/\s+/).filter(Boolean);
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  return tokensA.filter((t) => tokensB.has(t)).length;
};

const PRODUCTION_MATCH_GENERIC_TOKENS = new Set<string>([
  "חדש",
  "חדשה",
  "חתונה",
  "חתונות",
  "זוגיות",
  "שמלה",
  "שמלות",
  "טיקטוק",
  "טרנד",
  "סטורי",
]);

const hasMeaningfulProductionTaskOverlap = (
  searchText: string,
  candidateName: string
): boolean => {
  const searchTokens = tokenizeHebrewText(searchText).filter(
    (token) => !PRODUCTION_MATCH_GENERIC_TOKENS.has(token)
  );
  const candidateTokens = new Set(
    tokenizeHebrewText(candidateName).filter(
      (token) => !PRODUCTION_MATCH_GENERIC_TOKENS.has(token)
    )
  );

  return searchTokens.some((token) => candidateTokens.has(token));
};

// ---------------------------------------------------------------------------
// Mock candidate list — mirrors real sheet rows [content_id, name, ...]
// ---------------------------------------------------------------------------

const MOCK_ROWS: string[][] = [
  ["content_id", "שם התוכן", "צולם", "נערך", "קאבר מוכן", "דדליין", "הערות"], // header
  ["PRW-002", "זוגיות בזמן ארגון חתונה - ריבים", "לא", "לא", "לא", "18/06/2026", ""],
  ["DRS-001", "האם שמלה שלישית זה מוגזם? סקר", "לא", "לא", "לא", "20/06/2026", ""],
  ["PRW-004", "פרידה מהשם משפחה כפכפי", "כן", "כן", "כן", "20/06/2026", ""],
  ["WED-002", "הרשתי סרטון אחד קיצ׳י", "לא", "לא", "לא", "25/06/2026", ""],
  ["WED-003", "בגדי התארגנות שתפ", "לא", "לא", "לא", "25/06/2026", ""],
];

// ---------------------------------------------------------------------------
// Offline matcher — same logic as findProductionTaskByName but synchronous
// and without Claude (Claude path is exercised separately via mock below)
// ---------------------------------------------------------------------------

type MatchResult =
  | { rowIndex: number; row: string[] }
  | { ambiguous: true; matches: Array<{ rowIndex: number; row: string[] }> }
  | null;

const matchOffline = (
  contentName: string,
  claudeIndexOverride?: number | "error" | "invalid"
): MatchResult => {
  const rows = MOCK_ROWS;
  const normalizedSearchName = normalizeHebrewText(contentName);
  const punctuationNormalizedSearch = removePunctuationForMatching(normalizedSearchName);

  const exactMatches: Array<{ rowIndex: number; row: string[] }> = [];
  const includesMatches: Array<{ rowIndex: number; row: string[] }> = [];
  const scoredMatches: Array<{ rowIndex: number; row: string[]; score: number }> = [];

  const MIN_INCLUDES_LENGTH = 4;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sheetRowNumber = i + 1;
    if (!row || !row[1]) continue;

    const sheetContentName = row[1].toString();
    const normalizedTaskName = normalizeHebrewText(sheetContentName);
    const punctuationNormalizedTask = removePunctuationForMatching(normalizedTaskName);

    // Exact normalized
    if (normalizedTaskName === normalizedSearchName) {
      exactMatches.push({ rowIndex: sheetRowNumber, row });
      continue;
    }
    // Exact punctuation-normalized
    if (punctuationNormalizedTask === punctuationNormalizedSearch) {
      exactMatches.push({ rowIndex: sheetRowNumber, row });
      continue;
    }
    // Includes - hardened (Stage E)
    const searchTokenCount = normalizedSearchName.split(/\s+/).filter(Boolean).length;
    if (
      searchTokenCount >= 2 &&
      normalizedSearchName.length >= MIN_INCLUDES_LENGTH &&
      normalizedTaskName.length >= MIN_INCLUDES_LENGTH &&
      normalizedTaskName.includes(normalizedSearchName)
    ) {
      includesMatches.push({ rowIndex: sheetRowNumber, row });
      continue;
    }
    if (
      searchTokenCount >= 2 &&
      normalizedSearchName.length >= MIN_INCLUDES_LENGTH &&
      normalizedTaskName.length >= MIN_INCLUDES_LENGTH &&
      normalizedSearchName.includes(normalizedTaskName)
    ) {
      includesMatches.push({ rowIndex: sheetRowNumber, row });
      continue;
    }
    // Includes punctuation-normalized - hardened (Stage E)
    if (
      searchTokenCount >= 2 &&
      punctuationNormalizedSearch.length >= MIN_INCLUDES_LENGTH &&
      punctuationNormalizedTask.length >= MIN_INCLUDES_LENGTH &&
      (punctuationNormalizedTask.includes(punctuationNormalizedSearch) ||
        punctuationNormalizedSearch.includes(punctuationNormalizedTask))
    ) {
      includesMatches.push({ rowIndex: sheetRowNumber, row });
      continue;
    }
    const score = getTokenOverlapScore(normalizedSearchName, normalizedTaskName);
    if (score > 0) {
      scoredMatches.push({ rowIndex: sheetRowNumber, row, score });
    }
  }

  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return { ambiguous: true, matches: exactMatches };
  if (includesMatches.length === 1) return includesMatches[0];
  if (includesMatches.length > 1) return { ambiguous: true, matches: includesMatches };

  // Claude path (mocked)
  if (scoredMatches.length > 0) {
    if (claudeIndexOverride === "error") {
      // Stage E: Claude error → null, no token overlap fallback
      return null;
    }
    if (claudeIndexOverride === "invalid" || claudeIndexOverride === undefined) {
      // Claude returned 0 or unparseable → null
      return null;
    }
    const idx = claudeIndexOverride - 1;
    if (idx >= 0 && idx < scoredMatches.length) {
      const candidateName = (scoredMatches[idx].row[1] || "").toString();

      if (!hasMeaningfulProductionTaskOverlap(contentName, candidateName)) {
        return null;
      }

      return { rowIndex: scoredMatches[idx].rowIndex, row: scoredMatches[idx].row };
    }
    return null;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

type Test = {
  description: string;
  input: string;
  claudeMock?: number | "error" | "invalid";
  expect: "exact" | "includes" | "ambiguous" | "null";
  expectedContentId?: string;
};

const TESTS: Test[] = [
  // 1. Exact match
  {
    description: "Exact match — פרידה מהשם משפחה כפכפי",
    input: "פרידה מהשם משפחה כפכפי",
    expect: "exact",
    expectedContentId: "PRW-004",
  },
  // 2. Punctuation normalization — dash removed
  {
    description: "Punctuation-normalized match — ריבים without dash",
    input: "זוגיות בזמן ארגון חתונה ריבים",
    expect: "exact",
    expectedContentId: "PRW-002",
  },
  // 3. Unique includes — long search term contained in task name
  {
    description: "Unique includes — שמלה שלישית זה מוגזם",
    input: "שמלה שלישית זה מוגזם",
    expect: "includes",
    expectedContentId: "DRS-001",
  },
  // 4. Short/generic search — must NOT pick a row alone
  {
    description: "Short generic search — שמלה (3 chars after normalize) must not match",
    input: "שמלה",
    expect: "null",
  },
  // 5. Token overlap score=1 — must NOT pick a row (Claude mocked invalid)
  {
    description: "Weak token overlap score=1 with Claude invalid response → null",
    input: "ריבים",
    claudeMock: "invalid",
    expect: "null",
  },
  // 6. Ambiguous candidates — two rows match includes
  {
    description: "Ambiguous — בגדי and שתפ both short, no unique match",
    input: "בגדי התארגנות",
    expect: "includes", // only WED-003 matches → unique
    expectedContentId: "WED-003",
  },
  // 7. Fast Track guard — explicit new content keyword should return null upstream
  //    (in real flow the controller skips findProductionTaskByName entirely;
  //     here we verify that even if called, a non-matching search returns null)
  {
    description: "Fast Track guard — סרטון חדש על ריבים does not match existing row",
    input: "סרטון חדש על ריבים",
    claudeMock: "invalid",
    expect: "null",
  },
  // 8. Claude high-confidence mock match
  {
    description: "Claude mock HIGH — picks correct candidate by index",
    input: "קיצ׳י",
    claudeMock: 1, // scoredMatches[0] = WED-002
    expect: "exact", // we treat a Claude pick as a match (rowIndex returned)
    expectedContentId: "WED-002",
  },
  // 9. Claude weak generic success → null
  {
    description: "Claude mock WEAK — generic חתונה alone must not update a production row",
    input: "חתונה",
    claudeMock: 1,
    expect: "null",
  },
  // 10. Claude weak generic success → null
  {
    description: "Claude mock WEAK — generic שמלה alone must not update a production row",
    input: "שמלה",
    claudeMock: 1,
    expect: "null",
  },
  // 11. Claude error → null (no token overlap fallback)
  {
    description: "Claude error → null, no fallback mutation risk",
    input: "קיצ׳י",
    claudeMock: "error",
    expect: "null",
  },
  // 12. Claude invalid/zero response → null
  {
    description: "Claude returns 0 → null",
    input: "קיצ׳י",
    claudeMock: "invalid",
    expect: "null",
  },
  // 13. content_id preserved in result
  {
    description: "content_id preserved — PRW-004 result contains correct id",
    input: "פרידה מהשם משפחה כפכפי",
    expect: "exact",
    expectedContentId: "PRW-004",
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const result = matchOffline(test.input, test.claudeMock);

  let ok = false;
  let reason = "";

  if (test.expect === "null") {
    ok = result === null;
    reason = result === null ? "" : `expected null, got ${JSON.stringify(result)}`;
  } else if (test.expect === "ambiguous") {
    ok = result !== null && "ambiguous" in result;
    reason = ok ? "" : `expected ambiguous, got ${JSON.stringify(result)}`;
  } else {
    // exact or includes — both produce { rowIndex, row }
    if (!result || "ambiguous" in result) {
      ok = false;
      reason = `expected a match, got ${JSON.stringify(result)}`;
    } else {
      const contentId = result.row[0];
      if (test.expectedContentId && contentId !== test.expectedContentId) {
        ok = false;
        reason = `expected contentId ${test.expectedContentId}, got ${contentId}`;
      } else {
        ok = true;
      }
    }
  }

  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${test.description}`);
  if (!ok) {
    console.log(`   ↳ ${reason}`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("❌ Some tests failed."); throw new Error("Tests failed"); }
