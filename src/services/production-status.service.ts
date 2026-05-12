import { ProductionStatusType, StatusUpdateRequest, ProductionStatusMapping } from "../types/production-status.types";

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
    detectionPatterns: ["צילמתי", "סיימתי לצלם", "הצילום מוכן", "קלטתי"],
  },
  {
    statusType: "edited",
    columnName: "נערך",
    detectionPatterns: ["ערכתי", "סיימתי לערוך", "העריכה מוכנה", "סיימתי לערוך"],
  },
  {
    statusType: "cover_ready",
    columnName: "קאבר מוכן",
    detectionPatterns: ["הקאבר מוכן", "סיימתי קאבר", "קאבר סיים", "טייטל מוכן"],
  },
  {
    statusType: "copy_ready",
    columnName: "קופי מוכן",
    detectionPatterns: ["הקופי מוכן", "סיימתי לכתוב", "טקסט מוכן", "הטקסט מוכן", "קופי סיים"],
  },
  {
    statusType: "uploaded",
    columnName: "הועלה",
    detectionPatterns: ["העליתי", "הסרטון עלה", "פורסם", "פרסמתי", "העלתי"],
  },
];

/**
 * Detect if a message contains production status update intent
 * Returns the detected status type and extracted content name, or null if no status detected
 */
const findOrderedPatternIndexes = (message: string, pattern: string): { firstTokenEnd: number; lastTokenStart: number; lastTokenEnd: number } | null => {
  const normalizedMessage = message.toLowerCase();
  const tokens = pattern.toLowerCase().split(/\s+/).filter(Boolean);

  let firstTokenEnd = -1;
  let lastTokenStart = -1;
  let lastTokenEnd = -1;
  let searchIndex = 0;

  for (const token of tokens) {
    const tokenIndex = normalizedMessage.indexOf(token, searchIndex);
    if (tokenIndex === -1) {
      return null;
    }

    if (firstTokenEnd === -1) {
      firstTokenEnd = tokenIndex + token.length;
    }

    lastTokenStart = tokenIndex;
    lastTokenEnd = tokenIndex + token.length;
    searchIndex = lastTokenEnd;
  }

  return { firstTokenEnd, lastTokenStart, lastTokenEnd };
};

export const detectStatusUpdate = (message: string): StatusUpdateRequest | null => {
  const normalized = message.trim().toLowerCase();

  for (const mapping of STATUS_MAPPINGS) {
    for (const pattern of mapping.detectionPatterns) {
      const patternIndexes = findOrderedPatternIndexes(normalized, pattern);
      if (!patternIndexes) {
        continue;
      }

      const contentName = extractContentName(message, pattern, patternIndexes);

      return {
        statusType: mapping.statusType,
        contentName,
        rawMessage: message,
      };
    }
  }

  return null;
};

/**
 * Extract content name from message with normalization
 * Tries to find meaningful content names like "שמלה שלישית", "קפריסין", etc.
 */
const extractContentName = (
  message: string,
  pattern: string,
  patternIndexes: { firstTokenEnd: number; lastTokenStart: number; lastTokenEnd: number }
): string => {
  const { firstTokenEnd, lastTokenStart, lastTokenEnd } = patternIndexes;

  const betweenPatternText = lastTokenStart > firstTokenEnd ? message.substring(firstTokenEnd, lastTokenStart).trim() : "";
  const afterPatternText = message.substring(lastTokenEnd).trim();

  let cleaned = betweenPatternText || afterPatternText;

  if (!cleaned) {
    return normalizeHebrewText(message.trim());
  }

  cleaned = cleaned.replace(/^(?:ל(?:־)?|עבור|בשביל|על|את)\s*/i, "").trim();
  cleaned = cleaned.replace(/^(?:ה|את|על|של|שלי|שלך)\s+/i, "").trim();
  cleaned = cleaned.replace(/^['"]|['"]$/g, "").trim();

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
