import { askClaude, CLASSIFIER_MODEL } from "./claude.service";
import { formatHistoryForPrompt } from "./conversation-memory.service";

// Level-2 conversational intelligence: classify a message that fell through
// every specific handler (edit, visibility, status update, gantt, etc.) so
// we don't blindly turn "היי" or "תודה" into a full content draft.
//
// Fires from the controller ONLY at the very end of the routing chain,
// right before the "create new draft" branch. Anything that a specific
// handler already caught (edits, visibility queries, gantt writes, etc.)
// never reaches this classifier.

export type ConversationIntent = "greeting" | "small_talk" | "new_idea" | "unclear";

// Cheap sync gate for the most obvious greetings/pleasantries. Exact match
// with optional trailing punctuation. Skips the AI classifier call when the
// message is unambiguous — saves latency and cost.
const GREETING_PATTERNS: RegExp[] = [
  /^\s*היי\s*[,.!?]?\s*$/i,
  /^\s*הי\s*[,.!?]?\s*$/i,
  /^\s*שלום\s*[,.!?]?\s*$/i,
  /^\s*בוקר טוב\s*[,.!?]?\s*$/i,
  /^\s*צהריים טובים\s*[,.!?]?\s*$/i,
  /^\s*ערב טוב\s*[,.!?]?\s*$/i,
  /^\s*לילה טוב\s*[,.!?]?\s*$/i,
  /^\s*מה קורה\s*[,.!?]?\s*$/i,
  /^\s*מה נשמע\s*[,.!?]?\s*$/i,
  /^\s*מה המצב\s*[,.!?]?\s*$/i,
  /^\s*מה העניינים\s*[,.!?]?\s*$/i,
  /^\s*(hi|hey|hello|yo)\s*[,.!?]?\s*$/i,
  /^\s*(תודה|thanks|thank you|thx|ty)\s*[,.!?]?\s*$/i,
  /^\s*תודה רבה\s*[,.!?]?\s*$/i,
  /^\s*(אוקיי|אוקי|ok|okay)\s*[,.!?]?\s*$/i,
  /^\s*(סבבה|מגניב|יופי|מעולה|נהדר|כיף|יפה)\s*[,.!?]?\s*$/i,
  /^\s*(אוקיי|אוקי|בסדר|סבבה|נהדר|מעולה)\s+תודה\s*[,.!?]?\s*$/i,
];

export const isPureGreeting = (message: string): boolean =>
  GREETING_PATTERNS.some((p) => p.test(message));

export const classifyMessageIntent = async (
  message: string,
  sender?: string
): Promise<ConversationIntent> => {
  if (isPureGreeting(message)) return "greeting";

  const historyContext = sender ? formatHistoryForPrompt(sender, message) : "";

  const prompt = `${historyContext}קרן שלחה הודעה בוואטסאפ. הקוד שלה כבר בדק שהיא לא בקשת עריכה, לא שאלת סטטוס/גאנט/דחיפות, ולא פקודה מוכרת. עכשיו צריך להבין מה זה בכלל: האם קרן שולחת רעיון תוכן חדש, או משהו אחר.

הודעה של קרן:
"${message}"

בחרי מזהה אחד בדיוק מהרשימה:
- new_idea — קרן מציגה רעיון חדש לתוכן (סרטון, פוסט, סטורי, קונספט). זה יכול להיות מנוסח בקצרה או בהתחלה של רעיון.
- greeting — ברכה בלבד ("היי", "בוקר טוב"), בלי תוכן. גם "תודה", "אוקיי", "מגניב" נכללים כאן.
- small_talk — שיחת חולין, בדיחה, אמירה כללית שלא קשורה לתוכן ולא ברכה טהורה ("איך היה היום שלך?", "בא לי קפה", "כמה שעה?").
- unclear — הודעה לא מובנת, אקראית, קצרה מאוד או שלא ברור מה קרן רוצה. במקרה של ספק אמיתי בין new_idea לבין השאר — במיוחד כשיש רמז לרעיון, אפילו רזה — עדיף new_idea כדי לא לאבד רעיון.

כללים:
- החזירי בדיוק את המזהה, בלי הסבר, בלי הקדמה, בלי סימני פיסוק.
- אם ההודעה מרגישה כמו התחלה של רעיון (גם רזה), החזירי new_idea. לא לאבד רעיונות של קרן.
- אם ההודעה היא רק ברכה או "תודה"/"אוקיי" — greeting.
- אם ההודעה היא שיחת חולין כללית שלא קשורה לתוכן — small_talk.
- רק אם באמת אין שום דבר לזהות — unclear.`;

  try {
    // Classifier task (one of 4 enum values) — route to Haiku for ~1/3 cost.
    // Classifier call: one-word answer, persona-free (see AskClaudeOptions).
    const response = await askClaude(prompt, { model: CLASSIFIER_MODEL, withPersona: false });
    const cleaned = response
      .trim()
      .toLowerCase()
      .replace(/[.,;:!?"׳״'`]/g, "")
      .split(/\s+/)[0];

    if (cleaned === "greeting" || cleaned === "small_talk" || cleaned === "new_idea" || cleaned === "unclear") {
      return cleaned as ConversationIntent;
    }
    // Ambiguous response — default to new_idea to avoid losing content.
    return "new_idea";
  } catch (error) {
    console.error(`[classifyMessageIntent] Error: ${error}. Defaulting to new_idea.`);
    return "new_idea";
  }
};

// Generate a short conversational reply in Karen's persona.
// askClaude already loads system-prompt.md, so persona is preserved.
export const generateConversationalReply = async (
  message: string,
  sender?: string
): Promise<string> => {
  const historyContext = sender ? formatHistoryForPrompt(sender, message) : "";

  const prompt = `${historyContext}קרן שלחה הודעה בוואטסאפ שהיא לא רעיון תוכן — זו ברכה, שיחת חולין, או אמירה קצרה.

הודעה של קרן:
"${message}"

הגיבי אליה בעברית טבעית וחמה, כמו העוזרת האישית שלה. משפט או שניים לכל היותר. בלי אימוג'י. בלי להציע לה תפריט או אפשרויות אלא אם היא ביקשה. אם היא רק פתחה שיחה בברכה, החזירי ברכה חמה קצרה ותני לה להוביל.

חשוב מאוד: בשלב הזה לא בוצעה שום פעולה במערכת. אסור לך לאשר פעולה שלא קרתה.
אל תכתבי "עדכנתי", "שמרתי", "סימנתי", "שיבצתי", "העברתי" או כל ניסוח שמשתמע ממנו שמשהו בוצע.
אם ההודעה נשמעת כמו עדכון על תוכן (למשל שמשהו צולם, נערך או עלה) אבל לא זיהינו לאיזה תוכן היא מתייחסת, אמרי בפשטות שלא הצלחת לזהות על איזה תוכן מדובר ובקשי שם מלא יותר.
החזירי רק את הטקסט של התגובה, בלי הקדמה או הסבר.`;

  try {
    const response = await askClaude(prompt);
    return response.trim();
  } catch (error) {
    console.error(`[generateConversationalReply] Error: ${error}. Falling back to canned greeting.`);
    return "היי! כאן. עדכני אותי במה תרצי לעבוד.";
  }
};
