import { google } from "googleapis";
import {
  normalizeHebrewText,
  getTokenOverlapScore,
  tokenizeHebrewText,
} from "./production-status.service";

// Local Hebrew fuzzy-match for bulk archive.
//
// Motivation: the previous bulk-archive flow used askClaudeForMatching
// (Haiku 4.5) once per item. Karen hit two problems in live testing:
// (a) Haiku frequently returned "1" as a default when it was uncertain
//     across a 20+ candidate pool, so all list items matched the same
//     first candidate — wrong archives ready to happen.
// (b) Every list item cost a Claude call, adding up as she tested.
//
// This module reuses the same Hebrew normalization already in production
// (normalizeHebrewText, tokenizeHebrewText, getTokenOverlapScore from
// production-status.service — the same helpers archiveContentIdea uses
// internally for its final row-lookup). Runs entirely offline. Zero API
// tokens spent per match.
//
// It also widens the candidate pool: candidates come from BOTH the
// content library AND the approved-content sheet, so Karen can archive
// items that already moved into production, not only fresh ideas.

const CONTENT_LIBRARY = "בנק רעיונות";
const APPROVED_CONTENT = "תכנים שאושרו";

const getAuthClient = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars."
    );
  }
  return new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
};

export type ArchivableSource = "library" | "approved";

export interface ArchivableCandidate {
  source: ArchivableSource;
  contentId: string;
  idea: string;
}

// Pulls candidate rows from both tabs in parallel. Rows without an idea
// name (column B empty) are filtered out. Returns a single flat list ready
// for fuzzy matching.
export const fetchArchivableCandidates = async (
  spreadsheetId: string
): Promise<ArchivableCandidate[]> => {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const [libResp, approvedResp] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CONTENT_LIBRARY}!A:B`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${APPROVED_CONTENT}!A:B`,
    }),
  ]);

  const libRows = (libResp.data.values || []).slice(1);
  const approvedRows = (approvedResp.data.values || []).slice(1);

  const libCandidates: ArchivableCandidate[] = libRows
    .filter((row) => row && row[1])
    .map((row) => ({
      source: "library" as const,
      contentId: (row[0] || "").toString(),
      idea: row[1].toString(),
    }));

  const approvedCandidates: ArchivableCandidate[] = approvedRows
    .filter((row) => row && row[1])
    .map((row) => ({
      source: "approved" as const,
      contentId: (row[0] || "").toString(),
      idea: row[1].toString(),
    }));

  return [...libCandidates, ...approvedCandidates];
};

export interface FuzzyMatchResult {
  candidate: ArchivableCandidate;
  score: number;
  ratio: number;
}

// Local fuzzy match. No Claude, no external calls.
//
// Design:
// - Query and each candidate are normalized (definite articles, sofit
//   letters, filler words) and tokenized using the same helpers used
//   elsewhere in the app.
// - Score = number of query tokens present in the candidate.
// - Ratio = score / queryTokenCount (0..1).
// - A match is only accepted when the score AND the ratio both clear
//   thresholds. This is what fixes Karen's live bug: candidates that
//   share zero meaningful tokens with the query cannot win by default.
//
// Thresholds are conservative — better to leave an item "unmatched" and
// let Karen see it in the unmatched list than to archive the wrong row.
export const findBestFuzzyIdeaMatch = (
  query: string,
  candidates: ArchivableCandidate[],
  options: { minSharedTokens?: number; minRatio?: number } = {}
): FuzzyMatchResult | null => {
  const queryTokens = tokenizeHebrewText(query);
  if (queryTokens.length === 0) return null;

  const queryNormalized = normalizeHebrewText(query);

  const minRatio = options.minRatio ?? 0.5;
  const minShared = options.minSharedTokens ?? Math.min(2, queryTokens.length);

  let best: FuzzyMatchResult | null = null;

  for (const candidate of candidates) {
    const score = getTokenOverlapScore(
      queryNormalized,
      normalizeHebrewText(candidate.idea)
    );
    if (score < minShared) continue;

    const ratio = score / queryTokens.length;
    if (ratio < minRatio) continue;

    if (!best || score > best.score) {
      best = { candidate, score, ratio };
    }
  }

  return best;
};
