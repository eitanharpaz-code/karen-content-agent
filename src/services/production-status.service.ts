import { ProductionStatusType, StatusUpdateRequest, ProductionStatusMapping } from "../types/production-status.types";
import { normalizeUserDateInput } from "../utils/date-utils";

// Hebrew normalization utilities for deterministic matching
// Include both regular and sofit forms of filler words
const HEBREW_FILLER_WORDS = [
  "סרטון",
  "סרטנ",
  "הסרטון",
  "הסרטנ",
  "ריל",
  "וידאו",
  "פוסט",
  "תוכן",
  "על",
  "עם",
  "את",
  "של",
  "ה",
  "זה",
  "זאת",
  "הזה",
  "הזאת",
];

const HEBREW_TOKEN_STOP_WORDS = new Set<string>([
  "סרטון",
  "סרטנ",
  "ריל",
  "וידאו",
  "פוסט",
  "תוכן",
  "על",
  "עם",
  "את",
  "של",
  "ה",
  "זה",
  "זאת",
  "הזה",
  "הזאת",
  "הסרטון",
  "הסרטנ",
]);

/**
 * Normalize Hebrew text for matching
 * - Removes common filler words (before sofit normalization to catch both forms)
 * - Removes definite article prefix "ה" from words
 * - Converts sofit (final) letters to regular form
 * - Trims spaces
 */
export const normalizeHebrewText = (text: string): string => {
  if (!text) return "";

  let normalized = text;

  // FIRST: Remove common filler words (before sofit conversion)
  // Add spaces around text to catch beginning/end words
  normalized = ` ${normalized} `;

  for (const filler of HEBREW_FILLER_WORDS) {
    const regex = new RegExp(` +${filler} +`, "gi");
    normalized = normalized.replace(regex, " ");
  }

  normalized = normalized.trim();

  // SECOND: Remove definite article "ה" prefix from words at word boundaries
  normalized = normalized.replace(/ ה(?=[א-ת])/g, " ");
  normalized = normalized.replace(/^ה(?=[א-ת])/g, "");

  // THIRD: Normalize sofit letters to regular form
  normalized = normalized
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ");

  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized.toLowerCase();
};

export const tokenizeHebrewText = (text: string): string[] => {
  const normalized = normalizeHebrewText(text);

  const rawTokens = normalized
    .replace(/[^א-ת־\s]/g, " ")
    .replace(/־/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const tokens = rawTokens.reduce<string[]>((acc, token) => {
    const tokenLower = token.toLowerCase();
    const tokensToAdd = [tokenLower];

    if (tokenLower.length > 2 && tokenLower.startsWith("ל")) {
      const stripped = tokenLower.replace(/^ל(?:־)?/, "");
      if (stripped && stripped !== tokenLower) {
        tokensToAdd.push(stripped);
      }
    }

    for (const item of tokensToAdd) {
      if (item && !HEBREW_TOKEN_STOP_WORDS.has(item)) {
        acc.push(item);
      }
    }

    return acc;
  }, []);

  return Array.from(new Set(tokens));
};

export const getTokenOverlapScore = (searchText: string, targetText: string): number => {
  const searchTokens = tokenizeHebrewText(searchText);
  const targetTokens = new Set(tokenizeHebrewText(targetText));

  return searchTokens.reduce((score, token) => {
    return targetTokens.has(token) ? score + 1 : score;
  }, 0);
};

// Mapping of production statuses to detection patterns and sheet columns
const STATUS_MAPPINGS: ProductionStatusMapping[] = [
  {
    statusType: "filmed",
    columnName: "צולם",
// Audit F4: standalone "קלטתי" removed — in everyday slang it means "got
// it/understood" ("קלטתי, אז מה עושים מחר?") and was marking content as filmed.
detectionPatterns: ["צילמתי", "צילמנו", "סיימתי לצלם", "סיימנו לצלם", "הצילום מוכן", "הסרטון צולם", "גמרתי לצלם"],  },
  {
    statusType: "edited",
    columnName: "נערך",
detectionPatterns: ["ערכתי", "ערכנו", "סיימתי לערוך", "סיימנו לערוך", "העריכה מוכנה", "עריכה מוכנה", "גמרתי עריכה", "הסרטון ערוך", "העריכה נגמרה"],  },
  {
    statusType: "cover_ready",
    columnName: "קאבר מוכן",
    detectionPatterns: [
  "הקאבר והקופי מוכנים",
  "הקאבר והקופי",
  "הקאבר מוכנים",
  "הקאבר מוכן",
  "קאבר מוכן",
  "סיימתי קאבר",
  "סיימתי את הקאבר",
  "הכנתי קאבר",
  "קאבר סיים",
  "טייטל מוכן",
],
// Audit F4: standalone "הקאבר" removed above — it fired on any sentence that
// merely mentions the cover, including ones saying it is NOT ready
// ("הקאבר של קפריסין עדיין אצל המעצבת"). Only "ready"-shaped phrasings remain.
  },
  {
    statusType: "uploaded",
    columnName: "פורסם",
    // Audit F4: standalone "יצא" removed — it's an everyday word ("יצא לי
// רעיון", "יצא מעולה") and was marking random messages as published. The
// unambiguous forms "יצא לאוויר" / "עלה לאוויר" remain.
detectionPatterns: ["העליתי", "העלנו", "הסרטון עלה", "הסרטון הועלה", "סרטון עלה", "עלה לאוויר", "יצא לאוויר", "פורסם", "פרסמתי", "פרסמנו", "הסרטון פורסם", "העלתי"],
  },
];

/**
 * Detect if a message contains production status update intent
 * Returns the detected status type and extracted content name, or null if no status detected
 */
type StatusPatternMatch = {
  statusType: ProductionStatusType;
  columnName: string;
  pattern: string;
  firstTokenStart: number;
  firstTokenEnd: number;
  lastTokenStart: number;
  lastTokenEnd: number;
};

const findOrderedPatternIndexes = (
  message: string,
  pattern: string
): { firstTokenStart: number; firstTokenEnd: number; lastTokenStart: number; lastTokenEnd: number } | null => {
  const normalizedMessage = message.toLowerCase();
  const tokens = pattern.toLowerCase().split(/\s+/).filter(Boolean);

  let firstTokenStart = -1;
  let firstTokenEnd = -1;
  let lastTokenStart = -1;
  let lastTokenEnd = -1;
  let searchIndex = 0;

  for (const token of tokens) {
    const tokenIndex = normalizedMessage.indexOf(token, searchIndex);
    if (tokenIndex === -1) {
      return null;
    }

    if (firstTokenStart === -1) {
      firstTokenStart = tokenIndex;
      firstTokenEnd = tokenIndex + token.length;
    }

    lastTokenStart = tokenIndex;
    lastTokenEnd = tokenIndex + token.length;
    searchIndex = lastTokenEnd;
  }

  return { firstTokenStart, firstTokenEnd, lastTokenStart, lastTokenEnd };
};

const findAllProductionStatusMatches = (message: string): StatusPatternMatch[] => {
  const normalizedMessage = message.trim().toLowerCase();
  const matches: StatusPatternMatch[] = [];

  for (const mapping of STATUS_MAPPINGS) {
    for (const pattern of mapping.detectionPatterns) {
      const patternIndexes = findOrderedPatternIndexes(normalizedMessage, pattern);
      if (!patternIndexes) {
        continue;
      }

      matches.push({
        statusType: mapping.statusType,
        columnName: mapping.columnName,
        pattern,
        ...patternIndexes,
      });
      break;
    }
  }

  return matches;
};

const STATUS_PREFIX_CLEANUP = /^(?:מוכן|מוכנים|סיימתי|סיימנו|סיימת|סיימתם|סיימתן)\s*/i;
const STATUS_SUFFIX_CLEANUP = /\s*(?:עלה(?:\s+לאוויר)?|הועלה|פורסם|יצא(?:\s+לאוויר)?)\s*$/i;

/**
 * Expand detected status types with their production dependencies.
 * One-directional cascade:
 * - uploaded → filmed + edited + cover_ready + uploaded
 * - edited → filmed + edited
 * - filmed → filmed only
 * - cover_ready → cover_ready only
 *
 * Results are deduplicated.
 */
export const expandStatusTypesWithDependencies = (statusTypes: ProductionStatusType[]): ProductionStatusType[] => {
  const expanded = new Set<ProductionStatusType>();

  for (const statusType of statusTypes) {
    switch (statusType) {
      case "uploaded":
        // Uploaded means all previous steps are complete
        expanded.add("filmed");
        expanded.add("edited");
        expanded.add("cover_ready");
        expanded.add("uploaded");
        break;
      case "edited":
        // Edited requires filming first
        expanded.add("filmed");
        expanded.add("edited");
        break;
      case "filmed":
        // Filmed only marks filming
        expanded.add("filmed");
        break;
      case "cover_ready":
        // Cover ready is independent
        expanded.add("cover_ready");
        break;
    }
  }

  return Array.from(expanded);
};

export const detectStatusUpdate = (message: string): StatusUpdateRequest | null => {
  const trimmedMessage = message.trim();
  const statusMatches = findAllProductionStatusMatches(trimmedMessage);

  if (statusMatches.length === 0) {
    return null;
  }

  const uniqueStatusMatches = Array.from(
    statusMatches.reduce<Map<ProductionStatusType, StatusPatternMatch>>((map, match) => {
      const existing = map.get(match.statusType);
      if (!existing || match.firstTokenStart < existing.firstTokenStart) {
        map.set(match.statusType, match);
      }
      return map;
    }, new Map()).values()
  );

  uniqueStatusMatches.sort((a, b) => a.firstTokenStart - b.firstTokenStart);

  const statusTypes = uniqueStatusMatches.map((match) => match.statusType);
  const expandedStatusTypes = expandStatusTypesWithDependencies(statusTypes);
  const lastMatch = uniqueStatusMatches.reduce((best, match) => {
    return match.lastTokenEnd > best.lastTokenEnd ? match : best;
  }, uniqueStatusMatches[0]);

  return {
    statusType: statusTypes[0],
    statusTypes: expandedStatusTypes,
    contentName: extractContentName(trimmedMessage, lastMatch.lastTokenEnd),
    rawMessage: message,
  };
};

const extractContentName = (message: string, afterIndex: number): string => {
  const afterStatusText = message.substring(afterIndex).trim();
  let cleaned = afterStatusText;

  if (!cleaned) {
      return normalizeHebrewText(
        message.trim().replace(STATUS_SUFFIX_CLEANUP, "").trim()
      );
  }

  cleaned = cleaned.replace(STATUS_PREFIX_CLEANUP, "").trim();
  cleaned = cleaned.replace(/^(?:ל(?:־)?|עבור|בשביל|על|את)\s*/i, "").trim();
  cleaned = cleaned.replace(/^(?:ה|את|על|של|שלי|שלך)\s+/i, "").trim();
  cleaned = cleaned.replace(/^['"]|['"]$/g, "").trim();
    cleaned = cleaned.replace(STATUS_SUFFIX_CLEANUP, "").trim();

  // Extract content after " על " or " עם " (mid-text separators for content topics)
  // e.g., "סרטון חדש על סיור לוקיישנים" → "סיור לוקיישנים"
  const separatorMatch = cleaned.match(/\s+(?:על|עם)\s+(.+)/i);
  if (separatorMatch && separatorMatch[1]) {
    cleaned = separatorMatch[1].trim();
  }

  const endIndex = cleaned.search(/[.,!?;:]/);
  if (endIndex > 0) {
    cleaned = cleaned.substring(0, endIndex).trim();
  }

  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 100).trim();
  }

  cleaned = normalizeHebrewText(cleaned);

  return cleaned || normalizeHebrewText(message.trim());
};

export const getColumnName = (statusType: ProductionStatusType): string => {
  const mapping = STATUS_MAPPINGS.find((m) => m.statusType === statusType);
  return mapping?.columnName || "unknown";
};

export const isProductionStatusUpdate = (message: string): boolean => {
  return detectStatusUpdate(message) !== null;
};
// Detect deadline update command
// e.g. "תשני את הדדליין של X לתאריך Y"
//
// Audit F2 rewrite. The old check was a loose substring test —
// (דדליין OR תאריך) + (תשני/שני/עדכני/שנה/עדכן) — which hijacked innocent
// messages: "שני" matched inside "שניה" and "יום שני", "שנה" matched a plain
// year, and "תאריך" appears in ordinary questions. Because this function
// also sits in the explicit-command escape hatch of every pendingQuestion
// handler, a mid-flow answer like "בעצם תשני לתאריך אחר" wiped the modal
// state and broke the flow.
//
// The tightened rules mirror what extractDeadlineUpdate can actually parse:
// 1) An unambiguous change verb as a WHOLE TOKEN + "דדליין" anywhere.
// 2) The ambiguous short verbs שני/שנה only in the explicit form
//    "שני/שנה את הדדליין".
// 3) An unambiguous change verb + the explicit phrase "את התאריך"
//    (preserves today's routing for "תשני את התאריך של X ל-Y").
// 4) The declarative form "הדדליין של X הוא Y".
// "תאריך" alone is no longer a trigger.
const UNAMBIGUOUS_DEADLINE_CHANGE_VERBS = [
  "תשני",
  "תשנה",
  "עדכני",
  "תעדכני",
  "עדכן",
  "תעדכן",
];

export const isDeadlineUpdate = (message: string): boolean => {
  const raw = message.trim().toLowerCase();

  // Whole-token verb match: strip leading/trailing punctuation from each
  // whitespace-separated token so "תשני," still counts, but "שניה" or
  // "השנה" never do.
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/^[^\u0590-\u05FFa-z0-9]+|[^\u0590-\u05FFa-z0-9]+$/g, ""));
  const hasChangeVerb = tokens.some((t) =>
    UNAMBIGUOUS_DEADLINE_CHANGE_VERBS.includes(t)
  );

  // "דדליין" is unambiguous — safe as a substring (covers הדדליין, לדדליין).
  if (hasChangeVerb && raw.includes("דדליין")) return true;

  // Ambiguous short verbs, explicit form only.
  if (/(?:^|\s)(?:שני|שנה)\s+את\s+הדדליין/.test(raw)) return true;

  // Explicit date-change phrasing with a clear verb.
  if (hasChangeVerb && raw.includes("את התאריך")) return true;

  // Declarative form, matches the extractor's last pattern.
  if (/הדדליין של\s+.+\s+הוא\s+/.test(raw)) return true;

  return false;
};

export const extractDeadlineUpdate = (message: string): { contentName: string; deadline: string } | null => {
  const patterns = [
    /(?:תשני|תשנה) את הדדליין של (.+?) לתאריך (.+)/i,
    /(?:תשני|תשנה) את הדדליין של (.+?) ל[־-]?(.+)/i,
    /(?:עדכני|תעדכני|עדכן|תעדכן) את הדדליין של (.+?) ל[־-]?(.+)/i,
    /(?:שני|שנה) את הדדליין של (.+?) ל[־-]?(.+)/i,
    /הדדליין של (.+?) הוא (.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const rawDeadline = match[2].trim();
      const numericDateMatch = rawDeadline.match(/\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/);
      const normalizedDeadline = numericDateMatch
        ? normalizeUserDateInput(numericDateMatch[0])
        : null;

      if (numericDateMatch && !normalizedDeadline) {
        return null;
      }

      return {
        contentName: match[1].trim(),
        deadline: normalizedDeadline || rawDeadline.replace(/[?!.]+$/g, ""),
      };
    }
  }

  return null;
};
