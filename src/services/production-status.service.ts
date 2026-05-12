import { ProductionStatusType, StatusUpdateRequest, ProductionStatusMapping } from "../types/production-status.types";

// Hebrew normalization utilities for deterministic matching
// Include both regular and sofit forms of filler words
const HEBREW_FILLER_WORDS = [
  "סרטון", "סרטנ",  // both forms due to sofit normalization
  "הסרטון", "הסרטנ",
  "על",
  "את",
  "של",
  "ה",
];

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
    // Match with spaces on both sides (flexible for any number of spaces)
    const regex = new RegExp(` +${filler} +`, "gi");
    normalized = normalized.replace(regex, " ");
  }
  
  // Remove leading/trailing spaces added above
  normalized = normalized.trim();

  // SECOND: Remove definite article "ה" prefix from words at word boundaries
  // Pattern: space + "ה" + Hebrew letter -> replace with space + Hebrew letter
  normalized = normalized.replace(/ ה(?=[א-ת])/g, " ");
  
  // Also handle "ה" at the beginning of the text
  normalized = normalized.replace(/^ה(?=[א-ת])/g, "");

  // THIRD: Normalize sofit letters to regular form
  normalized = normalized
    .replace(/ך/g, "כ")   // final kaph -> kaph
    .replace(/ם/g, "מ")   // final mem -> mem
    .replace(/ן/g, "נ")   // final nun -> nun
    .replace(/ף/g, "פ")   // final pe -> pe
    .replace(/ץ/g, "צ");  // final tsade -> tsade

  // FOURTH: Normalize spaces
  normalized = normalized
    .replace(/\s+/g, " ")  // Multiple spaces to single
    .trim();

  return normalized.toLowerCase();
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
export const detectStatusUpdate = (message: string): StatusUpdateRequest | null => {
  const normalized = message.trim().toLowerCase();

  // Try to find matching status pattern
  for (const mapping of STATUS_MAPPINGS) {
    for (const pattern of mapping.detectionPatterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        // Extract content name from message
        // Simple heuristic: words after status phrase (up to 3 words) or before "על"/"את"
        const contentName = extractContentName(message, pattern);

        return {
          statusType: mapping.statusType,
          contentName,
          rawMessage: message,
        };
      }
    }
  }

  return null;
};

/**
 * Extract content name from message with normalization
 * Tries to find meaningful content names like "שמלה שלישית", "קפריסין", etc.
 */
const extractContentName = (message: string, pattern: string): string => {
  // Try patterns like "צילמתי את X" or "צילמתי את הסרטון על X"
  const patternLowercase = pattern.toLowerCase();
  const messageLowercase = message.toLowerCase();
  const patternIndex = messageLowercase.indexOf(patternLowercase);

  if (patternIndex === -1) {
    return message; // Fallback to whole message
  }

  // Text after the pattern
  const afterPattern = message.substring(patternIndex + pattern.length).trim();

  // Remove leading Hebrew prepositions and prefixes like 'ל', 'ל־', 'עבור', 'בשביל', 'על', 'את'
  let cleaned = afterPattern
    .replace(/^(?:ל(?:־)?|עבור|בשביל|על|את)\s*/i, "")
    .trim();

  // Remove leading articles and additional prefix tokens
  cleaned = cleaned.replace(/^(?:ה|את|על|של|שלי|שלך)\s+/i, "").trim();

  // Remove quotes if present
  cleaned = cleaned.replace(/^["']|["']$/g, "").trim();

  // Take up to the first punctuation or a reasonable length
  const endIndex = cleaned.search(/[.,!?;:]/);
  if (endIndex > 0) {
    cleaned = cleaned.substring(0, endIndex).trim();
  }

  // Limit to reasonable length (max 100 chars)
  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 100).trim();
  }

  // Normalize for better matching
  cleaned = normalizeHebrewText(cleaned);

  return cleaned || message;
};

/**
 * Get the sheet column name for a status type
 */
export const getColumnName = (statusType: ProductionStatusType): string => {
  const mapping = STATUS_MAPPINGS.find((m) => m.statusType === statusType);
  return mapping?.columnName || "unknown";
};

/**
 * Validate if a message is a production status update
 */
export const isProductionStatusUpdate = (message: string): boolean => {
  return detectStatusUpdate(message) !== null;
};
