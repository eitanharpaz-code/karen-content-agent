import type { ProductionTaskRow, ProductionTaskRowExtended } from "./sheets.service";
import { isThisWeek } from "../utils/date-utils";

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
  | "priority_filter"
  | "whats_important"
  | null;

/**
 * Normalize a task-status target for matching.
 * Cleans up formatting issues that prevent matching against stored task names.
 * 
 * Removes:
 * - Line breaks (replaced with spaces)
 * - Surrounding quotes (", ', ״, ׳)
 * - Copied idea prefixes from the beginning
 * - Generic wrapper words from the beginning
 */
const normalizeTaskStatusTargetForMatching = (text: string): string => {
  if (!text) return "";

  let normalized = text;

  // 1. Replace line breaks with spaces
  normalized = normalized.replace(/[\n\r]+/g, " ");

  // 2. Remove surrounding quotes: ", ', ״, ׳
  normalized = normalized.replace(/^["'״׳\s]+/, "").replace(/["'״׳\s]+$/, "").trim();

  // 3. Remove copied idea prefixes from the beginning
  const ideaPrefixes = [
    "רעיון חדש:",
    "רעיון חדש-",
    "רעיון חדש",
    "יש לי רעיון חדש",
    "יש לי רעיון",
    "רעיון לסרטון",
  ];

  for (const prefix of ideaPrefixes) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.substring(prefix.length).trim();
      break;
    }
  }

  // 4. Remove generic wrapper words from the beginning
  const wrapperPrefixes = [
    "הסרטון על",
    "סרטון על",
    "התוכן על",
    "הרעיון על",
  ];

  for (const prefix of wrapperPrefixes) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.substring(prefix.length).trim();
      break;
    }
  }

  return normalized.trim();
};

export const extractStatusQueryTarget = (text: string): string | null => {
  const conversationalPrefixes = [
    /^ועכשיו[,،]?\s*/i,
    /^אוקיי[,،]?\s*/i,
    /^אוקי[,،]?\s*/i,
    /^רגע[,،]?\s*/i,
    /^אז[,،]?\s*/i,
    /^טוב[,،]?\s*/i,
    /^בסדר[,،]?\s*/i,
    /^אגב[,،]?\s*/i,
  ];
  let rawText = text.trim();
  for (const prefix of conversationalPrefixes) {
    rawText = rawText.replace(prefix, "");
  }
  rawText = rawText.trim();
  const patterns = [
    // "מה הסטטוס של X" - requires multi-word for exact match (single-word goes to category_search)
    { regex: /^(?:מה הסט[טא]טוס של)\s+(.+?)(?:\?|$)/is, multiWordOnly: true },
    // "מה מצב [הסרטון] על X"
    { regex: /^(?:מה מצב(?:\s+הסרטון)?\s+על)\s+(.+?)(?:\?|$)/is, multiWordOnly: false },
    // "איפה אני עומדת עם X"
    { regex: /^(?:איפה אני עומדת עם)\s+(.+?)(?:\?|$)/is, multiWordOnly: false },
    // "מה מצב X"
    { regex: /^(?:מה מצב)\s+(.+?)(?:\?|$)/is, multiWordOnly: false },
    // "מה קורה עם X" or "מה עם X" - requires multi-word (single-word goes to category/question-like)
    { regex: /^(?:מה\s+(?:קורה\s+)?עם)\s+(.+?)(?:\?|$)/is, multiWordOnly: true },
  ];

  for (const { regex, multiWordOnly } of patterns) {
    const match = rawText.match(regex);
    if (match && match[1]) {
      let target = match[1].trim().replace(/[?!]+$/, "").trim();
      if (!target) {
        continue;
      }
      
      // Normalize the target to handle formatting issues (quotes, line breaks, prefixes, etc.)
      target = normalizeTaskStatusTargetForMatching(target);
      if (!target) {
        continue;
      }
      
      const tokenCount = target.split(/\s+/).filter(Boolean).length;

      // Skip single-word targets if the pattern requires multi-word
      if (multiWordOnly && tokenCount < 2) {
        continue;
      }

      return target;
    }
  }

  return null;
};

export const formatTaskStatusResponse = (task: { row: string[] }): string => {
  const contentId = task.row[0] || "";
  const taskName = task.row[1] || "תוכן";
  const displayName = contentId ? `${taskName} (${contentId})` : taskName;
  const filmed = task.row[3] || "לא";
  const edited = task.row[4] || "לא";
  const coverReady = task.row[5] || "לא";
  const copyReady = task.row[6] || "לא";
  const uploaded = task.row[7] || "לא";

  return `${displayName}:
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
    "חסר קאבר",
    "אין קאבר",
    "ללא קאבר",
    "קאבר חסר",
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
    "חסר קופי",
    "אין קופי",
    "ללא קופי",
    "קופי חסר",
  ];
  if (copyPhrases.some((p) => rawText.includes(p))) {
    return "missing_copy";
  }

  // --- Upload / Not Uploaded Intent ---
  const uploadPhrases = [
    "מה עדיין לא עלה",
    "מה עוד לא עלה",
    "מה לא עלה",
    "תראה לי מה לא עלה",
    "מה נשאר לעלות",
    "מה עוד צריך לעלות",
    "מה מחכה להעלאה",
    "מה עוד לא באוויר",
    "מה עדיין לא פורסם",
    "איזה תכנים עוד לא עלו",
    "מה נשאר לפרסם",
    "עוד לא פורסם",
    "לא עלה עדיין",
    "עדיין לא עלה",
    "מה טרם עלה",
    "פורסם",
    "העלאה",
    "באוויר",
  ];
  if (uploadPhrases.some((p) => rawText.includes(p))) {
    return "not_uploaded";
  }

  // --- Stuck Workflow Intent ---
  const stuckPhrases = [
    "תקוע",
    "תקועה",
    "מה תקוע",
    "מה תקועה",
    "נתקענו",
    "מה נתקע",
    "מה נתקע אצלי",
    "מה לא מתקדם",
    "איפה אנחנו תקועים",
    "מה עוד מחכה",
  ];
  if (stuckPhrases.some((p) => rawText.includes(p))) {
    return "stuck_workflow";
  }

  // --- Category/Topic Search Intent ---
  const categoryPhrases = ["מה הסטטוס", "מה הסטטוס של", "מה הסטאטוס", "מה הסטאטוס של", "מה קורה עם", "תראה לי תכני", "מה יש על"];
  if (categoryPhrases.some((p) => rawText.includes(p))) {
    return "category_search";
  }

  // --- What's Important Now Intent ---
  const whatsImportantPhrases = [
    "מה הכי חשוב עכשיו",
    "מה הכי חשוב",
    "מה חשוב עכשיו",
    "מה חשוב",
    "מה דחוף",
    "מה הכי דחוף",
    "מה דחוף עכשיו",
    "מה אני צריכה לעשות",
    "מה צריך לעשות",
    "מה הצעד הבא",
    "מה כדאי להעלות",
    "מה כדאי לעלות",
    "מה להעלות",
    "מה לעלות",
    "מה לעלות השבוע",
    "מה להעלות השבוע",
  ];
  if (whatsImportantPhrases.some((p) => rawText.includes(p))) {
    return "whats_important";
  }

  // --- Priority Filter Intent ---
  const priorityFilterPhrases = [
    "מה בעדיפות גבוה",
    "מה בעדיפות גבוהה",
    "בעדיפות גבוה",
    "בעדיפות גבוהה",
    "עדיפות גבוה",
    "עדיפות גבוהה",
    "תראי גבוה",
    "תראי לי גבוה",
    "תראי גבוהה",
    "מה גבוה",
    "מה גבוהה",
    "מה בעדיפות בינוני",
    "מה בעדיפות בינונית",
    "בעדיפות בינוני",
    "בעדיפות בינונית",
    "עדיפות בינוני",
    "עדיפות בינונית",
    "תראי בינוני",
    "תראי לי בינוני",
    "מה בינוני",
    "מה בעדיפות נמוך",
    "מה בעדיפות נמוכה",
    "בעדיפות נמוך",
    "בעדיפות נמוכה",
    "עדיפות נמוך",
    "עדיפות נמוכה",
    "תראי נמוך",
    "תראי לי נמוך",
    "מה נמוך",
    "מה נמוכה",
  ];
  if (priorityFilterPhrases.some((p) => rawText.includes(p))) {
    return "priority_filter";
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
  
  // Check for trailing question mark
  if (trimmed.endsWith("?")) {
    return true;
  }

  // Single-word question starters (interrogative words)
  const singleWordPattern = /^(מה|איזה|איזו|אילו|איפה|כמה|מי)\b/;
  if (singleWordPattern.test(normalized)) {
    return true;
  }

  // Multi-word question starters
  const multiWordPattern = /^(תראה לי|תראי לי|יש משהו|יש תכנים|מה עם)\s/;
  if (multiWordPattern.test(normalized)) {
    return true;
  }

  return false;
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
export const extractPriorityFromQuery = (text: string): string | null => {
  const raw = text.toLowerCase();
  if (raw.includes("גבוה") || raw.includes("גבוהה")) return "גבוה";
  if (raw.includes("בינוני") || raw.includes("בינונית")) return "בינוני";
  if (raw.includes("נמוך") || raw.includes("נמוכה")) return "נמוך";
  return null;
};

export const formatWhatsImportantResponse = (
  highPriorityNotUploaded: ProductionTaskRowExtended[],
  stuckTasks: ProductionTaskRowExtended[],
  trendTasks: ProductionTaskRowExtended[],
  thisWeekTasks: ProductionTaskRowExtended[]
): string => {
  const lines: string[] = [];

  if (thisWeekTasks.length > 0) {
    lines.push("השבוע אמורים לעלות:");
    thisWeekTasks.slice(0, 5).forEach((t) => {
      if (t.filmed !== "כן") {
        lines.push(`- ${t.taskName} (יום ${t.deadlineDayName})`);
        lines.push(`  שימי לב, את הסרטון הזה עדיין לא צילמת`);
      } else if (t.edited !== "כן") {
        lines.push(`- ${t.taskName} (יום ${t.deadlineDayName})`);
        lines.push(`  שימי לב, את הסרטון הזה עדיין לא ערכת`);
      } else {
        lines.push(`- ${t.taskName} (יום ${t.deadlineDayName})`);
      }
    });
    if (thisWeekTasks.length > 5) {
      lines.push(`בנוסף את מתוכננת להעלות עוד ${thisWeekTasks.length - 5} סרטונים, לצפייה בהם כנסי לגוגל שיטס`);
    }
  }

  if (highPriorityNotUploaded.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("תכנים בעדיפות גבוהה שעוד לא עלו:");
    highPriorityNotUploaded.slice(0, 5).forEach((t) => lines.push(`- ${t.taskName}`));
  }

  if (stuckTasks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("תקוע - צולם ועדיין לא נערך:");
    stuckTasks.slice(0, 3).forEach((t) => lines.push(`- ${t.taskName}`));
  }

  if (lines.length === 0) {
    lines.push("הכל נראה בסדר כרגע.");
  }

  if (trendTasks.length > 0) {
    lines.push(`\nוגם יש ${trendTasks.length} טרנדים שעדיין לא עלו:`);
    trendTasks.forEach((t) => lines.push(`- ${t.taskName}`));
  }

  return lines.join("\n");
};

export const formatPriorityFilterResponse = (
  tasks: ProductionTaskRowExtended[],
  priority: string
): string => {
  const filtered = tasks.filter((t) => t.priority === priority && !t.isTrend);
  if (filtered.length === 0) {
    return `אין תכנים בעדיפות ${priority} כרגע.`;
  }
  const taskNames = filtered.slice(0, 5).map((t) => `- ${t.taskName}`).join("\n");
  const suffix = filtered.length > 5 ? `\n...ו${filtered.length - 5} עוד` : "";
  return `תכנים בעדיפות ${priority}:\n${taskNames}${suffix}`;
};
export const formatVisibilityResponse = (tasks: ProductionTaskRow[], intent: VisibilityIntent): string => {
  if (tasks.length === 0) {
    switch (intent) {
      case "missing_edit":
       return "אין כרגע משהו שמחכה לעריכה.";
      case "missing_cover":
        return "אין כרגע תוכן שחסר לו קאבר.";
      case "missing_copy":
        return "אין כרגע תוכן שחסר לו קופי.";
      case "not_uploaded":
       return "נראה שאין כרגע משהו שעדיין לא עלה.";
      case "stuck_workflow":
       return "לא נראה שיש כרגע תוכן תקוע.";
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
      return `עוד נשאר לערוך:\n${taskNames}${suffix}`;
    case "edited_not_uploaded":
      return `כבר נערך ומחכה לעלות:\n${taskNames}${suffix}`;
    case "missing_cover":
      return `התכנים שעדיין בלי קאבר:\n${taskNames}${suffix}`;
    case "missing_copy":
      return `התכנים שעדיין בלי קופי:\n${taskNames}${suffix}`;
    case "not_uploaded":
     return `התכנים שעדיין מחכים לעלות:\n${taskNames}${suffix}`;
    case "stuck_workflow":
     return `מה שנראה שתקוע כרגע:\n${taskNames}${suffix}`;
    case "category_search":
      return `תכנים בקטגוריה:\n${taskNames}${suffix}`;
    default:
      return taskNames;
  }
};
