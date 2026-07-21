import { DraftSummary } from "../types/content.types";
import { getValue, setValue, deleteValue, StateSection } from "./persistence.service";

// Stage G: pending state moved from in-memory Maps to persistence.service
// (data/agent-state.json) so it survives restarts. Public function
// signatures are unchanged — only the storage engine was replaced.

// Pending question context - what the agent last asked
type PendingQuestion = {
  questionType: string;  // e.g. "show_trends", "confirm_deadline", "show_more"
  context?: Record<string, unknown>;  // optional extra data
};

// ---------------------------------------------------------------------------
// Stage H — pending-state TTL (routing audit finding F0).
//
// Pending drafts and pending questions are MODAL state: their mere presence
// changes how every subsequent message is routed (edit branch, continuation
// detection, escape hatches). Without an expiry, a draft from last night
// still hijacks this morning's messages — and since Stage G the state also
// survives restarts via agent-state.json. A stale modal state is worse than
// no state.
//
// Design: lazy expiry on read, no timers. Values are stored inside a
// timestamped envelope; a read older than PENDING_STATE_TTL_MS deletes the
// entry on the spot and reports "no pending state", so the message routes
// fresh. Legacy entries written before this change (bare values, no
// envelope) are grandfathered in as-is so a deploy can never kill a flow
// that is active at that moment — they gain an envelope on their next store.
// ---------------------------------------------------------------------------

const DEFAULT_PENDING_STATE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export const PENDING_STATE_TTL_MS: number = (() => {
  const fromEnv = process.env.PENDING_STATE_TTL_MS;
  if (!fromEnv) return DEFAULT_PENDING_STATE_TTL_MS;
  const parsed = parseInt(fromEnv, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_PENDING_STATE_TTL_MS : parsed;
})();

type TimedEnvelope<T> = { __envelope: true; storedAt: string; value: T };

const wrapTimed = <T>(value: T): TimedEnvelope<T> => ({
  __envelope: true,
  storedAt: new Date().toISOString(),
  value,
});

const unwrapTimed = <T>(
  raw: unknown,
  section: StateSection,
  userId: string
): T | undefined => {
  if (raw === undefined || raw === null) return undefined;

  const looksLikeEnvelope =
    typeof raw === "object" && raw !== null && (raw as any).__envelope === true;

  // Legacy shape (pre-TTL): the bare value was stored directly.
  if (!looksLikeEnvelope) return raw as T;

  const envelope = raw as TimedEnvelope<T>;
  const ageMs = Date.now() - new Date(envelope.storedAt).getTime();

  // Unparseable timestamp is treated as expired — a broken envelope must
  // never become immortal modal state.
  if (Number.isNaN(ageMs) || ageMs > PENDING_STATE_TTL_MS) {
    deleteValue(section, userId);
    const ageLabel = Number.isNaN(ageMs) ? "unknown" : `${Math.round(ageMs / 60000)} min`;
    console.log(
      `[pending-state TTL] Expired ${section} entry for ${userId} (age: ${ageLabel}). Treating as absent.`
    );
    return undefined;
  }

  return envelope.value;
};

export const storePendingQuestion = (userId: string, question: PendingQuestion): void => {
  setValue("pendingQuestions", userId, wrapTimed(question));
};
export const getPendingQuestion = (userId: string): PendingQuestion | undefined => {
  return unwrapTimed<PendingQuestion>(
    getValue<unknown>("pendingQuestions", userId),
    "pendingQuestions",
    userId
  );
};
export const clearPendingQuestion = (userId: string): void => {
  deleteValue("pendingQuestions", userId);
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

const CONTENT_TYPE_HEBREW_VALUES: Record<string, string> = {
  "ריל": "ריל",
  "פוסט": "פוסט",
  "סטורי": "סטורי",
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

export const displayContentType = (contentType: string | undefined): string => {
  return CONTENT_TYPE_HEBREW_VALUES[contentType || ""] || contentType || "ריל";
};

export const displayPlatform = (platform: string): string => {
  return PLATFORM_HEBREW_VALUES[platform] || platform;
};

export const isConfirmationMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();

  // Exact-match yes messages — original behavior preserved.
  const exactYes = ["כן", "מאשרת", "תאשר", "תעשה את זה", "סגור", "בסדר", "טוב", "אישור"];
  if (exactYes.includes(normalized)) return true;

  // Natural confirmation phrasings. Prefix matches (not substring) so
  // that a negation like "לא, בעצם כן" cannot false-positive — the
  // negation would come first, so startsWith rules it out.
  const confirmationPrefixes = [
    "בעצם כן",       // "בעצם כן, בואי נשמור"
    "כן ",           // "כן תשמרי" / "כן שמרי"
    "כן,",           // "כן, בואי נשמור"
    "כן.",           // "כן. תשמרי"
    "כן!",
    "בואי נשמור",
    "בוא נשמור",
    "תשמרי בבקשה",
    "תשמור בבקשה",
  ];
  return confirmationPrefixes.some((prefix) => normalized.startsWith(prefix));
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

  // "רעיון חדש" with a colon (e.g. "רעיון חדש: ...") is a new-idea command, not a reset —
  // exclude it explicitly so the two detectors never both fire on the same message.
  return resetCommands.some((command) => {
    if (command === "רעיון חדש") return normalized === command;
    return normalized === command || normalized.startsWith(`${command}:`);
  });
};

export const isNewIdeaCommand = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();

  // Exact "רעיון חדש" alone (no extra words) is handled by isResetRequest, not here.
  if (normalized === "רעיון חדש") return false;

  // Stage F0: accept "רעיון חדש" / "רעיון חדש ל<כל מילה>" with or without ":",
  // with or without a line break before the actual idea text.
  // Examples that must match:
  //   "רעיון חדש: ..."
  //   "רעיון חדש לפוסט: ..."
  //   "רעיון חדש לריל ...\n..."
  //   "רעיון חדש לסרטון\n..."
  //   "רעיון חדש על ..."
  return normalized.startsWith("רעיון חדש") && normalized.length > "רעיון חדש".length;
};

export const getNewIdeaText = (text: string): string | null => {
  // Stage F0: tolerate missing ":", line breaks, and any "ל<תוכן>" / "על" qualifier
  // between "רעיון חדש" and the actual idea description.
  const match = text.match(/רעיון חדש(?:\s+(?:ל\S+|על))?\s*:?\s*[\r\n]*\s*(.+)/is);
  if (!match) return null;
  const captured = match[1].trim();
  return captured.length > 0 ? captured : null;
};
export const getNewIdeaContentType = (text: string): "פוסט" | "ריל" | null => {
  const normalized = text.trim().toLowerCase();

  if (normalized.startsWith("רעיון חדש לפוסט")) return "פוסט";
  if (normalized.startsWith("רעיון חדש לריל")) return "ריל";
  // Stage F0: "סרטון" is colloquial for "ריל" — treat it the same way.
  if (normalized.startsWith("רעיון חדש לסרטון")) return "ריל";

  return null;
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
    "תקרא", "קרא", "הטון", "העדיפות", "סוג תוכן", "ריל", "פוסט", "סטורי",
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
      normalized.includes("תיאור") || normalized.includes("כיוון")) {
    // Extract everything after summary indicators - explicit patterns only
    // "כיוון" (direction) included because that's the label the bot itself
    // shows in draft messages ("הכיוון: ...") — users naturally echo it back.
    const summaryPatterns = [
      /תשנה את הכיוון ל[:\s]*[\r\n]*\s*(.+)/is,
      /שנה את הכיוון ל[:\s]*[\r\n]*\s*(.+)/is,
      /תעדכן את הכיוון ל[:\s]*[\r\n]*\s*(.+)/is,
      /הכיוון צריך להיות[:\s]*[\r\n]*\s*(.+)/is,
      /תשנה את הסיכום ל[:\s]*[\r\n]*\s*(.+)/is,
      /שנה את הסיכום ל[:\s]*[\r\n]*\s*(.+)/is,
      /תעדכן את הסיכום ל[:\s]*[\r\n]*\s*(.+)/is,
      /הסיכום צריך להיות[:\s]*[\r\n]*\s*(.+)/is,
      /בסיכום תכתוב[:\s]*[\r\n]*\s*(.+)/is,
      /שנה סיכום ל[:\s]*[\r\n]*\s*(.+)/is,
      /(?:ואת\s+|וגם\s+את\s+)?(?:ה\s*)?(?:כיוון|סיכום|תיאור)\s*(?:ל|ל־|ל-)?\s*(.+)/is,
      /(?:סיכום|summary|תיאור|כיוון)[:\s]*[\r\n]*\s*(.+)/is,
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
    // 5. Explicit content type edits - check and return immediately
    if (
      normalized.includes("סוג תוכן") ||
      normalized.includes("סוג התוכן") ||
      normalized.includes("זה ריל") ||
      normalized.includes("זה פוסט") ||
      normalized.includes("זה סטורי") ||
      normalized.includes("content type")
    ) {
      const contentTypePatterns = [
        /(?:ואת\s+)?(?:סוג\s+התוכן|סוג\s+תוכן)\s*(?:ל|ל־|בתור|כ)?\s*(.+)/i,
        /(?:תשני|שני|תעדכני|עדכני|תשנה|שנה|תעדכן|עדכן)\s*(?:את\s+)?(?:סוג\s+התוכן|סוג\s+תוכן)\s*(?:ל|ל־|בתור|כ)?\s*(.+)/i,
      ];

      for (const pattern of contentTypePatterns) {
        const match = text.match(pattern);
        if (match) {
          const contentTypeValue = findHebrewValue(match[1], CONTENT_TYPE_HEBREW_VALUES);
          if (contentTypeValue) {
            return { field: "contentType", value: contentTypeValue };
          }
        }
      }

      const contentTypeValue = findHebrewValue(normalized, CONTENT_TYPE_HEBREW_VALUES);
      if (contentTypeValue) {
        return { field: "contentType", value: contentTypeValue };
      }
    }

    // 6. Explicit priority edits - check and return immediately
    if (
      normalized.includes("עדיפות") ||
      normalized.includes("priority") ||
      normalized.includes("רמת עדיפות")
    ) {
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
    case "contentType":
      updatedDraft.contentType = edit.value as any;
      break;
    case "summary":
      updatedDraft.summary = edit.value;
      break;
  }

  return updatedDraft;
};

export const storePendingConfirmation = (userId: string, draft: DraftSummary): void => {
  // Stage H: stored inside a timestamped envelope — see unwrapTimed above.
  setValue("pendingConfirmations", userId, wrapTimed(draft));
};

export const getPendingConfirmation = (userId: string): DraftSummary | undefined => {
  return unwrapTimed<DraftSummary>(
    getValue<unknown>("pendingConfirmations", userId),
    "pendingConfirmations",
    userId
  );
};

export const clearPendingConfirmation = (userId: string): void => {
  deleteValue("pendingConfirmations", userId);
};
// Archive intent detection
export const isArchiveCommand = (message: string): boolean => {
  const raw = message.trim().toLowerCase();
  // Audit F7: bare "בצד" removed as a trigger — it appears inside ordinary
  // idea messages ("לשים דגש בצד של ההורים", "רעיון על הצד הכלכלי... בצד
  // המשפטי") and hijacked them into the archive flow, including through the
  // modal escape hatches. "בצד" now requires a put-aside verb, and the
  // positional form "בצד של X" is explicitly excluded.
  const ASIDE_VERBS = ["תשמרי", "שימי", "תשימי", "נשים", "לשים", "שים את", "שמרי", "תעבירי"];
  const hasAsideIntent =
    raw.includes("בצד") &&
    !raw.includes("בצד של") &&
    ASIDE_VERBS.some((verb) => raw.includes(verb));
  return raw.includes("ארכיון") || hasAsideIntent;
};
export const isApproveForProductionCommand = (message: string): boolean => {
  const raw = message.trim();
  // Expanded 21.7.2026 from the live logs: Karen used male/other inflections
  // ("תעביר", "העבר", "מעביר") and the "מאושר להפקה" phrasing, none of which
  // the original four-form list caught — so every attempt fell through to
  // draft creation and made a duplicate. A move verb + production mention, OR
  // an approval word + production mention, now all route here.
  const MOVE_VERBS = ["תוסיפי", "תוסיף", "להעביר", "תעבירי", "תעביר", "העבר", "העברי", "מעביר", "מעבירה", "מעבירי"];
  const APPROVE_WORDS = ["מאושר", "מאושרת", "אשר", "אשרי", "לאשר"];
  const mentionsProduction = raw.includes("להפקה") || raw.includes("הפקה");
  if (!mentionsProduction) return false;
  const hasMoveVerb = MOVE_VERBS.some((v) => raw.includes(v));
  const hasApproveWord = APPROVE_WORDS.some((w) => raw.includes(w));
  return hasMoveVerb || hasApproveWord;
};

export const extractApproveTarget = (message: string): string | null => {
  // Expanded 21.7.2026: mirror the wider verb list in
  // isApproveForProductionCommand so "תעביר את בת זוג של אוהד להפקה" (and
  // other inflections) yield the content name instead of null -> parse error.
  const raw = message.trim();
  const VERBS = ["תוסיפי", "תוסיף", "להעביר", "תעבירי", "תעביר", "העברי", "העבר", "מעבירה", "מעבירי", "מעביר", "לאשר", "אשרי", "אשר"];

  let name = raw;
  name = name.replace(/מאושר(ת)?/g, " ").replace(/להפקה/g, " ").replace(/הפקה/g, " ");
  for (const v of VERBS) {
    const re = new RegExp(`(^|\\s)${v}(\\s|$)`);
    if (re.test(name)) { name = name.replace(re, " "); break; }
  }
  name = name
    .replace(/(^|\s)את(\s|$)/g, " ")
    .replace(/(^|\s)הרעיון(\s|$)/g, " ")
    .replace(/(^|\s)רעיון(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return name.length > 0 ? name : null;
};
export const extractArchiveTarget = (message: string): string | null => {
  // Patterns ordered from most specific to least. The "with את" patterns
  // are tried first so a message like "תעבירי את X לארכיון" doesn't
  // accidentally grab "את X" as the target from a looser fallback pattern.
  const patterns = [
    // With explicit את
    /תעבירי\s+את\s+(.+?)\s+לארכיון/i,
    /תעבירי\s+את\s+(.+?)\s+בארכיון/i,
    /שימי\s+את\s+(.+?)\s+בארכיון/i,
    /תשמרי\s+את\s+(.+?)\s+בצד/i,
    /העבירי\s+את\s+(.+?)\s+לארכיון/i,
    // Fallback: same intent without "את". Karen often drops it in natural
    // speech ("תעבירי זוגיות בזמן ארגון חתונה לארכיון").
    /תעבירי\s+(.+?)\s+לארכיון/i,
    /תעבירי\s+(.+?)\s+בארכיון/i,
    /העבירי\s+(.+?)\s+לארכיון/i,
    /שימי\s+(.+?)\s+בארכיון/i,
    /תשמרי\s+(.+?)\s+בצד/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const target = match[1].trim();
      // Guard against a zero-length or too-short accidental match.
      // Real content names are >= 2 non-space chars.
      if (target.length >= 2) return target;
    }
  }

  return null;
};

// Bulk archive: Karen sends "תעבירי לארכיון:" followed by a numbered or
// bulleted list of ideas. Detected only when the message contains an
// archive verb AND at least two list-shaped lines after the first line.
// Anything with 0 or 1 list items is left to the single-archive path
// (extractArchiveTarget) — bulk is only meaningful for multi-item requests.
export const isBulkArchiveCommand = (message: string): boolean => {
  const raw = message.trim();
  if (!isArchiveCommand(raw)) return false;
  const items = extractBulkArchiveItems(raw);
  return items.length >= 2;
};

// Parse a numbered or bulleted list from the message body.
// Recognised prefixes: "1. ", "1) ", "* ", "- ", "• ", "· ".
// Skips the first line (which is Karen's intro like "תעבירי לארכיון:").
// Whitespace and item numbering are stripped from each returned line.
export const extractBulkArchiveItems = (message: string): string[] => {
  const lines = message.split(/\r?\n/);
  const items: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Numbered: "1. text" / "1) text" / "1- text"
    const numberedMatch = line.match(/^(\d+)[.)\-]\s*(.+)$/);
    if (numberedMatch) {
      const item = numberedMatch[2].trim().replace(/[?.!]+$/, "").trim();
      if (item.length >= 2) items.push(item);
      continue;
    }

    // Bulleted: "* text" / "- text" / "• text" / "· text"
    const bulletMatch = line.match(/^[*\-•·]\s*(.+)$/);
    if (bulletMatch) {
      const item = bulletMatch[1].trim().replace(/[?.!]+$/, "").trim();
      if (item.length >= 2) items.push(item);
      continue;
    }
  }

  return items;
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
  // Audit F1: "את" was previously accepted as a second keyword, but it
  // appears in almost every Hebrew sentence with a direct object — so any
  // "תחזירי את X" (e.g. reverting a draft edit: "תחזירי את הטון הקודם") was
  // hijacked as an archive-restore command, including through the modal
  // escape hatches. Restore now requires an explicit archive-context word.
  return (
    (raw.includes("תחזרי") || raw.includes("תחזיר") || raw.includes("תחזירי") || raw.includes("תוציאי") || raw.includes("תוציא")) &&
    (raw.includes("ארכיון") || raw.includes("רעיונות") || raw.includes("בצד"))
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

// ===== Bridge (bank→gantt) — step 1, 12.7.2026 =====
// Classifies Karen's answer to the post-save scheduling offer
// ("לשבץ אותו כבר, או להשאיר בבנק בינתיים?").
// Exported so QA can exercise it behaviorally.
// Order matters: rejection/keep phrasings are checked BEFORE schedule
// phrasings, so "לא לשבץ" and "כן אבל לא עכשיו" resolve to "keep".
export type BridgeOfferAnswer = "schedule" | "keep" | "unclear";

const BRIDGE_KEEP_PHRASES = [
  "להשאיר", "בבנק", "בינתיים", "לא עכשיו", "אחר כך", "אחכ", "אח\"כ", "עוד לא", "עזבי",
];
const BRIDGE_SCHEDULE_PHRASES = ["לשבץ", "שבצי", "תשבצי", "נשבץ", "קדימה", "יאללה", "בטח", "סבבה"];

export const classifyBridgeOfferAnswer = (message: string): BridgeOfferAnswer => {
  const raw = message.trim().toLowerCase();

  if (raw.startsWith("לא") || isRejectionMessage(message)) return "keep";
  if (BRIDGE_KEEP_PHRASES.some((phrase) => raw.includes(phrase))) return "keep";
  if (isConfirmationMessage(message) || BRIDGE_SCHEDULE_PHRASES.some((phrase) => raw.includes(phrase))) {
    return "schedule";
  }
  return "unclear";
};

// ===== Gantt date change (priority 1 from live logs, 21.7.2026) =====
// Karen tried five times to move a scheduled gantt item to another date
// ("שנה תאריך של X ל-29/7", "X שנה ל-29/07/2026") and every attempt fell
// through to no_pending_for_edit — the detector simply didn't exist.
// Note: evaluated only under a clean state (no draft/question pending) — the
// caller guarantees this. Under a clean state a move verb + target date
// unambiguously means "move a scheduled gantt item", because field edits
// ("שנה טון") only happen while a draft is open. That state separation is
// what lets us accept Karen's natural phrasing without keyword requirements.
const GANTT_MOVE_VERBS = ["שנה", "תשנה", "שני", "תשני", "תזיז", "תזיזי", "הזז", "הזיזי", "העבר", "העברי", "תעביר", "תעבירי"];
const GANTT_DATE_PATTERN = /(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}|\d{2}))?/;

export const isGanttDateChange = (message: string): boolean => {
  const raw = message.trim();
  const hasVerb = GANTT_MOVE_VERBS.some((v) => raw.includes(v));
  const hasTargetDate = GANTT_DATE_PATTERN.test(raw);
  return hasVerb && hasTargetDate;
};

export const extractGanttDateChange = (
  message: string
): { contentName: string; targetDate: string } | null => {
  const raw = message.trim();
  const dateMatch = raw.match(GANTT_DATE_PATTERN);
  if (!dateMatch) return null;
  const targetDate = dateMatch[0];

  let name = raw;
  name = name.replace(new RegExp(`ל[-\\s]?${targetDate.replace(/[.]/g, "\\.")}`), " ");
  name = name.replace(targetDate, " ");
  for (const verb of GANTT_MOVE_VERBS) name = name.replace(new RegExp(`(^|\\s)${verb}(\\s|$)`, "g"), " ");
  name = name
    .replace(/תאריך/g, " ")
    .replace(/בגאנט/g, " ")
    .replace(/גאנט/g, " ")
    .replace(/(^|\s)של(\s|$)/g, " ")
    .replace(/(^|\s)את(\s|$)/g, " ")
    .replace(/(^|\s)ל(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return null;
  return { contentName: name, targetDate };
};
