/**
 * Conversational UX utilities for handling natural Hebrew phrasing
 * and lightweight confidence-based routing
 */

// ===== FIX 1: Conversational Idea Prefix Cleanup =====

/** Hebrew prefixes commonly used when starting a conversation about an idea */
const IDEA_PREFIXES = [
  "יש לי רעיון חדש לסרטון",
  "יש לי רעיון לסרטון",
  "יש לי רעיון חדש",
  "יש לי רעיון",
  "יש רעיון",
  "רעיון חדש:",
  "רעיון לסרטון",
  "רעיון:",
  "חשבתי על רעיון",
  "יש לי קונספט",
  "קונספט:",
  "חשבתי על קונספט",
  "קונספט חדש:",
];

/**
 * Remove common conversational prefixes from the START of a message.
 * Only removes if at the very beginning; preserves inline occurrences.
 *
 * Example:
 * "יש לי רעיון על בת זוג של אוהד כדורגל..."
 * → "על בת זוג של אוהד כדורגל..."
 */
export const cleanIdeaPrefix = (text: string): string => {
  let cleaned = text.trim();

  // Try each prefix from longest to shortest (to avoid partial matches)
  const sortedPrefixes = [...IDEA_PREFIXES].sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    // Check if message starts with this prefix (case-insensitive)
    const prefixRegex = new RegExp(`^${prefix}\\s*`, "i");
    if (prefixRegex.test(cleaned)) {
      cleaned = cleaned.replace(prefixRegex, "").trim();
      // Return after first match to avoid double-cleaning
      return cleaned;
    }
  }

  return cleaned;
};

// ===== FIX 2 & 5: Draft Continuation & Confidence Gating =====

/** Markers that indicate continuation of an active draft discussion */
const CONTINUATION_MARKERS = [
  "זה פארודיה",
  "הרעיון הוא",
  "כאילו",
  "אבל",
  "בעצם",
  "כי",
  "בגלל",
  "למשל",
  "למשל:",
  "יותר בדיוק",
  "בעברית:",
  "ולא",
  "וגם",
  "ו",
];

/**
 * Detect if a message looks like it's continuing an existing draft discussion.
 * Lightweight heuristic: check for continuation markers at the start (ignoring punctuation).
 */
export const isContinuationMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  // Remove trailing punctuation for matching
  const cleanedForMatching = normalized.replace(/[,!?.]+$/, "");

  // If message is very short and is a single word continuation, it's likely continuation
  if (normalized.length < 20) {
    return CONTINUATION_MARKERS.some((marker) =>
      cleanedForMatching.startsWith(marker) || normalized.startsWith(marker)
    );
  }

  // For longer messages, only count specific multi-word patterns
  const strongContinuationPatterns = [
    /^זה פארודיה/,
    /^הרעיון הוא/,
    /^כאילו/,
    /^בעצם/,
    /^יותר בדיוק/,
    /^ובעצם/,
  ];

  return strongContinuationPatterns.some((pattern) => pattern.test(normalized));
};

// ===== FIX 3: Meta-Conversation Detection =====

/** Messages that ask about the conversation itself, not create/edit content */
const META_CONVERSATION_PATTERNS = [
  /^על מה ענית/,
  /^לא הבנת אותי/,
  /^למה התכוננת/,
  /^למה התכוונת/,
  /^מה התכוננת/,
  /^מה התכוונת/,
  /^זה לא מה שאמרתי/,
  /^לא בדיוק/,
  /^לא הבנתי/,
  /^אני לא מכוונת/,
  /^לא זה/,
  /^לא כזה/,
  /^זה לא בדיוק/,
  /^מה אמרתי/,
  /^איך אתה הבנת/,
  /^זה שגוי/,
];

/**
 * Detect if a message is meta-conversation (asking about the conversation itself)
 * rather than creating/editing content.
 */
export const isMetaConversation = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  return META_CONVERSATION_PATTERNS.some((pattern) => pattern.test(normalized));
};

// ===== FIX 5: Lightweight Confidence Gating =====

/**
 * Heuristic confidence check for idea messages.
 * Returns true if the message has reasonable confidence to be treated as a new idea.
 *
 * Low-confidence cases:
 * - Single word responses
 * - Questions without clear content
 * - Ambiguous single phrases
 */
export const hasIdeaConfidence = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();

  // Too short
  if (normalized.length < 2) {
    return false;
  }

  // Question marks without content (likely clarification)
  if (normalized === "?" || normalized === "מה?") {
    return false;
  }

  // All caps English (check only Latin letters, Hebrew doesn't have case)
  if (/^[A-Z\s]+$/.test(text) && text.length > 1) {
    return false;
  }

  // Too many punctuation marks with no content
  if (/^[.!?,?]+$/.test(normalized)) {
    return false;
  }

  return true;
};

/**
 * Heuristic confidence check for edit requests.
 * Returns true if the message has clear intent to edit.
 */
export const hasEditConfidence = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();

  // Too vague
  if (normalized.length < 3) {
    return false;
  }

  // Must have some structure
  const words = normalized.split(/\s+/);
  if (words.length < 2) {
    return false;
  }

  return true;
};

// ===== Improved Clarification Responses =====

/**
 * Generate a better clarification prompt that guides the user.
 */
export const generateClarificationPrompt = (hasActiveDraft: boolean): string => {
  if (hasActiveDraft) {
    return `לא בטוחה שהבנתי 

את רוצה:
• לערוך את הרעיון הקיים?
• להתחיל רעיון חדש?
• או משהו אחר?`;
  } else {
    return `לא בטוחה שהבנתי

את רוצה:
• להשתיל רעיון חדש?
• לעדכן סטטוס קיים?
• או משהו אחר?`;
  }
};
