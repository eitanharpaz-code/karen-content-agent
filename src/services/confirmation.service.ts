import { DraftSummary } from "../types/content.types";

// In-memory storage for pending confirmations (MVP)
const pendingConfirmations = new Map<string, DraftSummary>();

// Pending question context - what the agent last asked
type PendingQuestion = {
  questionType: string;  // e.g. "show_trends", "confirm_deadline", "show_more"
  context?: Record<string, unknown>;  // optional extra data
};
const pendingQuestions = new Map<string, PendingQuestion>();

export const storePendingQuestion = (userId: string, question: PendingQuestion): void => {
  pendingQuestions.set(userId, question);
};
export const getPendingQuestion = (userId: string): PendingQuestion | undefined => {
  return pendingQuestions.get(userId);
};
export const clearPendingQuestion = (userId: string): void => {
  pendingQuestions.delete(userId);
};

// Translation mappings: Hebrew (canonical) to Hebrew display
// These are used for parsing user edits from Hebrew text
const PRIORITY_HEBREW_VALUES: Record<string, string> = {
  "גבוה": "גבוה",
  "בינוני": "בינוני",
  "נמוך": "נמוך",
};

const TONE_HEBREW_VALUES: Record<string, string> = {
  "הסברתי": "הסברתי",
  "מצחיק": "מצחיק",
  "אותנטי": "אותנטי",
  "השראתי": "השראתי",
  "טרנדי": "טרנדי",
  "רגשי": "רגשי",
  "הומוריסטי": "הומוריסטי",
  "דרמטי": "דרמטי",
};

const CATEGORY_HEBREW_VALUES: Record<string, string> = {
  "קפריסין": "קפריסין",
  "חתונה": "חתונה",
  "שמלות": "שמלות",
  "כללי": "כללי",
  "רווקות": "רווקות",
  "רווקים": "רווקים",
  "על החתונה": "על החתונה",
};

const REQUIRES_SHOOTING_HEBREW_VALUES: Record<string, string> = {
  "כן": "כן",
  "לא": "לא",
};

const PLATFORM_HEBREW_VALUES: Record<string, string> = {
  "אינסטגרם": "אינסטגרם",
  "טיקטוק": "טיקטוק",
};

// Display Hebrew values (no translation needed - Hebrew is canonical)
export const displayPriority = (priority: string): string => {
  return PRIORITY_HEBREW_VALUES[priority] || priority;
};

export const displayTone = (tone: string): string => {
  return TONE_HEBREW_VALUES[tone] || tone;
};

export const displayCategory = (category: string): string => {
  return CATEGORY_HEBREW_VALUES[category] || category;
};

export const displayRequiresShooting = (requiresShooting: string): string => {
  return REQUIRES_SHOOTING_HEBREW_VALUES[requiresShooting] || requiresShooting;
};

export const displayPlatform = (platform: string): string => {
  return PLATFORM_HEBREW_VALUES[platform] || platform;
};

export const isConfirmationMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const yesWords = ["כן", "מאשרת", "תאשר", "תעשה את זה", "סגור", "בסדר", "טוב"];
  return yesWords.includes(normalized);
};
export const isRejectionMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const noWords = ["לא", "לא תודה", "בטלי", "אל תשמרי", "עזבי את זה"];
  return noWords.includes(normalized);
};
export const isResetRequest = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const resetCommands = [
    "ביטול",
    "תבטלי",
    "איפוס",
    "עזבי",
    "לא משנה",
    "תתחילי מחדש",
    "רעיון חדש",
    "אני רוצה לשלוח רעיון חדש",
  ];

  return resetCommands.some((command) => normalized === command || normalized.startsWith(`${command}:`));
};

export const isNewIdeaCommand = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  return normalized.startsWith("רעיון חדש:");
};

export const getNewIdeaText = (text: string): string | null => {
  const match = text.match(/רעיון חדש\s*:\s*(.+)/i);
  return match ? match[1].trim() : null;
};
export const isTrendCommand = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const trendPrefixes = [
    "טרנד:",
    "טרנד -",
    "טרנד–",
    "יש טרנד חדש",
    "יש טרנד",
    "טרנד חדש",
    "טרנד ",
  ];
  return trendPrefixes.some((prefix) => normalized.startsWith(prefix));
};

export const getTrendText = (text: string): string | null => {
  const cleaned = text
    .trim()
    .replace(/^יש טרנד חדש\s*[,:\-–]?\s*/i, "")
    .replace(/^יש טרנד\s*[,:\-–]?\s*/i, "")
    .replace(/^טרנד חדש\s*[,:\-–]?\s*/i, "")
    .replace(/^טרנד\s*[,:\-–]?\s*/i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
};

export const isEditRequest = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const editIndicators = [
    "תשנה", "שנה", "תשני", "שני", "תעדכן", "עדכן", "תעדכני", "עדכני",
    "תקרא", "קרא", "הטון", "העדיפות",
    "הקטגוריה", "הסיכום", "סיכום", "בסיכום", "זה לא", "לא נכון", "טעות",
    "אני רוצה", "בא לי", "עדיף", "צריך", "יהיה", "שיהיה",
    "לשנות", "לעדכן", "לקרוא", "change", "update", "edit"
  ];
  return editIndicators.some(indicator => normalized.includes(indicator));
};

export const parseEditRequest = (text: string): { field: string; value: string } | null => {
  const normalized = text.trim().toLowerCase();

  // Helper function to find Hebrew value in text (Hebrew is canonical now)
  const findHebrewValue = (text: string, hebrewOptions: Record<string, string>): string | null => {
    for (const hebrewValue of Object.keys(hebrewOptions)) {
      if (text.includes(hebrewValue.toLowerCase())) {
        return hebrewValue;
      }
    }
    return null;
  };

  // === EXPLICIT FIELD COMMANDS - checked first, return immediately ===

  // 1. Explicit summary edits - check and return immediately without re-parsing value
  if (normalized.includes("סיכום") || normalized.includes("summary") ||
      normalized.includes("תיאור")) {
    // Extract everything after summary indicators - explicit patterns only
    const summaryPatterns = [
      /תשנה את הסיכום ל[:\s]*(.+)/i,
      /שנה את הסיכום ל[:\s]*(.+)/i,
      /תעדכן את הסיכום ל[:\s]*(.+)/i,
      /הסיכום צריך להיות[:\s]*(.+)/i,
      /בסיכום תכתוב[:\s]*(.+)/i,
      /שנה סיכום ל[:\s]*(.+)/i,
      /(?:סיכום|summary|תיאור)[:\s]*(.+)/i,
    ];

    for (const pattern of summaryPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Return immediately - do NOT inspect value for other fields
        return { field: "summary", value: match[1].trim() };
      }
    }
  }

  // 2. Explicit short name edits - check and return immediately
  if (normalized.includes("שם") || normalized.includes("קרא") || normalized.includes("name") ||
      normalized.includes("תקרא") || normalized.includes("שנה שם")) {
    // More flexible name extraction patterns - explicit patterns only
    const namePatterns = [
      /תקרא לזה ["']([^"']+)["']/,
      /שם ["']([^"']+)["']/,
      /קרא לזה ["']([^"']+)["']/,
      /השם ["']([^"']+)["']/,
      /שנה את השם ל["']([^"']+)["']/,
      /שם חדש[:\s]*["']([^"']+)["']/,
      /תשנה את השם ל["']([^"']+)["']/,
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match) {
        // Return immediately - do NOT inspect value for other fields
        return { field: "shortName", value: match[1] };
      }
    }

    // Try to extract name without quotes - look for words after name change indicators
    const nameChangeIndicators = ["שם", "קרא", "תקרא", "שנה שם", "תשנה את השם"];
    for (const indicator of nameChangeIndicators) {
      const index = normalized.indexOf(indicator);
      if (index !== -1) {
        const afterIndicator = text.substring(index + indicator.length).trim();
        // Extract meaningful phrase, handling "ל" prefix, allowing multiple words until punctuation
        const nameMatch = afterIndicator.match(/^(?:ל)?["']?([^"'\n.!?]{1,50})["']?/);
        if (nameMatch && nameMatch[1].length > 0 && nameMatch[1].length < 50) {
          const extractedName = nameMatch[1].trim();
          // Take up to 5 words for the name
          const words = nameMatch[1].split(/\s+/).slice(0, 5).join(' ');
          // Return immediately - do NOT inspect value for other fields
          return { field: "shortName", value: words.trim() };
        }
      }
    }
  }

  // 3. Explicit category edits - check and return immediately
  if (normalized.includes("קטגוריה") || normalized.includes("category") ||
      normalized.includes("קטגוריית")) {
    // Explicit category command parsing
    const categoryPatterns = [
      /(?:תשני|שני|תעדכני|עדכני|תשנה|שנה|תעדכן|עדכן)?\s*(?:את\s+)?(?:ה\s*)?(?:קטגוריה|קטגוריית)\s*(?:ל|לל|ל־|על|של)?\s*(.+)/i,
      /(?:קטגוריה|קטגוריית)\s*(?:ל|לל|ל־|על|של)?\s*(.+)/i,
    ];

    for (const pattern of categoryPatterns) {
      const match = text.match(pattern);
      if (match) {
        let value = match[1].trim();
        value = value.replace(/^[\s\-–—]+/, "").replace(/[.,!?;:]+$/, "").trim();
        if (value) {
          // Return immediately - do NOT inspect value for other fields
          return { field: "category", value };
        }
      }
    }

    const categoryValue = findHebrewValue(normalized, CATEGORY_HEBREW_VALUES);
    if (categoryValue) {
      // Return immediately - do NOT inspect value for other fields
      return { field: "category", value: categoryValue };
    }
  }

  // 4. Explicit tone edits - check and return immediately
  if (normalized.includes("טון") || normalized.includes("tone")) {
    // Only check for explicit tone commands - look for "תשנה את הטון" or similar
    const explicitTonePatterns = [
      /תשנה את הטון ל[:\s]*(.+)/i,
      /שנה את הטון ל[:\s]*(.+)/i,
      /תעדכן את הטון ל[:\s]*(.+)/i,
      /הטון צריך להיות[:\s]*(.+)/i,
      /בטון[:\s]*(.+)/i,
      /טון[:\s]*(.+)/i,
    ];

    for (const pattern of explicitTonePatterns) {
      const match = text.match(pattern);
      if (match) {
        const toneValue = findHebrewValue(match[1], TONE_HEBREW_VALUES);
        if (toneValue) {
          // Return immediately - do NOT inspect other parts of message
          return { field: "tone", value: toneValue };
        }
      }
    }

    // Handle common natural phrases for tone
    if (normalized.includes("תעשי את זה יותר רגשי") || normalized.includes("יותר רגשי")) {
      return { field: "tone", value: "רגשי" };
    }
    if (normalized.includes("יותר מצחיק")) {
      return { field: "tone", value: "מצחיק" };
    }
    if (normalized.includes("פחות דרמטי")) {
      return { field: "tone", value: "רגשי" };
    }

    const toneValue = findHebrewValue(normalized, TONE_HEBREW_VALUES);
    if (toneValue) {
      return { field: "tone", value: toneValue };
    }
  }

  // 5. Explicit priority edits - check and return immediately
  if (normalized.includes("עדיפות") || normalized.includes("priority") ||
      normalized.includes("רמת עדיפות")) {
    const priorityValue = findHebrewValue(normalized, PRIORITY_HEBREW_VALUES);
    if (priorityValue) {
      // Return immediately - do NOT inspect value for other fields
      return { field: "priority", value: priorityValue };
    }
  }

  // === GENERIC/FUZZY INFERENCE - only used if explicit patterns fail ===
  // (kept for backwards compatibility with unsupported phrases)

  // Generic tone inference (only if no explicit field matched)
  if (normalized.includes("רגשי") || normalized.includes("מצחיק") ||
      normalized.includes("הומוריסטי") || normalized.includes("השראתי") ||
      normalized.includes("הסברתי") || normalized.includes("אותנטי") ||
      normalized.includes("טרנדי") || normalized.includes("דרמטי")) {
    const toneValue = findHebrewValue(normalized, TONE_HEBREW_VALUES);
    if (toneValue) {
      return { field: "tone", value: toneValue };
    }
  }

  return null;
};

export const applyEditToDraft = (draft: DraftSummary, edit: { field: string; value: string }): DraftSummary => {
  const updatedDraft = { ...draft };

  switch (edit.field) {
    case "shortName":
      updatedDraft.shortName = edit.value;
      break;
    case "category":
      updatedDraft.category = edit.value as any;
      updatedDraft.categoryExplicit = true;
      break;
    case "tone":
      updatedDraft.tone = edit.value as any;
      break;
    case "priority":
      updatedDraft.priority = edit.value as any;
      break;
    case "summary":
      updatedDraft.summary = edit.value;
      break;
  }

  return updatedDraft;
};

export const storePendingConfirmation = (userId: string, draft: DraftSummary): void => {
  pendingConfirmations.set(userId, draft);
};

export const getPendingConfirmation = (userId: string): DraftSummary | undefined => {
  return pendingConfirmations.get(userId);
};

export const clearPendingConfirmation = (userId: string): void => {
  pendingConfirmations.delete(userId);
};
// Archive intent detection
export const isArchiveCommand = (message: string): boolean => {
  const raw = message.trim().toLowerCase();
  return (
    raw.includes("ארכיון") ||
    raw.includes("לארכיון") ||
    raw.includes("בצד") ||
    (raw.includes("תעבירי") && raw.includes("ארכיון")) ||
    (raw.includes("תשמרי") && raw.includes("בצד"))
  );
};
export const isApproveForProductionCommand = (message: string): boolean => {
  const raw = message.trim();
  return (
    (raw.includes("תוסיפי") && raw.includes("להפקה")) ||
    (raw.includes("תוסיף") && raw.includes("להפקה")) ||
    (raw.includes("להעביר") && raw.includes("להפקה")) ||
    (raw.includes("תעבירי") && raw.includes("להפקה"))
  );
};

export const extractApproveTarget = (message: string): string | null => {
  const patterns = [
    /תוסיפי את (.+?) להפקה/i,
    /תוסיף את (.+?) להפקה/i,
    /להעביר את (.+?) להפקה/i,
    /תעבירי את (.+?) להפקה/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
};
export const extractArchiveTarget = (message: string): string | null => {
  const patterns = [
    /תעבירי את (.+?) לארכיון/i,
    /תעבירי את (.+?) בארכיון/i,
    /שימי את (.+?) בארכיון/i,
    /תשמרי את (.+?) בצד/i,
    /העבירי את (.+?) לארכיון/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
};
export const isViewArchiveCommand = (message: string): boolean => {
  const raw = message.trim().toLowerCase();
  const archiveWords = ["ארכיון", "רעיונות בצד", "בצד"];
  const viewWords = ["מה יש", "מה נמצא", "מה קיים", "איזה סרטונים", "אילו סרטונים", "תזכיר", "תזכירי"];
  const hasArchive = archiveWords.some((w) => raw.includes(w));
  const hasView = viewWords.some((w) => raw.includes(w));
  return hasArchive && hasView;
};

export const isRestoreCommand = (message: string): boolean => {
  const raw = message.trim().toLowerCase();
  return (
    (raw.includes("תחזרי") || raw.includes("תחזיר") || raw.includes("תחזירי") || raw.includes("תוציאי") || raw.includes("תוציא")) &&
    (raw.includes("ארכיון") || raw.includes("רעיונות") || raw.includes("בצד") || raw.includes("את"))
  );
};

export const extractRestoreTarget = (message: string): string | null => {
  const patterns = [
    /תחזרי את (.+?) לרעיונות/i,
    /תחזיר את (.+?) לרעיונות/i,
    /תחזירי את (.+?) לרעיונות/i,
    /תוציאי את (.+?) מהארכיון/i,
    /תוציא את (.+?) מהארכיון/i,
    /תחזרי את (.+?) מהארכיון/i,
    /תחזיר את (.+?) מהארכיון/i,
    /תחזירי את (.+?) מהארכיון/i,
    /תחזרי את (.+)/i,
    /תחזיר את (.+)/i,
    /תחזירי את (.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }

  return null;
};