export const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

export const getHebrewDayName = (date: Date): string => {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
};

export const isThisWeek = (dateStr: string): boolean => {
  if (!dateStr) return false;
  
  // Parse DD/MM/YYYY format
  const parts = dateStr.split("/");
  if (parts.length !== 3) return false;
  
  const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  return date >= startOfWeek && date <= endOfWeek;
};

export const parseDateFromSheet = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  const date = new Date(year, month, day);
  return isNaN(date.getTime()) ? null : date;
};