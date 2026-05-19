import { DraftSummary } from "../types/content.types";

// In-memory storage for pending confirmations (MVP)
const pendingConfirmations = new Map<string, DraftSummary>();

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

export const isEditRequest = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const editIndicators = [
    "תשנה", "שנה", "תשני", "שני", "תעדכן", "עדכן", "תעדכני", "עדכני",
    "תקרא", "קרא", "הטון", "העדיפות",
    "הקטגוריה", "הסיכום", "זה לא", "לא נכון", "טעות",
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

  // Priority edits - more natural patterns
  if (normalized.includes("עדיפות") || normalized.includes("priority") ||
      normalized.includes("רמת עדיפות")) {
    const priorityValue = findHebrewValue(normalized, PRIORITY_HEBREW_VALUES);
    if (priorityValue) {
      return { field: "priority", value: priorityValue };
    }
  }

  // Tone edits - more natural patterns
  if (normalized.includes("טון") || normalized.includes("tone") ||
      normalized.includes("רגשי") || normalized.includes("מצחיק") ||
      normalized.includes("הומוריסטי") || normalized.includes("השראתי") ||
      normalized.includes("הסברתי") || normalized.includes("אותנטי") ||
      normalized.includes("טרנדי") || normalized.includes("דרמטי")) {
    // Handle common natural phrases first
    if (normalized.includes("תעשי את זה יותר רגשי") || normalized.includes("יותר רגשי")) {
      return { field: "tone", value: "רגשי" };
    }
    if (normalized.includes("יותר מצחיק") || normalized.includes("יותר מצחיק")) {
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

  // Category edits - more natural patterns
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
          return { field: "category", value };
        }
      }
    }

    const categoryValue = findHebrewValue(normalized, CATEGORY_HEBREW_VALUES);
    if (categoryValue) {
      return { field: "category", value: categoryValue };
    }
  }

  // Short name edits - improved patterns
  if (normalized.includes("שם") || normalized.includes("קרא") || normalized.includes("name") ||
      normalized.includes("תקרא") || normalized.includes("שנה שם")) {
    // More flexible name extraction patterns
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
          return { field: "shortName", value: words.trim() };
        }
      }
    }
  }

  // Summary edits
  if (normalized.includes("סיכום") || normalized.includes("summary") ||
      normalized.includes("תיאור")) {
    // Extract everything after summary indicators
    const summaryPatterns = [
      /(?:סיכום|summary|תיאור)[:\s]*(.+)/i,
      /שנה את הסיכום ל[:\s]*(.+)/i,
      /הסיכום צריך להיות[:\s]*(.+)/i,
    ];

    for (const pattern of summaryPatterns) {
      const match = text.match(pattern);
      if (match) {
        return { field: "summary", value: match[1].trim() };
      }
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
