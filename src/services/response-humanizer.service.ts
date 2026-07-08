import { askClaude } from "./claude.service";
import { formatHistoryForPrompt } from "./conversation-memory.service";

// Phase B — Response humanization.
//
// The controller shows Karen a draft preview after every idea capture and
// after every edit. The wrapping copy around the fields (intro line, save-
// question, and "you can tell me what to change" line) used to be
// hardcoded strings that appeared verbatim on every turn — "יש פה כיוון
// טוב." / "לשמור ככה?" / "אפשר גם להגיד לי מה לשנות." — so the agent read
// as a form-filler with polite skin.
//
// humanizeDraftPreview asks Claude to generate those three short lines in
// Karen's persona, aware of the current draft AND recent conversation
// history. Fields inside the preview (name / category / tone / …) remain
// deterministic — Claude only writes the wrapping copy.
//
// Any failure (parse mismatch, timeout, invalid response) falls back to
// the hardcoded defaults below, so this can never break the flow. The
// controller sends the preview even if the humanizer is offline.

export interface HumanizedPreviewCopy {
  intro: string;
  closingQuestion: string;
  changeLine: string;
}

export const DEFAULT_NEW_DRAFT_COPY: HumanizedPreviewCopy = {
  intro: "יש פה כיוון טוב.",
  closingQuestion: "לשמור ככה?",
  changeLine: "אפשר גם להגיד לי מה לשנות.",
};

export const DEFAULT_EDIT_COPY: HumanizedPreviewCopy = {
  intro: "קיבלתי, עדכנתי את הרעיון.",
  closingQuestion: "לשמור ככה?",
  changeLine: "אפשר גם להגיד לי מה עוד לשנות.",
};

interface DraftForHumanizer {
  shortName: string;
  category: string;
  tone: string;
  contentType?: string;
  priority: string;
  summary: string;
}

export type HumanizerMode = "new" | "edit";

const buildPrompt = (
  draft: DraftForHumanizer,
  mode: HumanizerMode,
  historyContext: string,
  editRequestText?: string
): string => {
  const modeInstructions =
    mode === "new"
      ? `זה רעיון חדש שקרן שלחה עכשיו. תני משפט פתיחה חם וקצר שיקבל את הכיוון בלי לחזור על השם או הסיכום. כמה דוגמאות לגיוון: "אוקיי, זה נשמע כיוון טוב", "אני אוהבת את הזווית", "מרגיש לי כיוון נכון", "נשמע לי", "יש פה משהו".`
      : `זו טיוטה שכבר קיימת ועברה עריכה עכשיו${
          editRequestText ? ` (קרן ביקשה: "${editRequestText}")` : ""
        }. תני משפט פתיחה שמאשר את השינוי, למשל "עברתי לטון קליל יותר", "עדכנתי את הכיוון", "שיניתי לפוסט כמו שביקשת", "החלפתי, בואי נראה".`;

  return `${historyContext}את עוזרת התוכן של קרן. אני צריכה ממך שלוש שורות טקסט קצרות שיעטפו את הצגת הטיוטה למטה. השדות עצמם יוצגו על ידי הקוד — את כותבת רק את הטקסט המקיף אותם.

הטיוטה שתוצג:
שם: ${draft.shortName}
קטגוריה: ${draft.category}
טון: ${draft.tone}
סוג תוכן: ${draft.contentType || "ריל"}
עדיפות: ${draft.priority}
הכיוון בקצרה: ${draft.summary}

${modeInstructions}

החזירי בדיוק במבנה הזה, בלי הסבר, בלי הקדמה, בלי סימני פיסוק מיותרים:
Intro: [משפט פתיחה קצר, 3-8 מילים]
ClosingQuestion: [שאלת אישור קצרה, 2-4 מילים, למשל "לשמור?" / "להתקדם עם זה?" / "לקבע?" / "לשים בבנק?"]
ChangeLine: [הזמנה קצרה לשינויים נוספים, 4-8 מילים, למשל "אפשר להגיד לי מה לשנות" / "או תגידי מה לגלגל" / "פתוחה לשינויים"]

כללים:
- כל שורה קצרה בעברית טבעית וחמה של קרן. לא CRM. לא שיווקי. בלי אימוג'י.
- אל תחזרי על אותה שורה כל פעם — תני גיוון בין הודעות.
- אל תזכירי את שם המשתמשת קרן בתוך הטקסט.`;
};

export const humanizeDraftPreview = async (
  draft: DraftForHumanizer,
  sender?: string,
  mode: HumanizerMode = "new",
  editRequestText?: string
): Promise<HumanizedPreviewCopy> => {
  const historyContext = sender ? formatHistoryForPrompt(sender) : "";
  const prompt = buildPrompt(draft, mode, historyContext, editRequestText);

  const defaultCopy = mode === "edit" ? DEFAULT_EDIT_COPY : DEFAULT_NEW_DRAFT_COPY;

  try {
    const response = await askClaude(prompt);

    const introMatch = response.match(/Intro[:\s]*([^\n]+)/i);
    const closingMatch = response.match(/ClosingQuestion[:\s]*([^\n]+)/i);
    const changeMatch = response.match(/ChangeLine[:\s]*([^\n]+)/i);

    if (!introMatch || !closingMatch || !changeMatch) {
      return defaultCopy;
    }

    const intro = introMatch[1].trim();
    const closingQuestion = closingMatch[1].trim();
    const changeLine = changeMatch[1].trim();

    // Sanity checks: reject empty or absurdly long output.
    if (
      !intro || !closingQuestion || !changeLine ||
      intro.length > 120 || closingQuestion.length > 60 || changeLine.length > 120
    ) {
      return defaultCopy;
    }

    return { intro, closingQuestion, changeLine };
  } catch (error) {
    console.error(`[humanizeDraftPreview] Error: ${error}. Using default copy.`);
    return defaultCopy;
  }
};
