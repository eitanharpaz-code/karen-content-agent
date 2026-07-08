import type { ProductionTaskRow, ProductionTaskRowExtended } from "./sheets.service";
import type { ContentPriorityItem } from "./priority.service";
import type { PlanningHealthSignal } from "./planning-health.service";
import { isThisWeek, normalizeUserDateInput } from "../utils/date-utils";
import { askClaude } from "./claude.service";

// Sprint 10: Visibility Intent Detection
// Deterministic routing for natural Hebrew visibility queries

export type VisibilityIntent =
  | "missing_edit"
  | "edited_not_uploaded"
  | "task_status"
  | "missing_cover"
  | "not_uploaded"
  | "category_search"
  | "stuck_workflow"
  | "priority_filter"
  | "whats_important"
  | "missing_filmed"
  | "content_summary"
  | "category_stage_filter"
  | "gantt_query"
  | "gantt_write"
  | "gantt_holes"
  | "monthly_planning"
  | "ideas_list"
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
    { regex: /^(?:מה הסטטוס של|מה הסטאטוס של)\s+(.+)/is, multiWordOnly: true },
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

  // משימות הפקה schema:
  // A content_id, B שם התוכן, C צולם, D נערך, E קאבר מוכן, F דדליין, G הערות
  const filmed = task.row[2] || "לא";
  const edited = task.row[3] || "לא";
  const coverReady = task.row[4] || "לא";
  const deadline = task.row[5] || "";

  const isReadyToUpload = filmed === "כן" && edited === "כן";

  const coverLine =
    coverReady === "כן"
      ? "קאבר / Thumbnail: כן"
      : isReadyToUpload
        ? "קאבר / Thumbnail: לא סומן, לא חוסם העלאה"
        : "קאבר / Thumbnail: לא סומן";

  const lines = [
    `${displayName}:`,
    `צולם: ${filmed}`,
    `נערך: ${edited}`,
    coverLine,
  ];

  if (deadline) {
    lines.push(`דדליין הפקה: ${deadline}`);
  }

  if (isReadyToUpload) {
    lines.push("");
    lines.push("מבחינת צילום ועריכה - מוכן לעלייה.");
    lines.push("את ה-thumbnail אפשר לסגור ממש לפני ההעלאה.");
  }

  return lines.join("\n");
};

export const detectVisibilityIntent = (text: string): VisibilityIntent => {
  // Use raw text for intent detection to avoid filler word removal
  const rawText = text.toLowerCase();

  const isNewIdeaText =
    rawText.includes("יש לי רעיון") ||
    rawText.includes("רעיון חדש") ||
    rawText.includes("תוסיפי רעיון") ||
    rawText.includes("שמרי רעיון") ||
    rawText.includes("תכתבי רעיון");

  const ideaListPhrases = [
    "איזה רעיונות יש לי",
    "מה הרעיונות שיש לי",
    "מה יש לי ברעיונות",
    "מה יש בבנק רעיונות",
    "מה יש לי בבנק",
    "תראי לי רעיונות",
    "תראה לי רעיונות",
    "תציגי לי רעיונות",
    "תציג לי רעיונות",
    "רשימת רעיונות",
    "רעיונות לתוכן שיש לי",
    "איזה רעיונות לתוכן יש לי",
  ];

  const looksLikeIdeaListQuestion =
    ideaListPhrases.some((p) => rawText.includes(p)) ||
    (/^(איזה|מה|תראי|תראה|תציגי|תציג|הראי|הראה|רשימת).{0,25}רעיונות/.test(rawText));

  if (!isNewIdeaText && looksLikeIdeaListQuestion) {
    return "ideas_list";
  }

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
    "מה מוכן לעלייה",
    "מה מוכן לעליה",
    "מה מוכן לעלות",
    "מה כבר מוכן",
    "מה מוכן ולא עלה",
    "מה מוכן ועוד לא פורסם",
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
// --- Content Summary Intent ---
  const summaryPhrases = [
    "סיכום של", "סיכום על", "תני לי סיכום על", "תני לי סיכום של",
    "תזכיר לי על", "תזכיר לי את הסרטון", "תזכיר לי את הרעיון על",
    "תזכירי לי על", "תזכירי לי את",
    "תקציר של", "תקציר על", "שלח לי תקציר על", "שלחי לי תקציר על","מה התקציר של",
    "מה התקציר על",
    "תני לי את התקציר של",
    "תני לי את התקציר על",
    "על מה הסרטון", "על מה הרעיון", "מה הסרטון על",
    "תספרי לי על", "תספר לי על", "פרטים על", "מה יש לי על",
  ];
  if (summaryPhrases.some((p) => rawText.includes(p))) {
    return "content_summary";
  }

// --- Gantt Query ---
  const ganttPhrases = [
    "מה בגאנט", "מה יש בגאנט", "מה בתכנון השבוע", "מה מתוכנן השבוע",
    "מה מתוכנן לי השבוע", "מה עולה השבוע", "מה אמור לעלות השבוע",
    "מה יש השבוע", "מה יש לי השבוע",
    "מה בגאנט השבוע", "תראי לי את הגאנט", "תראה לי את הגאנט", "מה הגאנט",
    "מה מתוכנן החודש", "מה בגאנט החודש",
  ];
  const ganttQuestionPatterns = [
    /^(?:מה|איזה|אילו).{0,20}(?:יש לי|מתוכנן לי|מתוכנן|בתכנון|עולה).{0,15}(?:השבוע|החודש)/,
  ];
  if (
    !isNewIdeaText &&
    (ganttPhrases.some((p) => rawText.includes(p)) ||
      ganttQuestionPatterns.some((pattern) => pattern.test(rawText.trim())))
  ) {
    return "gantt_query";
  }

  // --- Gantt Write Intent ---
  const ganttWritePhrases = [
    "תוסיפי את", "תוסיפי ל", "תשבצי את", "תשבצי ל",
    "תכניסי את", "תכניסי ל", "לגאנט", "לתאריך",
  ];
  const hasGanttWritePhrase = ganttWritePhrases.some((p) => rawText.includes(p));
  const hasDatePattern = /\d{1,2}[./-]\d{1,2}/.test(rawText);
  const isGanttWrite = hasGanttWritePhrase && rawText.includes("גאנט") && (rawText.includes("לגאנט") || hasDatePattern);
  if (isGanttWrite) {
    return "gantt_write";
  }
  // --- Gantt Holes Intent ---
  const ganttHolesPhrases = [
    "מה החורים בגאנט", "אילו ימים פנויים", "מה פנוי בגאנט",
    "אילו תאריכים פנויים", "מה הפנויים בגאנט", "חורים בגאנט",
    "ימים פנויים בגאנט", "תאריכים פנויים בגאנט",
  ];
  if (ganttHolesPhrases.some((p) => rawText.includes(p))) {
    return "gantt_holes";
  }
  // --- Monthly Planning Intent ---
  const monthlyPlanningPatterns = [
    /בואי נתכנן את (ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/,
    /בוא נתכנן את (ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/,
    /נתכנן את (ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/,
    /תכנון (ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/,
  ];
  if (monthlyPlanningPatterns.some((p) => p.test(rawText))) {
    return "monthly_planning";
  }

  // --- Category + Stage Filter - חייב להיות לפני missing_filmed ---
 const categoryStagePatterns = [
    /מה לא .{2,10} ב.{2,15}/,
    /מה עוד לא .{2,10} ב.{2,15}/,
    /מה טרם .{2,10} ב.{2,15}/,
    /מה נשאר .{2,10} ב.{2,15}/,
    /מה לא .{2,10} על .{2,15}/,
    /מה עוד לא .{2,10} על .{2,15}/,
  ];
  if (categoryStagePatterns.some((p) => p.test(rawText))) {
    return "category_stage_filter";
  }
  // --- Missing Filmed Intent ---
  const filmedPhrases = [
    "מה עוד לא צולם", "מה לא צולם", "מה נשאר לצלם",
    "מה עוד צריך לצלם", "מה מחכה לצילום", "מה טרם צולם",
    "עדיין לא צולם", "לא צולם עדיין", "בלי צילום", "חסר צילום",
    "צילום", "צולם",
  ];
  if (filmedPhrases.some((p) => rawText.includes(p))) {
    return "missing_filmed";
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
  const isExplicitIdea =
    raw.includes("יש לי רעיון") ||
    raw.includes("רעיון חדש") ||
    raw.includes("תוסיפי רעיון") ||
    raw.includes("שמרי רעיון") ||
    raw.includes("תכתבי רעיון");

  if (isExplicitIdea) {
    return false;
  }

  const queryIndicators = ["מה", "איזה", "נשאר", "עוד", "מחכה", "?", "?", "למה"];
  const visibilityKeywords = ["ערוך", "עריכה", "קאבר", "העלאה", "עלה", "פורסם", "תקוע", "סטטוס", "פרסם", "במק"];
  const planningKeywords = ["גאנט", "מתוכנן", "מתוכננת", "בתכנון", "השבוע", "החודש"];

  const hasQueryWord = queryIndicators.some((q) => raw.includes(q));
  const hasRelevantKeyword = [...visibilityKeywords, ...planningKeywords].some((k) => raw.includes(k));
  return hasQueryWord && hasRelevantKeyword;
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
  const multiWordPattern = /^(תראה לי|תראי לי|תציג לי|תציגי לי|תגיד לי|תגידי לי|תזכירי לי|תזכיר לי|תבדקי|תבדוק|יש משהו|יש תכנים|מה עם)\s/;
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

const shortenTaskName = (name: string, maxWords: number = 6): string => {
  const words = name.trim().split(/\s+/);
  if (words.length <= maxWords) return name;
  return words.slice(0, maxWords).join(" ") + "...";
};

const formatPriorityAction = (item: ContentPriorityItem): string => {
  switch (item.recommendedAction) {
    case "verify-upload":
      return "לוודא שהוא עולה";
    case "resolve-overdue":
      return "להחליט: עלה / לדחות ל-[תאריך] / לארכיון";
    case "film":
      return `לצלם את "${item.displayTitle}"`;
    case "edit":
      return `לערוך את "${item.displayTitle}"`;
    case "cover":
      return `לסגור קאבר ל-"${item.displayTitle}"`;
    case "schedule":
      return `לשבץ את "${item.displayTitle}" לגאנט`;
    case "none":
      return "";
  }
};

const formatPriorityStatus = (item: ContentPriorityItem): string => {
  if (item.isOverdueAwaitingDecision) return "צריך החלטה";
  if (item.priorityLevel === "P0" && item.isReadyToUpload) return "מוכן לעלייה היום";
  if (item.priorityLevel === "P0") return "עולה היום ולא מוכן";
  if (item.recommendedAction === "film") return "חסר צילום";
  if (item.recommendedAction === "edit") return "חסר עריכה";
  if (item.recommendedAction === "cover") return "חסר קאבר";
  if (item.recommendedAction === "schedule") return "צריך שיבוץ";
  return item.priorityLevel;
};

type WhatsImportantQueueItem =
  | { kind: "priority"; item: ContentPriorityItem }
  | { kind: "planning"; signal: PlanningHealthSignal };

const getWhatsImportantQueueRank = (entry: WhatsImportantQueueItem): number => {
  if (entry.kind === "planning") return 3;

  const item = entry.item;
  if (item.priorityLevel === "P0" && !item.isOverdueAwaitingDecision) return 0;
  if (item.isOverdueAwaitingDecision) return 1;
  if (item.priorityLevel === "P1" || item.priorityLevel === "P2") return 2;
  if (item.priorityLevel === "P3" || item.priorityLevel === "P4") return 4;

  return 5;
};

const formatPlanningStatus = (signal: PlanningHealthSignal): string => {
  switch (signal.type) {
    case "next_week_missing_reel":
      return "חסר ריל לשבוע הבא";
    case "next_week_missing_post":
      return "חסר פוסט לשבוע הבא";
  }
};

export const formatPriorityWhatsImportantResponse = (
  priorityItems: ContentPriorityItem[],
  planningSignals: PlanningHealthSignal[] = []
): string => {
  const actionableItems = priorityItems.filter(
    (item) => item.recommendedAction !== "none"
  );
  const criticalPlanningSignals = planningSignals.filter(
    (signal) => signal.severity === "critical"
  );
  const queueItems: WhatsImportantQueueItem[] = [
    ...actionableItems.map((item): WhatsImportantQueueItem => ({
      kind: "priority",
      item,
    })),
    ...criticalPlanningSignals.map((signal): WhatsImportantQueueItem => ({
      kind: "planning",
      signal,
    })),
  ].sort((a, b) => getWhatsImportantQueueRank(a) - getWhatsImportantQueueRank(b));

  if (queueItems.length === 0) {
    return [
      "כרגע אין משהו שנראה דחוף.",
      "אם בא לך להתקדם, הייתי בודקת מה עוד צריך שיבוץ לגאנט.",
    ].join("\n");
  }

  const lines: string[] = [
    "הכי חשוב עכשיו:",
  ];

  queueItems.slice(0, 5).forEach((entry, index) => {
    if (entry.kind === "priority") {
      lines.push(
        `${index + 1}. ${entry.item.displayTitle} - ${formatPriorityStatus(entry.item)}`
      );
      return;
    }

    lines.push(`${index + 1}. ${entry.signal.message.replace(/[.。]$/, "")}`);
  });

  if (queueItems.length > 5) {
    lines.push(`ועוד ${queueItems.length - 5} דברים שלא הצגתי כדי לא להעמיס.`);
  }

  const focusEntry = queueItems[0];
  const focus = focusEntry.kind === "priority" ? focusEntry.item : null;
  const visibleOverdue = queueItems
    .slice(0, 5)
    .find(
      (entry) =>
        entry.kind === "priority" && entry.item.isOverdueAwaitingDecision
    );
  const visiblePlanning = queueItems
    .slice(0, 5)
    .find((entry) => entry.kind === "planning");
  const focusAction = focus ? formatPriorityAction(focus) : "";

  if (visibleOverdue && !focus?.isOverdueAwaitingDecision) {
    lines.push("");
    lines.push("כדי לסגור את האיחור, אפשר לענות:");
    lines.push("* עלה");
    lines.push("* לדחות ל-[תאריך]");
    lines.push("* לארכיון");
  }

  if (focus?.isOverdueAwaitingDecision) {
    lines.push("");
    lines.push("הדבר הראשון שהייתי סוגרת:");
    lines.push(focus.reason);
    lines.push("");
    lines.push("אפשר לענות:");
    lines.push("* עלה");
    lines.push("* לדחות ל-[תאריך]");
    lines.push("* לארכיון");
    return lines.join("\n");
  }

  if (focusAction) {
    lines.push("");
    lines.push("הדבר הראשון שהייתי עושה:");
    lines.push(focusAction);
  } else if (visiblePlanning?.kind === "planning") {
    const planningIsFocus = focusEntry.kind === "planning";

    lines.push("");
    lines.push(
      planningIsFocus
        ? "הדבר הראשון שהייתי מסדרת:"
        : "אחר כך כדאי לסגור:"
    );
    lines.push(visiblePlanning.signal.message);
    lines.push("");
    lines.push("אפשר לענות:");
    lines.push(`* ${visiblePlanning.signal.recommendedAction}`);
  }

  if (focus?.cta) {
    lines.push("");
    lines.push("אפשר לענות:");
    lines.push(`* ${focus.cta}`);
  }

  if (focus && visiblePlanning?.kind === "planning") {
    lines.push("");
    lines.push("אחר כך אפשר גם:");
    lines.push(`* ${visiblePlanning.signal.recommendedAction}`);
  }

  return lines.join("\n");
};

export const formatWhatsImportantResponse = (
  highPriorityNotUploaded: ProductionTaskRowExtended[],
  stuckTasks: ProductionTaskRowExtended[],
  trendTasks: ProductionTaskRowExtended[],
  thisWeekTasks: ProductionTaskRowExtended[],
  notFilmedThisWeek: { taskName: string; deadlineDayName: string }[] = [],
  productionWithoutGantt: ProductionTaskRowExtended[] = []
): string => {
  const lines: string[] = [];

  const upcomingItems = thisWeekTasks.slice(0, 5);

  if (
    upcomingItems.length === 0 &&
    stuckTasks.length === 0 &&
    notFilmedThisWeek.length === 0 &&
    productionWithoutGantt.length === 0 &&
    highPriorityNotUploaded.length === 0 &&
    trendTasks.length === 0
  ) {
    return "כרגע אין משהו שנראה דחוף. זה דווקא מצב טוב.\nאם בא לך להתקדם, הייתי בודקת מה עוד לא צולם.";
  }

  if (upcomingItems.length > 0) {
    const intro =
      thisWeekTasks.length === 1
        ? "בימים הקרובים יש דבר אחד בגאנט."
        : `בימים הקרובים יש ${thisWeekTasks.length} דברים בגאנט.`;

    lines.push(intro);
    lines.push("");
    lines.push("מה עולה בקרוב:");

    upcomingItems.forEach((t) => {
      const shortName = shortenTaskName(t.taskName);
      const day = t.deadlineDayName ? `יום ${t.deadlineDayName}` : "בימים הקרובים";
      const time = t.uploadTime ? `, ${t.uploadTime}` : "";
      lines.push(`- ${shortName} (${day}${time})`);
    });

    if (thisWeekTasks.length > 5) {
      lines.push(`ועוד ${thisWeekTasks.length - 5} דברים שלא הצגתי כאן כדי לא להעמיס.`);
    }
  }

  const productionIssues: Array<{
    contentId?: string;
    taskName: string;
    shortName: string;
    status: string;
    action: string;
  }> = [];

  const addProductionIssue = (
    task: ProductionTaskRowExtended,
    status: string,
    action: string
  ) => {
    const shortName = shortenTaskName(task.taskName);

    const alreadyExists = productionIssues.some((issue) => {
      if (task.contentId && issue.contentId) {
        return issue.contentId === task.contentId;
      }

      return issue.shortName === shortName;
    });

    if (!alreadyExists) {
      productionIssues.push({
        contentId: task.contentId,
        taskName: task.taskName,
        shortName,
        status,
        action,
      });
    }
  };

  thisWeekTasks.forEach((t) => {
    if (t.filmed !== "כן") {
      addProductionIssue(
        t,
        "עוד לא צולם",
        `לצלם את "${shortenTaskName(t.taskName)}", כי הוא יושב בימים הקרובים ועוד לא התחיל.`
      );
    } else if (t.edited !== "כן") {
      addProductionIssue(
        t,
        "צולם, מחכה לעריכה",
        `לערוך את "${shortenTaskName(t.taskName)}", כי הצילום כבר מאחורייך.`
      );
    } else if (t.coverReady !== "כן") {
      addProductionIssue(
        t,
        "חסר קאבר",
        `לסגור קאבר ל-"${shortenTaskName(t.taskName)}". זה קטן, אבל תוקע העלאה.`
      );
    }
  });

  stuckTasks.forEach((t) => {
    addProductionIssue(
      t,
      "צולם, מחכה לעריכה",
      `לערוך את "${shortenTaskName(t.taskName)}", כי הצילום כבר מאחורייך.`
    );
  });

  if (productionIssues.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("מה דורש טיפול:");

    productionIssues.slice(0, 5).forEach((issue) => {
      lines.push(`- ${issue.shortName} - ${issue.status}`);
    });

    if (productionIssues.length > 5) {
      lines.push(`ועוד ${productionIssues.length - 5} דברים שלא הצגתי כאן כדי לא להעמיס.`);
    }
  }

  if (productionWithoutGantt.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("צריך שיבוץ לגאנט:");

    productionWithoutGantt.slice(0, 3).forEach((t) => {
      lines.push(`- ${shortenTaskName(t.taskName)} - בהפקה אבל בלי תאריך עלייה`);
    });

    if (productionWithoutGantt.length > 3) {
      lines.push(`ועוד ${productionWithoutGantt.length - 3} תכנים שצריך לשבץ.`);
    }
  }

  if (highPriorityNotUploaded.length > 0) {
    const highPriorityToShow = highPriorityNotUploaded
      .filter((t) => !thisWeekTasks.some((upcoming) => upcoming.contentId === t.contentId))
      .slice(0, 3);

    if (highPriorityToShow.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("עוד דברים בעדיפות גבוהה שלא עלו:");
      highPriorityToShow.forEach((t) => lines.push(`- ${shortenTaskName(t.taskName)}`));
    }
  }

  if (trendTasks.length > 0) {
    if (lines.length > 0) lines.push("");

    const trendLine =
      trendTasks.length === 1
        ? "יש גם טרנד אחד שעדיין לא עלה:"
        : `יש גם ${trendTasks.length} טרנדים שעדיין לא עלו:`;

    lines.push(trendLine);
    trendTasks.slice(0, 3).forEach((t) => lines.push(`- ${shortenTaskName(t.taskName)}`));
  }

  if (productionIssues.length > 0) {
    lines.push("");
    lines.push("הדבר הראשון שהייתי סוגרת עכשיו:");
    lines.push(productionIssues[0].action);
  } else if (productionWithoutGantt.length > 0) {
    lines.push("");
    lines.push("הדבר הראשון שהייתי סוגרת עכשיו:");
    lines.push(`לשבץ את "${shortenTaskName(productionWithoutGantt[0].taskName)}" לגאנט, כי הוא כבר בהפקה אבל אין לו תאריך עלייה.`);
  } else if (upcomingItems.length > 0) {
    lines.push("");
    lines.push("הדבר הראשון שהייתי עושה עכשיו:");
    lines.push(`לוודא ש-"${shortenTaskName(upcomingItems[0].taskName)}" באמת מוכן לעלות.`);
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
  const taskNames = filtered.slice(0, 5).map((t) => `- ${shortenTaskName(t.taskName)}`).join("\n");
  const suffix = filtered.length > 5 ? `\n...ו${filtered.length - 5} עוד` : "";
  return `תכנים בעדיפות ${priority}:\n${taskNames}${suffix}`;
};
export const formatOpenIdeasResponse = (ideas: Array<{
  contentId: string;
  idea: string;
  summary?: string;
  category?: string;
  priority?: string;
}>): string => {
  if (ideas.length === 0) {
    return "אין כרגע רעיונות פתוחים בבנק.";
  }

  const lines = ideas.slice(0, 10).map((idea) => {
    const category = idea.category ? ` / ${idea.category}` : "";
    const priority = idea.priority ? ` / עדיפות ${idea.priority}` : "";
    const summary = idea.summary ? `\n  ${idea.summary}` : "";
    return `- ${idea.idea} (${idea.contentId}${category}${priority})${summary}`;
  });

  const suffix = ideas.length > 10 ? `\n...ו${ideas.length - 10} עוד` : "";
  return `יש לך ${ideas.length} רעיונות פתוחים:\n${lines.join("\n")}${suffix}`;
};

export const formatVisibilityResponse = (tasks: ProductionTaskRow[], intent: VisibilityIntent): string => {
  const getVisibilityCopy = (currentIntent: VisibilityIntent) => {
    switch (currentIntent) {
      case "missing_edit":
        return {
          empty: "אין כרגע משהו שמחכה לעריכה.",
          titleSingular: "יש תוכן אחד שמחכה לעריכה.",
          titlePlural: (count: number) => `יש ${count} תכנים שמחכים לעריכה.`,
          listTitle: "הראשונים לטיפול:",
          nextAction: (name: string) => `הייתי מתחילה מלערוך את "${name}".`,
        };

      case "edited_not_uploaded":
        return {
          empty: "אין כרגע משהו שערוך ומחכה לעלות.",
          titleSingular: "יש תוכן אחד שכבר ערוך ומחכה לעלות.",
          titlePlural: (count: number) => `יש ${count} תכנים שכבר ערוכים ומחכים לעלות.`,
          listTitle: "מה מוכן לעלייה:",
          nextAction: (name: string) => `הייתי בודקת אם "${name}" מוכן גם בקאבר, ואז לשבץ להעלאה.`,
        };

      case "missing_cover":
        return {
          empty: "אין כרגע תוכן שחסר לו קאבר.",
          titleSingular: "יש תוכן אחד שחסר לו קאבר.",
          titlePlural: (count: number) => `יש ${count} תכנים שחסר להם קאבר.`,
          listTitle: "מה צריך קאבר:",
          nextAction: (name: string) => `הייתי סוגרת קודם קאבר ל-"${name}". זה קטן, אבל יכול לתקוע העלאה.`,
        };

      case "not_uploaded":
        return {
          empty: "נראה שאין כרגע משהו שמחכה לעלות.",
          titleSingular: "יש תוכן אחד שעדיין לא עלה.",
          titlePlural: (count: number) => `יש ${count} תכנים שעדיין לא עלו.`,
          listTitle: "מה מחכה לעלות:",
          nextAction: (name: string) => `הייתי בודקת קודם את "${name}" ואם הוא מוכן, משבצת אותו בגאנט.`,
        };

      case "stuck_workflow":
        return {
          empty: "לא נראה שיש כרגע תוכן תקוע.",
          titleSingular: "יש תוכן אחד שנראה תקוע.",
          titlePlural: (count: number) => `יש ${count} תכנים שנראים תקועים.`,
          listTitle: "מה תקוע:",
          nextAction: (name: string) => `הייתי פותחת קודם את "${name}" ובודקת מה חסר כדי לשחרר אותו.`,
        };

      case "missing_filmed":
        return {
          empty: "אין כרגע תוכן שעוד לא צולם.",
          titleSingular: "יש תוכן אחד שעוד לא צולם.",
          titlePlural: (count: number) => `יש ${count} תכנים שעוד לא צולמו.`,
          listTitle: "מה צריך צילום:",
          nextAction: (name: string) => `הייתי מתחילה מלצלם את "${name}".`,
        };

      case "category_search":
        return {
          empty: "לא מצאתי תוכן בקטגוריה הזו.",
          titleSingular: "מצאתי תוכן אחד בקטגוריה הזו.",
          titlePlural: (count: number) => `מצאתי ${count} תכנים בקטגוריה הזו.`,
          listTitle: "מה מצאתי:",
          nextAction: (name: string) => `הייתי בודקת קודם את "${name}".`,
        };

      default:
        return {
          empty: "לא מצאתי תוכן רלוונטי.",
          titleSingular: "מצאתי תוכן אחד.",
          titlePlural: (count: number) => `מצאתי ${count} תכנים.`,
          listTitle: "מה מצאתי:",
          nextAction: (name: string) => `הייתי מתחילה מ-"${name}".`,
        };
    }
  };

  const copy = getVisibilityCopy(intent);

  if (tasks.length === 0) {
    return copy.empty;
  }

  const displayTasks = tasks.slice(0, 5);
  const firstTaskName = shortenTaskName(displayTasks[0].taskName);

  const title =
    tasks.length === 1
      ? copy.titleSingular
      : copy.titlePlural(tasks.length);

  const taskNames = displayTasks
    .map((task) => `- ${shortenTaskName(task.taskName)}`)
    .join("\n");

  const suffix =
    tasks.length > 5
      ? `\nועוד ${tasks.length - 5} דברים שלא הצגתי כאן כדי לא להעמיס.`
      : "";

  const lines = [
    title,
    "",
    copy.listTitle,
    taskNames + suffix,
  ];

    if (tasks.length > 5) {
    lines.push("");
    lines.push("זו רשימה רחבה, אז לא הייתי בוחרת ממנה אוטומטית מה ראשון.");
    lines.push("כדי לתעדף לפי גאנט וקרבה להעלאה, תשאלי: מה דחוף.");
  } else {
    lines.push("");
    lines.push(copy.nextAction(firstTaskName));
  }

  return lines.join("\n");
};
// Extract category and stage from a category_stage_filter query
// e.g. "מה לא צולם בקפריסין" → { category: "קפריסין", stage: "filmed" }
export const extractCategoryAndStage = (text: string, categoryNames: string[]): { category: string; stage: string } | null => {
  const raw = text.trim();

  const stageMap: Array<{ keywords: string[]; stage: string }> = [
    { keywords: ["צולם", "צילום", "לצלם"], stage: "filmed" },
    { keywords: ["נערך", "עריכה", "לערוך", "ערוך"], stage: "edited" },
    { keywords: ["קאבר"], stage: "cover" },
    { keywords: ["עלה", "הועלה", "לעלות", "פורסם"], stage: "uploaded" },
  ];

 let detectedStage: string | null = null;
  let detectedCategory: string | null = null;
  const normalized = raw.toLowerCase();
  for (const { keywords, stage } of stageMap) {
    if (keywords.some((k) => normalized.includes(k))) {
      detectedStage = stage;
      break;
    }
  }
  for (const name of categoryNames) {
    if (new RegExp(`(^|\\s|ב|ל|מ|ש)${name.toLowerCase()}(\\s|$)`).test(normalized)) {
      detectedCategory = name;
      break;
    }
  }
  if (!detectedStage || !detectedCategory) return null;
  return { category: detectedCategory, stage: detectedStage };
};
// Format response for category_stage_filter
export const formatCategoryStageResponse = (
  tasks: ProductionTaskRow[],
  category: string,
  stage: string
): string => {
  const stageLabels: Record<string, string> = {
    filmed: "צולמו",
    edited: "נערכו",
    cover: "יש להם קאבר",
    uploaded: "עלו",
  };

  const stageLabel = stageLabels[stage] || stage;

  if (tasks.length === 0) {
    return `אין תכנים בקטגוריית ${category} שעדיין לא ${stageLabel}.`;
  }

  const taskNames = tasks
    .slice(0, 5)
    .map((t) => `- ${t.taskName.trim().split(/\s+/).slice(0, 6).join(" ")}`)
    .join("\n");

  const suffix = tasks.length > 5 ? `\n...ו${tasks.length - 5} עוד` : "";

  return `תכנים בקטגוריית ${category} שעדיין לא ${stageLabel}:\n${taskNames}${suffix}`;
};
export const formatGanttResponse = (items: any[], period: string): string => {
  const isNotUploadedView = period.includes("לא פורסמו") || period.includes("לא עלו");

  if (items.length === 0) {
    return isNotUploadedView
      ? "אין כרגע תכנים בגאנט שמחכים לעלות."
      : `לא מצאתי תכנים מתוכננים ל${period}.`;
  }

  const displayItems = items.slice(0, 5);

  const title = isNotUploadedView
    ? `יש ${items.length} תכנים בגאנט שעדיין לא עלו.`
    : `יש ${items.length} תכנים מתוכננים ב-${period}.`;

  const listTitle = isNotUploadedView
    ? "מה מחכה לעלות:"
    : "מה מתוכנן:";

  const lines: string[] = [title, "", listTitle];

  displayItems.forEach((item) => {
    const name = shortenTaskName(item.name || item.contentId || "ללא שם");
    const day = item.day ? `יום ${item.day}` : "";
    const date = item.date || "";
    const time = item.uploadTime ? `, ${item.uploadTime}` : "";
    const status = item.status ? ` - ${item.status}` : "";

    const datePart = [date, day].filter(Boolean).join(" ");
    lines.push(`- ${name} (${datePart}${time})${status}`);

    if (item.status === "בתכנון") {
      lines.push("  עדיין לא מוכן.");
    }
  });

  if (items.length > 5) {
    lines.push(`ועוד ${items.length - 5} דברים שלא הצגתי כאן כדי לא להעמיס.`);
  }

  if (isNotUploadedView) {
    lines.push("");
    lines.push("כדי להבין מה באמת דחוף מתוך זה, תשאלי: מה דחוף.");
  }

  return lines.join("\n");
};
// Extract content name and date from gantt write command
// e.g. "תוסיפי את זוגיות בתקופת חתונה לגאנט ב-15/06" → { contentName: "זוגיות בתקופת חתונה", date: "15/06" }
export const extractGanttWriteParams = (text: string): { contentName: string; date: string } | null => {
  const raw = text.trim();

  // Accept dd/mm, dd.mm, dd-mm and optional year.
  const dateMatch = raw.match(/(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/);
  if (!dateMatch) return null;

  const normalizedDate = normalizeUserDateInput(dateMatch[1]);
  if (!normalizedDate) return null;

  // Extract content name - text between "את" and date/location markers
 const namePatterns = [
    /(?:תוסיפי|תשבצי|תכניסי|תוסיף|תשבץ|תכניס)\s+את\s+(.+?)\s+לגאנט/i,
    /(?:תוסיפי|תשבצי|תכניסי|תוסיף|תשבץ|תכניס)\s+את\s+(.+?)\s+בתאריך/i,
    /(?:תוסיפי|תשבצי|תכניסי|תוסיף|תשבץ|תכניס)\s+את\s+(.+?)\s+ב-\d/i,
    /(?:תוסיפי|תשבצי|תכניסי|תוסיף|תשבץ|תכניס)\s+את\s+(.+?)\s+ל-?\d/i,
    /(?:תוסיפי|תשבצי|תכניסי|תוסיף|תשבץ|תכניס)\s+את\s+(.+?)\s+\d/i,
  ];

  for (const pattern of namePatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return { contentName: match[1].trim(), date: normalizedDate };
    }
  }

  console.log(`[GanttWrite] No pattern matched for: "${raw}"`);
  return null;
};
// Format available dates (holes) in gantt for current month
export const formatGanttHolesResponse = (availableDates: string[]): string => {
  if (availableDates.length === 0) {
    return "אין כרגע חורים פנויים החודש בגאנט. החודש מלא.";
  }

  const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

  const displayDates = availableDates.slice(0, 5);

  const lines = displayDates.map((date) => {
    const parts = date.split("/");
    const dayName = dayNames[
      new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getDay()
    ];

    return `- ${date}, יום ${dayName}`;
  });

  const suffix =
    availableDates.length > 5
      ? `\nועוד ${availableDates.length - 5} חורים שלא הצגתי כאן כדי לא להעמיס.`
      : "";

  return [
    "מצאתי כמה חורים פנויים החודש בגאנט.",
    "",
    "הקרובים ביותר:",
    lines.join("\n") + suffix,
    "",
    "רוצה שאשבץ תוכן לאחד הימים האלה?",
    "אפשר לכתוב למשל:",
    "תוסיפי את [שם התוכן] לגאנט ב-17/06/2026",
  ].join("\n");
};

// ---------------------------------------------------------------------------
// AI fallback for visibility intent routing.
//
// The hardcoded detectVisibilityIntent above matches roughly 100 exact
// Hebrew phrases across 17 intents. Any paraphrase not in those lists
// returns null today, even when the intent is clear to a human.
//
// This AI fallback runs only when hardcoded detection fails AND the message
// already looks question-like (cheap sync gate via isLikelyVisibilityQuery
// or isQuestionLikeMessage). Cost is bounded: no AI call for routine
// non-question traffic.
//
// v1 scope: only route to intents that don't need argument extraction. If
// the user is asking about a specific content name, category, priority
// level, month, or scheduling action, Claude is instructed to return NONE
// so those queries stay on the hardcoded (exact-phrase) path where the
// argument extractors live. Getting the target name wrong is worse than
// returning "I don't understand".
const AI_ROUTABLE_INTENTS = [
  "missing_edit",
  "edited_not_uploaded",
  "missing_cover",
  "not_uploaded",
  "stuck_workflow",
  "whats_important",
  "missing_filmed",
  "gantt_query",
  "gantt_holes",
  "ideas_list",
] as const;

type AiRoutableIntent = typeof AI_ROUTABLE_INTENTS[number];

const isAiRoutableIntent = (value: string): value is AiRoutableIntent =>
  (AI_ROUTABLE_INTENTS as readonly string[]).includes(value);

export const askClaudeForVisibilityIntent = async (
  userMessage: string
): Promise<VisibilityIntent> => {
  const prompt = `קרן שולחת שאלה על הצינור התוכן שלה בוואטסאפ. המטרה שלך היא לזהות איזה סוג שאלה זו, מתוך רשימה סגורה, כדי שהקוד יוכל לענות אוטומטית מהגיליון שלה.

הודעת קרן:
"${userMessage}"

הסוגים האפשריים (מיפוי מזהה → משמעות):
- missing_edit — מה עוד לא נערך / נשאר לערוך / מחכה לעריכה
- edited_not_uploaded — מה כבר ערוך אבל עוד לא עלה / מוכן להעלאה
- not_uploaded — מה עוד לא עלה / לא פורסם / מחכה להעלאה (כללי)
- missing_cover — מה בלי קאבר / חסר לו קאבר
- missing_filmed — מה עוד לא צולם / נשאר לצלם / מחכה לצילום
- stuck_workflow — מה תקוע / לא מתקדם / נעצר
- whats_important — מה הכי חשוב / דחוף עכשיו / מה הצעד הבא
- gantt_query — מה מתוכנן השבוע / החודש / מה בגאנט / מה עולה
- gantt_holes — אילו תאריכים / ימים פנויים בגאנט
- ideas_list — תראי לי את הרעיונות / מה יש בבנק הרעיונות
- NONE — אף אחד מהם, או שקרן שואלת על תוכן ספציפי בשם / קטגוריה / עדיפות / חודש / תאריך (במקרה כזה תמיד תחזירי NONE)

כללים חשובים:
- החזירי בדיוק מזהה אחד מהרשימה, בלי הסבר, בלי הקדמה, בלי סימני פיסוק.
- אם קרן מזכירה שם ספציפי של תוכן — החזירי NONE.
- אם קרן מזכירה שם קטגוריה (למשל: קפריסין, שמלות, חתונה, רווקות, טרנד) — החזירי NONE.
- אם קרן מזכירה רמת עדיפות ("גבוה", "נמוך", "בינוני") — החזירי NONE.
- אם קרן מזכירה חודש בשם (ינואר, פברואר, מרץ, אפריל, מאי, יוני, יולי, אוגוסט, ספטמבר, אוקטובר, נובמבר, דצמבר) — החזירי NONE ללא יוצא מן הכלל, גם אם השאלה נשמעת כמו שאלת גאנט.
- אם קרן מזכירה תאריך מספרי (למשל 15/7 או 3.8) — החזירי NONE.
- אם השאלה כללית מדי או שלא בטוחה — החזירי NONE.
- אם קרן מתארת רעיון חדש ולא שואלת על הצינור — החזירי NONE.

החזירי רק את המזהה.`;

  try {
    const response = await askClaude(prompt);
    const cleaned = response
      .trim()
      .replace(/[.,;:!?"׳״'`]/g, "")
      .split(/\s+/)[0]
      .toLowerCase();

    if (cleaned === "none" || cleaned === "") return null;
    if (isAiRoutableIntent(cleaned)) return cleaned;
    return null;
  } catch (error) {
    console.error(`[askClaudeForVisibilityIntent] Error: ${error}. Returning null.`);
    return null;
  }
};

// Wrapper: try hardcoded intent detection first (fast, free). If that returns
// null AND the message already looks like a question about the pipeline
// (cheap sync heuristic), only then ask Claude. This bounds the AI cost to
// question-shaped fallback traffic.
export const detectVisibilityIntentWithAI = async (
  text: string
): Promise<VisibilityIntent> => {
  const syncIntent = detectVisibilityIntent(text);
  if (syncIntent) return syncIntent;

  if (!isLikelyVisibilityQuery(text) && !isQuestionLikeMessage(text)) {
    return null;
  }

  return await askClaudeForVisibilityIntent(text);
};