import type { ProductionTaskRow } from "./sheets.service";

// Sprint 10: Visibility Intent Detection
// Deterministic routing for natural Hebrew visibility queries

export type VisibilityIntent =
  | "missing_edit"
  | "missing_cover"
  | "missing_copy"
  | "not_uploaded"
  | "category_search"
  | "stuck_workflow"
  | null;

export const detectVisibilityIntent = (text: string): VisibilityIntent => {
  // Use raw text for intent detection to avoid filler word removal
  // that's designed for production task name matching
  const rawText = text.toLowerCase();

  // Missing Edit Intent
  // Examples: מה נשאר לערוך, מה עוד לא נערך, מה מחכה לעריכה, איזה סרטונים עדיין לא ערוכים
  // These are QUESTIONS about editing status, not draft creation with the word "edit" in it
  if (
    (rawText.includes("ערוך") || rawText.includes("עריכה") || rawText.includes("ערוכ")) &&
    (rawText.includes("?") || rawText.includes("מה") || rawText.includes("איזה") || rawText.includes("מחכה"))
  ) {
    return "missing_edit";
  }

  // Missing Cover Intent
  // Examples: איזה תכנים בלי קאבר, מה עדיין בלי קאבר, מה חסר לו קאבר, מה עוד צריך קאבר
  if (rawText.includes("קאבר") && (rawText.includes("?") || rawText.includes("בלי") || rawText.includes("חסר"))) {
    return "missing_cover";
  }

  // Missing Copy Intent
  // Examples: איזה תכנים בלי קופי, מה עדיין בלי קופי, מה עוד צריך קופי
  if (rawText.includes("קופי") && (rawText.includes("?") || rawText.includes("בלי") || rawText.includes("חסר"))) {
    return "missing_copy";
  }

  // Upload Status Intent
  // Examples: מה עדיין לא עלה, איזה תכנים לא הועלו, מה מחכה להעלאה, מה עוד לא באוויר
  if (
    (rawText.includes("עלה") || rawText.includes("הועל") || rawText.includes("העלאה") || rawText.includes("באוויר")) &&
    (rawText.includes("?") || rawText.includes("מה") || rawText.includes("איזה"))
  ) {
    return "not_uploaded";
  }

  // Stuck Workflow Intent
  // Examples: איזה תכנים תקועים, מה תקוע בהפקה, איפה נתקענו, מה עוד מחכה, מה לא מתקדם
  if (
    (rawText.includes("תקוע") || rawText.includes("מתקדם")) &&
    (rawText.includes("?") || rawText.includes("מה") || rawText.includes("איזה") || rawText.includes("איפה"))
  ) {
    return "stuck_workflow";
  }

  // Category/Topic Search Intent
  // Examples: מה הסטטוס של קפריסין, מה קורה עם הזוגיות, תראה לי תכני חתונה, מה יש על ספקים
  // Only trigger if it's clearly a query (has question mark or query words)
  if (
    (rawText.includes("סטטוס") || rawText.includes("קורה") || rawText.includes("תראה") || rawText.includes("יש")) &&
    (rawText.includes("?") || rawText.includes("של") || rawText.includes("עם") || rawText.includes("תראה"))
  ) {
    return "category_search";
  }

  return null;
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
