// Hebrew values are canonical for all enums
// These represent the actual Hebrew values used internally, in WhatsApp, and in Google Sheets
export type Category = "קפריסין" | "חתונה" | "שמלות" | "כללי" | "רווקות" | "רווקים" | "על החתונה";
export type Tone = "הסברתי" | "מצחיק" | "אותנטי" | "השראתי" | "טרנדי" | "רגשי";
export type Priority = "גבוה" | "בינוני" | "נמוך";
export type Platform = "אינסטגרם" | "טיקטוק";
export type RequiresShooting = "כן" | "לא";

export interface ContentIdeaDraft {
  shortName: string;
  category: Category;
  tone: Tone;
  priority: Priority;
  summary: string;
  requiresShooting?: RequiresShooting;
  platforms?: Platform[];
}

export interface DraftSummary extends ContentIdeaDraft {
  originalUserInput: string;
}
