export type PlanningHealthSignalType =
  | "current_week_missing_reel"
  | "current_week_missing_post"
  | "next_week_empty_or_light";

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
  nextWeekMinimumOrganicItems?: number;
};

const DEFAULT_WEEKLY_REEL_TARGET = 2;
const DEFAULT_WEEKLY_POST_TARGET = 1;
const DEFAULT_NEXT_WEEK_MINIMUM_ORGANIC_ITEMS = 2;

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

const isInactiveStatus = (status: string | undefined): boolean =>
  ["פורסם", "בוטל", "ארכיון"].includes((status || "").trim());

const isCollaboration = (item: PlanningGanttItem): boolean => {
  const value = (item.collaboration || "").trim();

  return value !== "" && value !== "לא";
};

const isOrganicActiveItem = (item: PlanningGanttItem): boolean =>
  isUsableContentId(item.contentId) &&
  !isInactiveStatus(item.status) &&
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
  const nextWeekMinimumOrganicItems =
    options.nextWeekMinimumOrganicItems ?? DEFAULT_NEXT_WEEK_MINIMUM_ORGANIC_ITEMS;

  const currentWeekStart = startOfWeek(anchor);
  const currentWeekEnd = addDays(currentWeekStart, 6);
  const nextWeekStart = addDays(currentWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const activeOrganicItems = ganttItems
    .map((item) => ({ item, date: parseSheetDate(item.date) }))
    .filter((entry): entry is { item: PlanningGanttItem; date: Date } =>
      Boolean(entry.date) && isOrganicActiveItem(entry.item)
    );

  const currentWeekItems = activeOrganicItems.filter((entry) =>
    isInRange(entry.date, currentWeekStart, currentWeekEnd)
  );

  const currentWeekReels = currentWeekItems.filter((entry) =>
    isReel(entry.item)
  );

  const currentWeekPosts = currentWeekItems.filter((entry) =>
    isPost(entry.item)
  );

  const nextWeekItems = activeOrganicItems.filter((entry) =>
    isInRange(entry.date, nextWeekStart, nextWeekEnd)
  );

  const signals: PlanningHealthSignal[] = [];

  if (currentWeekReels.length < weeklyReelTarget) {
    const missingCount = weeklyReelTarget - currentWeekReels.length;
    signals.push({
      type: "current_week_missing_reel",
      severity: "critical",
      missingCount,
      message:
        missingCount === 1
          ? "השבוע חסר עוד ריל אחד בגאנט."
          : `השבוע חסרים עוד ${missingCount} רילסים בגאנט.`,
      recommendedAction: "בואי נשלים את השבוע",
    });
  }

  if (currentWeekPosts.length < weeklyPostTarget) {
    const missingCount = weeklyPostTarget - currentWeekPosts.length;
    signals.push({
      type: "current_week_missing_post",
      severity: "critical",
      missingCount,
      message:
        missingCount === 1
          ? "השבוע חסר עוד פוסט אחד בגאנט."
          : `השבוע חסרים עוד ${missingCount} פוסטים בגאנט.`,
      recommendedAction: "בואי נשלים פוסט לשבוע",
    });
  }

  if (nextWeekItems.length < nextWeekMinimumOrganicItems) {
    signals.push({
      type: "next_week_empty_or_light",
      severity: "normal",
      missingCount: nextWeekMinimumOrganicItems - nextWeekItems.length,
      message: "הגאנט של שבוע הבא עדיין דל.",
      recommendedAction: "בואי נשלים את השבוע הבא",
    });
  }

  return signals;
};
