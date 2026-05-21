import type { ProductionTaskRow } from "./sheets.service";

// Sprint 10: Visibility Intent Detection
// Deterministic routing for natural Hebrew visibility queries

export type VisibilityIntent =
  | "missing_edit"
  | "edited_not_uploaded"
  | "task_status"
  | "missing_cover"
  | "missing_copy"
  | "not_uploaded"
  | "category_search"
  | "stuck_workflow"
  | null;

export const extractStatusQueryTarget = (text: string): string | null => {
  const rawText = text.trim();
  const patterns = [
    /^(?:מה הסטטוס של)\s+(.+?)(?:\?|$)$/i,
    /^(?:מה מצב(?: הסרטון)? על)\s+(.+?)(?:\?|$)$/i,
    /^(?:איפה אני עומדת עם)\s+(.+?)(?:\?|$)$/i,
    /^(?:מה מצב)\s+(.+?)(?:\?|$)$/i,
    /^(?:מה קורה עם)\s+(.+?)(?:\?|$)$/i,
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const match = rawText.match(pattern);
    if (match && match[1]) {
      const target = match[1].trim().replace(/[?!]+$/, "").trim();
      if (!target) {
        continue;
      }
      const tokenCount = target.split(/\s+/).filter(Boolean).length;

      // Preserve category-search behavior for short "מה הסטטוס של X" queries
      // when the target is a single-word category name.
      if (index === 0 && tokenCount < 2) {
        continue;
      }

      return target;
    }
  }

  return null;
};

export const formatTaskStatusResponse = (task: { row: string[] }): string => {
  const taskName = task.row[1] || "תוכן";
  const filmed = task.row[3] || "לא";
  const edited = task.row[4] || "לא";
  const coverReady = task.row[5] || "לא";
  const copyReady = task.row[6] || "לא";
  const uploaded = task.row[7] || "לא";

  return `${taskName}:
צולם: ${filmed}
נערך: ${edited}
קאבר מוכן: ${coverReady}
קופי מוכן: ${copyReady}
הועלה: ${uploaded}`;
};

export const detectVisibilityIntent = (text: string): VisibilityIntent => {
  // Use raw text for intent detection to avoid filler word removal
  const rawText = text.toLowerCase();

  const taskStatusTarget = extractStatusQueryTarget(text);
  if (taskStatusTarget) {
    return "task_status";
  }

  // --- Edited but not uploaded intent ---
  const editedNotUploadedPhrases = [
    "מה ערכתי ועוד לא עלה",
    "מה ערכתי ולא עלה",
    "מה נערך ולא עלה",
    "איזה תכנים ערוכים ולא עלו",
    "מה ערוך ועדיין לא עלה",
    "מה כבר ערכתי ולא העליתי",
    "מה כבר ערכתי ולא עלה",
  ];
  if (editedNotUploadedPhrases.some((p) => rawText.includes(p))) {
    return "edited_not_uploaded";
  }

  // --- Missing Edit Intent ---
  // Flexible phrasings users commonly use. Any question about "ערוך/עריכה/ערוכים" maps deterministically.
  const editPhrases = [
    "נשאר לערוך",
    "מה נשאר לערוך",
    "מה עוד לא ערוך",
    "מה עוד לא נערך",
    "מה מחכה לעריכה",
    "איזה סרטונים עדיין לא ערוכים",
    "עוד לא ערוך",
    "מה עוד צריך עריכה",
    "איזה תכנים עוד לא מוכנים",
    "ערוך",
    "עריכה",
    "ערוכ",
  ];
  if (editPhrases.some((p) => rawText.includes(p))) {
    return "missing_edit";
  }

  // --- Missing Cover Intent ---
  const coverPhrases = [
    "קאבר",
    "בלי קאבר",
    "מה צריך קאבר",
    "מה חסר לו קאבר",
    "מה עוד בלי קאבר",
  ];
  if (coverPhrases.some((p) => rawText.includes(p))) {
    return "missing_cover";
  }

  // --- Missing Copy Intent ---
  const copyPhrases = [
    "קופי",
    "בלי קופי",
    "מה צריך קופי",
    "מה עוד בלי קופי",
  ];
  if (copyPhrases.some((p) => rawText.includes(p))) {
    return "missing_copy";
  }

  // --- Upload / Not Uploaded Intent ---
  const uploadPhrases = [
    "מה עדיין לא עלה",
    "מה נשאר לעלות",
    "מה עוד צריך לעלות",
    "מה מחכה להעלאה",
    "מה עוד לא באוויר",
    "מה עדיין לא פורסם",
    "איזה תכנים עוד לא עלו",
    "מה נשאר לפרסם",
    "עוד לא פורסם",
    "פורסם",
    "העלאה",
    "עלה",
    "באוויר",
  ];
  if (uploadPhrases.some((p) => rawText.includes(p))) {
    return "not_uploaded";
  }

  // --- Stuck Workflow Intent ---
  const stuckPhrases = [
    "תקוע",
    "נתקענו",
    "מה נתקע",
    "מה נתקע?",
    "מה לא מתקדם",
    "איפה אנחנו תקועים",
    "מה נתקע",
    "מה עוד מחכה",
  ];
  if (stuckPhrases.some((p) => rawText.includes(p))) {
    return "stuck_workflow";
  }

  // --- Category/Topic Search Intent ---
  const categoryPhrases = ["מה הסטטוס", "מה הסטטוס של", "מה קורה עם", "תראה לי תכני", "מה יש על"];
  if (categoryPhrases.some((p) => rawText.includes(p))) {
    return "category_search";
  }

  return null;
};

// Heuristic: if the user message looks like a visibility question but no intent matched,
// treat it as an unclear visibility query so controller can return a graceful fallback.
export const isLikelyVisibilityQuery = (text: string): boolean => {
  const raw = text.toLowerCase();
  const queryIndicators = ["מה", "איזה", "נשאר", "עוד", "מחכה", "?", "?", "למה"];
  const visibilityKeywords = ["ערוך", "עריכה", "קאבר", "קופי", "העלאה", "עלה", "פורסם", "תקוע", "סטטוס", "פרסם", "במק"].map((k) => k);

  const hasQueryWord = queryIndicators.some((q) => raw.includes(q));
  const hasVisKeyword = visibilityKeywords.some((k) => raw.includes(k));
  return hasQueryWord && hasVisKeyword;
};

export const isQuestionLikeMessage = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  if (trimmed.endsWith("?")) {
    return true;
  }

  return /^(מה|איזה|איפה|כמה|מי)\b/.test(normalized);
};

// Extract category/keyword from category search query
export const extractSearchKeyword = (text: string): string | null => {
  const normalized = text.trim().toLowerCase();

  // Pattern: "מה הסטטוס של X" or "מה קורה עם X"
  const categoryPattern = /(?:סטטוס|קורה|יש על|על|תכני|של)\s+(.+?)(?:\?|$)/i;
  const match = text.match(categoryPattern);
  if (match) {
    return match[1].trim().replace(/[?!.,:؛]/g, "").trim();
  }

  // If the text is just a category name
  if (text.length < 20) {
    return text.replace(/[?!.,:؛]/g, "").trim();
  }

  return null;
};

// Format a short visibility response
export const formatVisibilityResponse = (tasks: ProductionTaskRow[], intent: VisibilityIntent): string => {
  if (tasks.length === 0) {
    switch (intent) {
      case "missing_edit":
        return "אין תוכן שצריך עריכה! 🎉";
      case "missing_cover":
        return "כל התכנים יש להם קאבר! 🎉";
      case "missing_copy":
        return "כל התכנים יש להם קופי! 🎉";
      case "not_uploaded":
        return "כל התכנים הועלו! 🎉";
      case "stuck_workflow":
        return "אין תוכן תקוע! 🎉";
      case "category_search":
        return "לא נמצא תוכן בקטגוריה זו.";
      default:
        return "לא נמצא תוכן רלוונטי.";
    }
  }

  // Format short list of task names
  const taskNames = tasks
    .map((task) => `- ${task.taskName}`)
    .slice(0, 5)
    .join("\n");

  const suffix = tasks.length > 5 ? `\n...ו${tasks.length - 5} עוד` : "";

  switch (intent) {
    case "missing_edit":
      return `נשאר לערוך:\n${taskNames}${suffix}`;
    case "edited_not_uploaded":
      return `נערך ועדיין לא עלה:\n${taskNames}${suffix}`;
    case "missing_cover":
      return `חסר קאבר:\n${taskNames}${suffix}`;
    case "missing_copy":
      return `חסר קופי:\n${taskNames}${suffix}`;
    case "not_uploaded":
      return `לא עלה עדיין:\n${taskNames}${suffix}`;
    case "stuck_workflow":
      return `תוכן תקוע:\n${taskNames}${suffix}`;
    case "category_search":
      return `תכנים בקטגוריה:\n${taskNames}${suffix}`;
    default:
      return taskNames;
  }
};
