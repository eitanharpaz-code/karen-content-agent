import { askClaude } from "./claude.service";
import { ContentIdeaDraft } from "../types/content.types";
import { cleanIdeaPrefix } from "../utils/conversation-utils";

export const createContentDraft = async (userInput: string): Promise<ContentIdeaDraft> => {
  // Fix 1: Clean conversational prefixes from the beginning
  const cleanedInput = cleanIdeaPrefix(userInput);

  const draftPrompt = `אני מקבל את הרעיון הבא לתוכן: "${cleanedInput}"

בנה לי הצעה מובנית לתוכן עם:
- Short Name (שם קצר לתוכן בעברית, עד 5 מילים)
- Category (קטגוריה בעברית: קפריסין, חתונה, שמלות, כללי, רווקות, רווקים, או על החתונה)
- Tone (טון בעברית: הסברתי, מצחיק, אותנטי, השראתי, טרנדי, או רגשי)
- Priority (עדיפות בעברית: גבוה, בינוני, או נמוך)
- Content Type (סוג תוכן בעברית: ריל, פוסט, או סטורי)
- Summary (תיאור קצר של התוכן המוצע)

אחרי זה, שאל אם זה בסדר לשמור.`;

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
    let tone = (toneMatch?.[1] || "הסברתי").trim();
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
    };
  };

  return parseResponse(response);
};
