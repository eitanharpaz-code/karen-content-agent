export type PlanningHealthSignalType =
  | "next_week_missing_reel"
  | "next_week_missing_post";

export type PlanningHealthSeverity = "critical" | "normal";

export type PlanningHealthSignal = {
  type: PlanningHealthSignalType;
  severity: PlanningHealthSeverity;
  message: string;
  recommendedAction: string;
  missingCount?: number;
};

export type PlanningGanttItem = {
  contentId: string;
  date: string;
  contentType: string;
  collaboration?: string;
  status?: string;
};

export type PlanningHealthOptions = {
  anchorDate?: Date;
  weeklyReelTarget?: number;
  weeklyPostTarget?: number;
};

const DEFAULT_WEEKLY_REEL_TARGET = 2;
const DEFAULT_WEEKLY_POST_TARGET = 1;

const parseSheetDate = (dateText: string): Date | null => {
  const parts = dateText.split("/");
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (!day || !month || !year) return null;

  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
};

const isUsableContentId = (contentId: string): boolean => {
  const normalized = (contentId || "").trim();

  return normalized !== "" && normalized !== "טרם תוכנן";
};

const startOfWeek = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());

  return result;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);

  return result;
};

const isInRange = (date: Date, start: Date, end: Date): boolean =>
  date >= start && date <= end;

const isCancelledStatus = (status: string | undefined): boolean =>
  ["בוטל", "ארכיון"].includes((status || "").trim());

const isCollaboration = (item: PlanningGanttItem): boolean => {
  const value = (item.collaboration || "").trim();

  return value !== "" && value !== "לא";
};

const isOrganicScheduledItem = (item: PlanningGanttItem): boolean =>
  isUsableContentId(item.contentId) &&
  !isCancelledStatus(item.status) &&
  !isCollaboration(item);

const isReel = (item: PlanningGanttItem): boolean =>
  (item.contentType || "").includes("ריל");

const isPost = (item: PlanningGanttItem): boolean => {
  const contentType = item.contentType || "";

  return contentType.includes("פוסט") || contentType.includes("קרוסלה");
};

export const computePlanningHealthSignals = (
  ganttItems: PlanningGanttItem[],
  options: PlanningHealthOptions = {}
): PlanningHealthSignal[] => {
  const anchor = options.anchorDate ? new Date(options.anchorDate) : new Date();
  anchor.setHours(0, 0, 0, 0);

  const weeklyReelTarget =
    options.weeklyReelTarget ?? DEFAULT_WEEKLY_REEL_TARGET;
  const weeklyPostTarget =
    options.weeklyPostTarget ?? DEFAULT_WEEKLY_POST_TARGET;
  const currentWeekStart = startOfWeek(anchor);
  const nextWeekStart = addDays(currentWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const activeOrganicItems = ganttItems
    .map((item) => ({ item, date: parseSheetDate(item.date) }))
    .filter((entry): entry is { item: PlanningGanttItem; date: Date } =>
      Boolean(entry.date) && isOrganicScheduledItem(entry.item)
    );

  const nextWeekItems = activeOrganicItems.filter((entry) =>
    isInRange(entry.date, nextWeekStart, nextWeekEnd)
  );

  const nextWeekReels = nextWeekItems.filter((entry) =>
    isReel(entry.item)
  );

  const nextWeekPosts = nextWeekItems.filter((entry) =>
    isPost(entry.item)
  );

  const severity: PlanningHealthSeverity =
    anchor.getDay() >= 4 ? "critical" : "normal";

  const signals: PlanningHealthSignal[] = [];

  if (nextWeekReels.length < weeklyReelTarget) {
    const missingCount = weeklyReelTarget - nextWeekReels.length;
    signals.push({
      type: "next_week_missing_reel",
      severity,
      missingCount,
      message:
        missingCount === 1
          ? "שבוע הבא חסר עוד ריל אחד בגאנט."
          : `שבוע הבא חסרים עוד ${missingCount} רילסים בגאנט.`,
      recommendedAction: "בואי נשלים את השבוע הבא",
    });
  }

  if (nextWeekPosts.length < weeklyPostTarget) {
    const missingCount = weeklyPostTarget - nextWeekPosts.length;
    signals.push({
      type: "next_week_missing_post",
      severity,
      missingCount,
      message:
        missingCount === 1
          ? "שבוע הבא חסר עוד פוסט אחד בגאנט."
          : `שבוע הבא חסרים עוד ${missingCount} פוסטים בגאנט.`,
      recommendedAction: "בואי נשלים פוסט לשבוע הבא",
    });
  }

  return signals;
};
