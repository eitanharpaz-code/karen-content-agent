import { askClaude } from "./claude.service";
import { ContentIdeaDraft, DraftSummary, DraftPreviewCopy } from "../types/content.types";
import { cleanIdeaPrefix } from "../utils/conversation-utils";
import { formatHistoryForPrompt } from "./conversation-memory.service";
import {
  DEFAULT_NEW_DRAFT_COPY,
  DEFAULT_EDIT_COPY,
} from "./response-humanizer.service";

// Humanizer consolidation: parse the three preview-copy lines out of a
// draft/edit response. Any missing line falls back to the matching default
// so a partial parse can never break the preview flow. Exported for QA.
export const parsePreviewCopy = (
  text: string,
  mode: "new" | "edit"
): DraftPreviewCopy => {
  const fallback = mode === "edit" ? DEFAULT_EDIT_COPY : DEFAULT_NEW_DRAFT_COPY;
  const intro = text.match(/Intro[:\s]*([^\n]+)/i)?.[1]?.trim();
  const closing = text.match(/ClosingQuestion[:\s]*([^\n]+)/i)?.[1]?.trim();
  const change = text.match(/ChangeLine[:\s]*([^\n]+)/i)?.[1]?.trim();
  return {
    intro: intro || fallback.intro,
    closingQuestion: closing || fallback.closingQuestion,
    changeLine: change || fallback.changeLine,
  };
};

const VALID_TONES = ["הסברתי", "מצחיק", "אותנטי", "השראתי", "טרנדי", "רגשי"];
const VALID_PRIORITIES = ["גבוה", "בינוני", "נמוך"];
const VALID_CONTENT_TYPES = ["ריל", "פוסט", "סטורי"];

export const createContentDraft = async (userInput: string, sender?: string): Promise<ContentIdeaDraft> => {
  // Fix 1: Clean conversational prefixes from the beginning
  const cleanedInput = cleanIdeaPrefix(userInput);

  const historyContext = sender ? formatHistoryForPrompt(sender, userInput) : "";

  const draftPrompt = `${historyContext}הוראות שמירה ושיבוץ אינן חלק מסיכום הרעיון; הקוד מטפל בהן בנפרד. ההודעה הנוכחית היא רעיון עצמאי והיא הסמכות לתוכן. אין להוסיף הקשר של חתונה, אירוע, אדם או נושא מההיסטוריה אם קרן לא ביקשה זאת עכשיו. היסטוריה משמשת רק לפענוח הפניה מפורשת. הרחבה יצירתית אינה עובדה או חלק מבקשת קרן.\nאת עוזרת התוכן האישית של קרן בוואטסאפ.

קרן שלחה רעיון גולמי:
"${cleanedInput}"

המטרה שלך היא להפוך אותו לטיוטת תוכן ברורה, קצרה ושימושית, בשפה שמתאימה לקרן:
אותנטית, מצחיקה כשצריך, לא שיווקית מדי, ולא CRMית.

חשוב:
- שמרי על משמעות המילים שנכתבו. אין לתקן מילה לאדם, מקום או אירוע אחר על סמך ניחוש. לדוגמה "רילס איך אני מחבקת דוגמא" אינו "מחבקת דוגמן". שמרי את הכיוון "איך אני מחבקת"; אל תוסיפי דוגמן, תכנון מושלם או מאחורי הקלעים.
- אל תוסיפי תוויות מילוי כמו "בסגנון אותנטי ומצחיק" או "בסגנון מצחיק ואמיתי" לסיכום. תארי את הרעיון עצמו.
- כשיש מעט מידע, החזירי תיאור קצר ונאמן למקור. אין חובה להרחיב או להמציא עלילה. הרחבה יצירתית רק אם התבקשה במפורש.
- ברירת המחדל היא ריל, אבל פוסט, קרוסלה וסטורי מפורשים קודמים לברירת המחדל.
- אל תעני לקרן ישירות.
- אל תשאלי אם לשמור.
- אל תוסיפי הקדמה או הסבר.
- החזירי רק את השדות המובנים למטה, כי הקוד קורא אותם אוטומטית.
- שמרי את שמות השדות באנגלית בדיוק כמו שהם.
- כל הערכים עצמם צריכים להיות בעברית.
- אל תשתמשי במקפים ארוכים או קצרים בתוך משפטים. במקומם פסיק, נקודה, או ניסוח מחדש.
- שיתוף פעולה: אם קרן מציינת שהתוכן הוא שיתוף פעולה או חסות, בכל צורה שהיא (שת"פ, שתפ, שיתוף פעולה, קולאב, ממומן, בחסות, או כתיב שגוי דומה), זהי את שם המותג מתוך ההקשר. במקרה כזה:
  - Short Name חייב להיות: שת"פ [שם המותג]. למשל "שתפ עם ספרייט על שיחות" יהפוך ל: שת"פ ספרייט.
  - Summary יתאר את הרעיון עצמו, כולל שם המותג בתוכו.
  - אם לא ברור מי המותג, אל תמציאי שם. במקרה כזה תני שם רגיל לפי הנושא.

החזירי בדיוק במבנה הזה:
Short Name: [שם קצר בעברית, עד 5 מילים. אם זה שיתוף פעולה עם מותג, השם חייב להיות: שת"פ [שם המותג]]
Category: [תמיד "כללי" — אין יותר סיווג לקטגוריות נושאיות]
// טון ועדיפות הוסרו מהפרומפט (23.7.2026): קרן לא נשאלת עליהם ולא רואה אותם,
// והקוד ממלא ברירת מחדל. השדות נשארו בגיליון כדי לא לשבור לקוחות עתידיים
// שירצו לתעדף, ואפשר לשנות אותם דרך עריכה מפורשת.
Content Type: [אחד בלבד: ריל, פוסט, סטורי]
Summary: [תיאור קצר וטבעי של הכיוון, במשפט אחד או שניים. אל תפתחי את הסיכום במילים סרטון, ריל, רילס, סטורי או פוסט, כי סוג התוכן כבר מופיע במשפט הפתיחה. התחילי ישר מהתוכן עצמו]
`;

  const response = await askClaude(draftPrompt);

  // Parse the Claude response to extract draft fields
  // Hebrew values are canonical - no translation needed
  const parseResponse = (text: string): ContentIdeaDraft => {
    const shortNameMatch = text.match(/Short Name[:\s]*([^\n]+)/i);
    const categoryMatch = text.match(/Category[:\s]*([^\n]+)/i);
    const toneMatch = text.match(/Tone[:\s]*([^\n]+)/i);
    const priorityMatch = text.match(/Priority[:\s]*([^\n]+)/i);
    const contentTypeMatch = text.match(/Content Type[:\s]*([^\n]+)/i);
    const summaryMatch = text.match(/Summary[:\s]*([^\n]+)/i);

    // Normalize tone to Hebrew values (Claude might return variations)
    let tone = (toneMatch?.[1] || "מצחיק").trim();
    const toneMapping: Record<string, string> = {
      "professional": "הסברתי",
      "educational": "הסברתי",
      "fun": "מצחיק",
      "funny": "מצחיק",
      "authentic": "אותנטי",
      "inspirational": "השראתי",
      "casual": "טרנדי",
      "trendy": "טרנדי",
      "emotional": "רגשי",
    };
    tone = toneMapping[tone.toLowerCase()] || tone;

    // Normalize priority to Hebrew values
    let priority = (priorityMatch?.[1] || "בינוני").trim();
    const priorityMapping: Record<string, string> = {
      "high": "גבוה",
      "medium": "בינוני",
      "low": "נמוך",
    };
    priority = priorityMapping[priority.toLowerCase()] || priority;

    // Normalize content type to Hebrew values
    let contentType = (contentTypeMatch?.[1] || "ריל").trim();
    const contentTypeMapping: Record<string, string> = {
      "reel": "ריל",
      "reels": "ריל",
      "post": "פוסט",
      "static post": "פוסט",
      "carousel": "פוסט",
      "story": "סטורי",
      "stories": "סטורי",
    };
    contentType = contentTypeMapping[contentType.toLowerCase()] || contentType;
    if (!["ריל", "פוסט", "סטורי"].includes(contentType)) {
      contentType = "ריל";
    }

    // Normalize category to Hebrew values
    let category = (categoryMatch?.[1] || "כללי").trim();
    const categoryMapping: Record<string, string> = {
      "cyprus": "קפריסין",
      "wedding": "חתונה",
      "dresses": "שמלות",
      "general": "כללי",
      "bachelorette": "רווקות",
      "bachelor": "רווקים",
      "pre wedding": "על החתונה",
      "pre-wedding": "על החתונה",
      "trend": "טרנד",
      "טרנד": "טרנד",
    };
    category = categoryMapping[category.toLowerCase()] || category;

    return {
      shortName: (shortNameMatch?.[1] || cleanedInput.substring(0, 30)).trim(),
      category: category as any,
      tone: tone as any,
      priority: priority as any,
      contentType: contentType as any,
      summary: (summaryMatch?.[1] || cleanedInput).trim(),
      // Humanizer consolidation: wrapping copy from the same call.
      previewCopy: parsePreviewCopy(text, "new"),
    };
  };

  return parseResponse(response);
};

// AI fallback for free-form edits: when the hardcoded parser in
// confirmation.service (parseEditRequest) cannot interpret the user's edit
// request, this asks Claude to apply the edit onto the current draft and
// return the updated draft. Returns null on any failure (invalid response,
// unclear request, or API error) so the caller falls back to today's
// clarification prompt — never crashes the flow.
// Explicit "new idea" indicators — if present, skip AI edit path entirely so
// the user isn't accidentally forced into editing a stale draft when they've
// clearly signaled they want to start over.
const NEW_IDEA_INDICATORS = [
  "רעיון חדש",
  "רעיון אחר",
  "יש לי רעיון",
  "יש לי עוד רעיון",
];

export const askClaudeForEdit = async (
  currentDraft: DraftSummary,
  userEditMessage: string,
  sender?: string
): Promise<DraftSummary | null> => {
  const normalized = userEditMessage.trim();
  for (const indicator of NEW_IDEA_INDICATORS) {
    if (normalized.includes(indicator)) return null;
  }

  const historyContext = sender ? formatHistoryForPrompt(sender, userEditMessage) : "";

  const editPrompt = `${historyContext}קרן שולחת בקשת עריכה על טיוטת התוכן הבאה:

הבקשה המקורית של קרן: ${currentDraft.originalUserInput}
תיקון קצר כמו "לא מחבקת, מקשקשת" מחליף את הפעולה בטיוטה הקיימת. גם "מקשקשת ולא מחבקת", "יותר קליל", "רילס במקום פוסט" ו"כן אבל בלי דוגמן" הם עריכות. הסירי פרטים שהמצאת ושאינם נתמכים בבקשה המקורית, בלי להמציא פרטים חלופיים.
ביקורת כמו ״למה חתונה?״ היא הוראה להסיר הקשר שהוספת ללא בקשה, ולא שאלה כללית. אל תמציאי הקשר חלופי.

טיוטה נוכחית:
Short Name: ${currentDraft.shortName}
Category: ${currentDraft.category}
Tone: ${currentDraft.tone}
Priority: ${currentDraft.priority}
Content Type: ${currentDraft.contentType || "ריל"}
Summary: ${currentDraft.summary}

בקשת העריכה של קרן:
"${userEditMessage}"

המטרה: להחיל את בקשת העריכה על הטיוטה הקיימת בצורה חכמה וטבעית, כמו עוזרת אישית אמיתית שקוראת, מבינה, ומעדכנת את הרעיון בסגנון של קרן.

כללים חשובים:
1. אם בקשת העריכה מוסיפה או משנה מידע על הרעיון עצמו (מיקום, נסיבות, זמן, מי משתתף, פרטים על הנושא) — כתבי את הסיכום מחדש בצורה טבעית ומשולבת, בסגנון של הסיכום המקורי. אל תוסיפי רק מילה אחת לתוך משפט קיים — תני לזה להישמע כמו שקרן היתה כותבת מחדש עם המידע החדש.
2. בקשת סגנון טבעית כמו "מצחיק יותר", "יותר קליל", "שיהיה מצחיק יותר" או "עם הומור" היא בקשת עריכה של הניסוח עצמו. כתבי מחדש את Summary כך שהסגנון יורגש בקריאה; עדכון Tone או הוספת "בסגנון מצחיק ומוגזם" אינם ממלאים את הבקשה. אפשר לחדד ניגוד או הומור עצמי שכבר קיים ברעיון. אין להמציא משתתפים, חפצים שנשכחו, אירועים או עובדות אישיות.
   לדוגמה, "חמישה דברים שאני תמיד שוכחת לארוז לחופשה" + "בעצם שלושה דברים, ושיהיה מצחיק יותר": "קרוסלה על שלושה דברים שאני תמיד שוכחת לארוז. המזוודה יוצאת לחופשה, הזיכרון נשאר בבית." זה כיוון לניסוח, לא משפט קבוע לכל רעיון. שמרי את המספר שלושה ואת פורמט הקרוסלה; אל תמציאי מהם שלושת הדברים.
   אם התבקש סגנון אחר, אותו עיקרון חל: פחות רשמי = מילים יומיומיות, קצר יותר = הסרת מלל מיותר. אל תוסיפי רשימת הצעות או שאלות נוספות.
   רק כשקרן מבקשת במפורש לשנות שדה בלבד (למשל "שני רק את הטון למצחיק, אל תשני את הטקסט"), עדכני את השדה בלבד. שינוי שם, עדיפות או סוג תוכן בלבד אינו הרשאה להמציא סיכום חדש.
3. השם הקצר: אם הסיכום השתנה משמעותית והשם הקיים כבר לא מתאים, אפשר לרענן אותו בזהירות. אחרת השארי כפי שהוא.
4. שיתוף פעולה: אם התוכן הוא שיתוף פעולה או חסות, בכל צורה שהיא (שת"פ, שתפ, שיתוף פעולה, קולאב, ממומן, בחסות, או כתיב שגוי דומה), השם חייב להישאר בפורמט: שת"פ [שם המותג]. אם קרן משנה את המותג, עדכני את השם בהתאם. אם השם כבר בפורמט הזה, אל תשני אותו לנושא הסרטון.
4. אל תוסיפי הסבר או הקדמה. החזירי רק את הטיוטה המעודכנת בפורמט למטה.
5. שמרי את שמות השדות באנגלית בדיוק כמו שהם.
6. כל הערכים עצמם צריכים להיות בעברית.

ערכים מותרים לשדות המובנים:
- Category: השאירי בדיוק את הקטגוריה הנוכחית של הטיוטה כפי שהיא (אין יותר סיווג לקטגוריות נושאיות)
- Tone: הסברתי, מצחיק, אותנטי, השראתי, טרנדי, רגשי
- Priority: גבוה, בינוני, נמוך
- Content Type: ריל, פוסט, סטורי

מיפוי של ביטויים טבעיים בעברית לערכי הטון (חשוב! אל תפספסי את זה):
- "קליל" / "יותר קליל" / "פחות כבד" / "בקטע קליל" / "עם הומור" / "מצחיק יותר" → מצחיק
- "פחות רשמי" / "בגובה העיניים" / "אישי יותר" / "טבעי" / "רגיל" → אותנטי
- "רציני" / "מסביר" / "אינפורמטיבי" / "מקצועי" → הסברתי
- "עמוק" / "מרגש" / "נוגע ללב" / "פחות דרמטי" → רגשי
- "מלהיב" / "מעורר השראה" / "חיובי" → השראתי
- "בטרנד" / "אקטואלי" / "פופולרי" / "וויראלי" → טרנדי

מיפוי של ביטויי עדיפות טבעיים:
- "דחוף" / "בראש התור" / "חשוב מאוד" → גבוה
- "לא דחוף" / "כשיהיה זמן" / "בסוף התור" → נמוך

מיפוי של ביטויי סוג תוכן טבעיים:
- "סטוריז" / "כסטורי" / "לסטוריז" / "סטורי" → סטורי
- "פוסט" / "כפוסט" / "סטטי" → פוסט
- "ריל" / "כריל" / "סרטון קצר" / "וידאו" → ריל

אם בקשת העריכה של קרן לא ברורה, לא הגיונית ביחס לטיוטה, או שהיא בעצם מציגה רעיון חדש לגמרי במקום לערוך את הקיים (לדוגמה: "יש לי רעיון חדש...", "רעיון אחר...", או תיאור של נושא שלא קשור לטיוטה הנוכחית) — החזירי בדיוק את המילה: UNCLEAR

אחרת החזירי בדיוק במבנה הזה:
Short Name: [...]
Category: [...]
Tone: [...]
Priority: [...]
Content Type: [...]
Summary: [...]
Intro: [משפט פתיחה קצר שמאשר את השינוי, 3-8 מילים, למשל: "עברתי לטון קליל יותר" / "עדכנתי את הכיוון" / "החלפתי, בואי נראה"]
ClosingQuestion: [שאלת אישור קצרה, 2-4 מילים, למשל: "לשמור?" / "להתקדם עם זה?" / "לקבע?"]
ChangeLine: [הזמנה קצרה לשינויים נוספים, 4-8 מילים, למשל: "אפשר להגיד לי מה עוד לשנות" / "פתוחה לשינויים"]

שלוש השורות האחרונות (Intro, ClosingQuestion, ChangeLine) הן טקסט עוטף שיוצג לקרן סביב הטיוטה המעודכנת: עברית טבעית וחמה, בלי CRM, בלי אימוג'י, ואל תחזרי על אותו נוסח בכל פעם.`;

  try {
    const response = await askClaude(editPrompt);

    if (response.trim().toUpperCase().includes("UNCLEAR")) {
      return null;
    }

    const shortNameMatch = response.match(/Short Name[:\s]*([^\n]+)/i);
    const categoryMatch = response.match(/Category[:\s]*([^\n]+)/i);
    const toneMatch = response.match(/Tone[:\s]*([^\n]+)/i);
    const priorityMatch = response.match(/Priority[:\s]*([^\n]+)/i);
    const contentTypeMatch = response.match(/Content Type[:\s]*([^\n]+)/i);
    const summaryMatch = response.match(/Summary[:\s]*([^\n]+)/i);

    if (!shortNameMatch || !categoryMatch || !toneMatch || !priorityMatch || !summaryMatch) {
      return null;
    }

    const tone = toneMatch[1].trim();
    const priority = priorityMatch[1].trim();
    const contentType = (contentTypeMatch?.[1] || currentDraft.contentType || "ריל").trim();

    if (!VALID_TONES.includes(tone)) return null;
    if (!VALID_PRIORITIES.includes(priority)) return null;
    if (!VALID_CONTENT_TYPES.includes(contentType)) return null;

    return {
      ...currentDraft,
      shortName: shortNameMatch[1].trim(),
      category: categoryMatch[1].trim() as any,
      tone: tone as any,
      priority: priority as any,
      contentType: contentType as any,
      summary: summaryMatch[1].trim(),
      // Humanizer consolidation: wrapping copy from the same call.
      previewCopy: parsePreviewCopy(response, "edit"),
    };
  } catch (error) {
    console.error(`[askClaudeForEdit] Error: ${error}. Returning null (fallback to clarification).`);
    return null;
  }
};
