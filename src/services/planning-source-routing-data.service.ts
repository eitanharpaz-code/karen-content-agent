import {
  getApprovedContentNotInGantt,
  getAllProductionTasksWithPriority,
  getGanttByDateRange,
  getOpenContentIdeas,
} from "./sheets.service";
import { computePlanningHealthSignals } from "./planning-health.service";
import {
  createPlanningSourceRoutingState,
  type PlanningContentType,
  type PlanningSourceOption,
  type PlanningSourceRoutingState,
} from "./planning-source-routing.service";

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

const matchesContentType = (value: string, contentType: PlanningContentType): boolean => {
  const normalized = (value || "").trim();

  if (contentType === "ריל") {
    return normalized.includes("ריל");
  }

  return normalized.includes("פוסט") || normalized.includes("קרוסלה");
};

const getProductionStatus = (task: {
  filmed: string;
  edited: string;
  coverReady: string;
}): string => {
  if (task.edited !== "כן" && task.filmed === "כן") return "חסרה עריכה";
  if (task.filmed !== "כן") return "חסר צילום";
  if (task.coverReady !== "כן") return "חסר קאבר";

  return "כמעט מוכן";
};

const isNearReadyProduction = (task: {
  filmed: string;
  edited: string;
  coverReady: string;
}): boolean =>
  task.filmed === "כן" || task.edited === "כן" || task.coverReady === "כן";

const isNotStartedProduction = (task: {
  filmed: string;
  edited: string;
  coverReady: string;
}): boolean =>
  task.filmed !== "כן" && task.edited !== "כן" && task.coverReady !== "כן";

export const buildCurrentWeekPlanningSourceRoutingState = async (
  spreadsheetId: string,
  anchorDate: Date = new Date()
): Promise<PlanningSourceRoutingState | null> => {
  const currentWeekStart = startOfWeek(anchorDate);
  const nextWeekEnd = addDays(currentWeekStart, 13);

    const ganttItems = await getGanttByDateRange(
    spreadsheetId,
    currentWeekStart,
    nextWeekEnd
  );

  const allGanttItems = await getGanttByDateRange(
    spreadsheetId,
    new Date(2020, 0, 1),
    new Date(2035, 11, 31)
  );

  const planningSignals = computePlanningHealthSignals(ganttItems, {
    anchorDate,
  });

  const signal = planningSignals.find(
    (candidate) =>
      candidate.type === "current_week_missing_reel" ||
      candidate.type === "current_week_missing_post"
  );

  if (!signal) {
    return null;
  }

  const missingContentType: PlanningContentType =
    signal.type === "current_week_missing_post" ? "פוסט" : "ריל";

  const [approvedUnscheduledRows, productionTasks, ideaRows] = await Promise.all([
    getApprovedContentNotInGantt(
      spreadsheetId,
      currentWeekStart.getMonth() + 1,
      currentWeekStart.getFullYear()
    ),
    getAllProductionTasksWithPriority(spreadsheetId),
    getOpenContentIdeas(spreadsheetId),
  ]);

  const approvedUnscheduled: PlanningSourceOption[] = approvedUnscheduledRows
    .filter((item) => matchesContentType(item.contentType, missingContentType))
    .map((item) => ({
      contentId: item.contentId,
      title: item.name,
    }));

  const scheduledContentIds = new Set(
    allGanttItems
      .map((item) => (item.contentId || "").toString().trim())
      .filter(Boolean)
  );

  const productionCandidates = productionTasks.filter(
    (task) =>
      task.contentId &&
      !scheduledContentIds.has(task.contentId) &&
      matchesContentType(task.contentType, missingContentType)
  );

  const nearReadyProduction: PlanningSourceOption[] = productionCandidates
    .filter(isNearReadyProduction)
    .map((task) => ({
      contentId: task.contentId,
      title: task.taskName,
      status: getProductionStatus(task),
    }));

  const approvedNotStarted: PlanningSourceOption[] = productionCandidates
    .filter(isNotStartedProduction)
    .map((task) => ({
      contentId: task.contentId,
      title: task.taskName,
    }));

  const ideaBank: PlanningSourceOption[] = ideaRows
    .filter((idea) => matchesContentType(idea.contentType, missingContentType))
    .map((idea) => ({
      contentId: idea.contentId,
      title: idea.idea,
    }));

  return createPlanningSourceRoutingState({
    signalMessage: signal.message,
    missingContentType,
    approvedUnscheduled,
    nearReadyProduction,
    approvedNotStarted,
    ideaBank,
  });
};