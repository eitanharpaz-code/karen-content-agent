// Context resolution (name-recognition round, step A — 21.7.2026)
//
// Karen refers to content she just talked about using a pronoun:
//   "צילמתי את סקויה"  →  "ערכתי אותו גם"
// The status detector extracts "אותו גם" as a literal name, findProductionTaskByName
// misses, and she's bounced back to "write the name again". This module resolves
// such a pronoun to the last content name mentioned, using the conversation
// history that's ALREADY persisted (conversation-memory.service). We ask Claude
// (persona-free, classifier model) to read the recent transcript and return the
// content name — real understanding, not a pronoun regex, so it also covers
// phrasings we didn't enumerate. If it can't tell, it returns null and the
// caller falls back to asking Karen — we never guess a wrong item silently.

import { askClaude, CLASSIFIER_MODEL } from "./claude.service";
import { getRecentHistory } from "./conversation-memory.service";

// Only trigger resolution when the extracted "name" is essentially just a
// pronoun (optionally with a filler word like "גם"). A real name never looks
// like this, so this gate keeps us from second-guessing good matches.
const PRONOUN_ONLY = /^(?:את\s+)?(?:אותו|אותה|אותם|אותן|זה|זו|הוא|היא|ההוא|ההיא)(?:\s+(?:גם|הזה|הזאת|ההוא|ההיא))?$/;

export const looksLikePronounReference = (contentName: string): boolean => {
  return PRONOUN_ONLY.test((contentName || "").trim());
};

// Returns the resolved content name, or null if it can't be determined
// confidently (empty history, no clear referent, or any error).
export const resolvePronounToRecentContent = async (
  sender: string,
  pronounText: string
): Promise<string | null> => {
  if (!looksLikePronounReference(pronounText)) return null;

  const history = getRecentHistory(sender);
  if (history.length === 0) return null;

  const transcript = history
    .map((m) => (m.role === "user" ? `קרן: ${m.text}` : `עוזרת: ${m.text}`))
    .join("\n");

  const prompt = `להלן שיחה אחרונה בין קרן (יוצרת תוכן) לעוזרת שלה (הכי חדש בסוף):

${transcript}

בהודעה האחרונה קרן השתמשה במילה "${pronounText.trim()}" שמפנה לתוכן שהיא כבר הזכירה קודם בשיחה.
מה שם התוכן שהיא מתכוונת אליו? החזירי אך ורק את שם התוכן המדויק כפי שהוזכר, בלי מילים נוספות, בלי ניקוד, בלי מרכאות.
אם אי אפשר לדעת בוודאות לאיזה תוכן היא מתכוונת, החזירי בדיוק את המילה: לא-ידוע`;

  try {
    const answer = (
      await askClaude(prompt, { withPersona: false, model: CLASSIFIER_MODEL })
    ).trim();

    if (!answer || answer === "לא-ידוע" || answer.includes("לא-ידוע")) return null;
    // Guard against a chatty reply — a real content name is short-ish.
    if (answer.length > 80) return null;
    return answer;
  } catch (error) {
    console.error(`[context-resolution] pronoun resolve failed: ${error}`);
    return null;
  }
};
