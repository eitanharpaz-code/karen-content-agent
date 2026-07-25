export const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

export const getHebrewDayName = (date: Date): string => {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
};

export const normalizeUserDateInput = (
  input: string,
  fallbackYear: number = new Date().getFullYear()
): string | null => {
  // STRIP_DATE_PREFIX (25.7.2026): Karen writes the date attached to a prefix
  // ("ל27/7", "ב-27.7", "לתאריך 27/7") because that is natural Hebrew. The
  // letter glued to the digits broke parsing and four valid attempts in a row
  // were rejected.
  if (typeof input === "string") {
    input = input
      .trim()
      .replace(/^(?:לתאריך|בתאריך|תאריך)\s*/u, "")
      .replace(/^[לבמ]\s*[-־]?\s*/u, "")
      .trim();
  }

  const match = input.trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3]
    ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
    : fallbackYear;

  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
};

export const parseDateFromSheet = (dateStr: string): Date | null => {
  if (!dateStr) return null;

  const normalized = normalizeUserDateInput(dateStr);
  if (!normalized) return null;

  const [day, month, year] = normalized.split("/").map(Number);
  return new Date(year, month - 1, day);
};

export const isThisWeek = (dateStr: string): boolean => {
  const date = parseDateFromSheet(dateStr);
  if (!date) return false;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  return date >= startOfWeek && date <= endOfWeek;
};
