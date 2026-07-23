/**
 * status-intent.service.ts
 *
 * Karen writes status updates in many shapes. The regex detector in
 * production-status.service handles the common first-person forms
 * ("צילמתי את X"), but she also writes passively and name-first:
 *   "ספרייט צולם"
 *   "סקויה עלה"
 *   "אנשים שמתקשרים במקום לכתוב צולם ונערך"
 *
 * Matching those with regex proved brittle: every added guard opened another
 * hole, and the same words appear in questions ("מה עוד לא נערך").
 * So for these ambiguous cases we ask Claude one bounded question:
 * is this a status update, and if so, for which content and which steps.
 *
 * This runs ONLY as a fallback, after the regex detector returns null, so the
 * fast path is unchanged and no extra call is made for normal phrasing.
 */

import { askClaude, CLASSIFIER_MODEL } from "./claude.service";

export type ClaudeStatusResult = {
  isStatusUpdate: boolean;
  contentName: string;
  statuses: Array<"filmed" | "edited" | "cover" | "uploaded">;
};

// Cheap pre-filter: only bother Claude when a status-ish word is present.
const STATUS_HINTS = [
  "צולם", "צולמו", "צילום",
  "נערך", "נערכו", "עריכה", "ערוך",
  "עלה", "עלתה", "הועלה", "פורסם", "באוויר",
  "קאבר", "מוכן",
];

export const looksLikeStatusMention = (message: string): boolean => {
  const text = (message || "").trim();
  if (!text) return false;
  return STATUS_HINTS.some((h) => text.includes(h));
};

export const askClaudeForStatusIntent = async (
  message: string,
  knownContentNames: string[]
): Promise<ClaudeStatusResult | null> => {
  if (!looksLikeStatusMention(message)) return null;

  const nameList = knownContentNames.length
    ? knownContentNames.map((n) => `- ${n}`).join("\n")
    : "(אין תכנים פתוחים)";

  const prompt = [
    "את/ה מסווג/ת הודעות של יוצרת תוכן למערכת ניהול תוכן.",
    "",
    "ההודעה:",
    `"${message}"`,
    "",
    "תכנים שנמצאים כרגע בהפקה:",
    nameList,
    "",
    "השאלה: האם ההודעה מדווחת על התקדמות בתוכן קיים (צולם / נערך / קאבר מוכן / עלה),",
    "או שהיא שאלה, בקשה, או רעיון חדש?",
    "",
    "כללים:",
    "- שאלה (למשל: מה לא צולם, איזה סרטון עלה, מה מוכן) איננה דיווח.",
    "- שלילה (למשל: עוד לא נערך, טרם צולם) איננה דיווח.",
    "- דיווח יכול להופיע בכל סדר מילים, למשל: ספרייט צולם / צילמתי את ספרייט.",
    "- שם התוכן חייב להיות אחד מהרשימה למעלה, או חלק ברור ממנו. אם אין התאמה, החזר/י לא.",
    "",
    "החזר/י JSON בלבד, בלי טקסט נוסף, במבנה:",
    '{"isStatusUpdate": true/false, "contentName": "שם מהרשימה או ריק", "statuses": ["filmed"|"edited"|"cover"|"uploaded"]}',
  ].join("\n");

  try {
    const raw = await askClaude(prompt, {
      withPersona: false,
      model: CLASSIFIER_MODEL,
    });
    const cleaned = (raw || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as ClaudeStatusResult;

    if (!parsed || typeof parsed.isStatusUpdate !== "boolean") return null;
    if (!parsed.isStatusUpdate) {
      return { isStatusUpdate: false, contentName: "", statuses: [] };
    }
    const name = (parsed.contentName || "").trim();
    const statuses = Array.isArray(parsed.statuses) ? parsed.statuses : [];
    // Never guess: an update with no name or no step is not actionable.
    if (!name || statuses.length === 0) return null;

    return { isStatusUpdate: true, contentName: name, statuses };
  } catch (error) {
    console.error(`[Status Intent] Claude classification failed: ${error}`);
    return null;
  }
};
