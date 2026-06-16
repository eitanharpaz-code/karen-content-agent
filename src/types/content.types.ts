// Hebrew values are canonical for known categories, but dynamic categories are allowed for Sprint 9
export type Category = string;
export type Tone = "הסברתי" | "מצחיק" | "אותנטי" | "השראתי" | "טרנדי" | "רגשי";
export type Priority = "גבוה" | "בינוני" | "נמוך";
export type Platform = "אינסטגרם" | "טיקטוק";
export type RequiresShooting = "כן" | "לא";
export type ContentType = "ריל" | "פוסט" | "סטורי";

export interface ContentIdeaDraft {
  shortName: string;
  category: Category;
  tone: Tone;
  priority: Priority;
  contentType?: ContentType;
  summary: string;
  requiresShooting?: RequiresShooting;
  platforms?: Platform[];
  categoryExplicit?: boolean;
}

export interface DraftSummary extends ContentIdeaDraft {
  originalUserInput: string;
}
