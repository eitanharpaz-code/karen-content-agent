export type OverdueDecisionIntent =
  | { type: "published" }
  | { type: "reschedule"; dateText: string | null }
  | { type: "archive" }
  | { type: "undecided" };

const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[״"]/g, "")
    .replace(/[!?.,…]+$/g, "")
    .replace(/\s+/g, " ");

export const detectOverdueDecisionIntent = (
  text: string
): OverdueDecisionIntent | null => {
  const normalized = normalize(text);

  if (
    [
      "עלה",
      "העליתי",
      "פורסם",
      "פרסמתי",
      "הוא עלה",
      "כבר עלה",
      "כבר העליתי",
      "עלה לאוויר",
    ].includes(normalized)
  ) {
    return { type: "published" };
  }

  if (
    [
      "לארכיון",
      "ארכיון",
      "בוטל",
      "לבטל",
      "תבטלי",
      "לא יעלה",
    ].includes(normalized)
  ) {
    return { type: "archive" };
  }

  if (
    [
      "עוד לא",
      "לא יודעת",
      "לא יודע",
      "לא החלטתי",
      "נחליט אחר כך",
    ].includes(normalized)
  ) {
    return { type: "undecided" };
  }

  const rescheduleMatch = normalized.match(
    /^(?:לדחות|נדחה|תדחי|להעביר|תעבירי)(?: אותו)?(?:\s+ל[־-]?|\s+לתאריך\s+)?(.*)$/
  );

  if (rescheduleMatch) {
    return {
      type: "reschedule",
      dateText: rescheduleMatch[1]?.trim() || null,
    };
  }

  return null;
};
