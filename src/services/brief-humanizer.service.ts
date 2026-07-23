import { askClaude } from "./claude.service";

// Humanizes the morning and afternoon briefs. The deterministic brief
// builders in daily-brief.service.ts already compute the correct facts
// (which content is P0, which titles matter today, what CTAs to offer).
// This wrapper asks Claude to rewrite only the phrasing/tone in Karen's
// voice — facts, names, numbers, section headers (*starred*), and CTAs
// stay verbatim, because Claude is instructed to preserve them and
// because a length-check fallback catches any run-away rewrites.
//
// Falls back to the deterministic string on any error, empty response,
// or absurdly long output. The brief is never lost.
//
// Cost: briefs fire at most twice a day (9am + 4:30pm). At ~$0.005 per
// humanization, that's ~$0.30/month even if both fire every day. Trivial.
//
// The default model is Sonnet because writing warm, natural Hebrew
// prose is exactly the case where Sonnet quality matters. Prompt
// caching (see claude.service) keeps the persona overhead cheap.

const buildPrompt = (
  deterministicBrief: string,
  briefType: "morning" | "afternoon"
): string => {
  const timeContext = briefType === "morning" ? "בוקר" : "אחר הצהריים";
  const toneGuidance =
    briefType === "morning"
      ? 'טון של בוקר — קצר, חם, פוקוס על מה שחשוב היום. לא ארוך, לא מוסרני.'
      : 'טון של אחר הצהריים — תזכורת עדינה, מכוונת לפעולה, לא לוחצת.';

  return `את עוזרת התוכן האישית של קרן. יש לי טקסט של בריף ${timeContext} שנוצר אוטומטית מנתוני הגיליון של קרן. אני צריכה ממך רק לשכתב אותו בעברית טבעית וחמה בסגנון של קרן, כאילו את שולחת לה הודעה אישית ב-WhatsApp.

הטקסט המקורי:
"""
${deterministicBrief}
"""

כללים חשובים:
- שמרי על כל העובדות והשמות במדויק: שמות תוכן, מספרים, תאריכים, שמות חודשים, פעולות מומלצות, שמות קטגוריות.
- אם יש CTAs (למשל "בואי נתכנן את יוני" או "מה החורים בגאנט") — הם חייבים להישאר בדיוק כפי שהם, כי הקוד מזהה אותם כפי שנכתבו.
- אם יש כותרות עם *כוכביות* (למשל *דורש תשומת לב עכשיו*, *פוקוס להיום*, *ברקע*, *אפשר לענות*) — שמרי את הפורמט הזה כי הוא מייצר bold ב-WhatsApp.
- שמרי על מבנה הרשימות (השורות שמתחילות ב-* עם רווח).
- אל תוסיפי מידע חדש שלא היה במקור. אל תמציאי שמות תוכן, תאריכים או מספרים.
- ${toneGuidance}
- בלי CRM, בלי אימוג'י (חוץ מ-:) אם הוא כבר במקור), בלי "היי מהיום המדהים" — פשוט טבעי כאילו את קרן.
- בלי מקפים בתוך משפטים, במקומם פסיק או נקודה.
- החזירי רק את הטקסט המשוכתב, בלי הקדמה, בלי הסבר.`;
};

export const humanizeBrief = async (
  deterministicBrief: string,
  briefType: "morning" | "afternoon"
): Promise<string> => {
  if (!deterministicBrief || !deterministicBrief.trim()) {
    return deterministicBrief;
  }

  const prompt = buildPrompt(deterministicBrief, briefType);

  try {
    const response = await askClaude(prompt);
    const trimmed = response.trim();

    // Sanity checks — reject empty, missing, or run-away output.
    if (!trimmed) return deterministicBrief;
    if (trimmed.length < Math.floor(deterministicBrief.length * 0.4)) {
      // Suspiciously short — Claude probably dropped content.
      return deterministicBrief;
    }
    if (trimmed.length > deterministicBrief.length * 2.5) {
      // Suspiciously long — Claude probably invented content.
      return deterministicBrief;
    }

    return trimmed;
  } catch (error) {
    console.error(
      `[humanizeBrief] Error humanizing ${briefType} brief: ${error}. Falling back to deterministic version.`
    );
    return deterministicBrief;
  }
};
