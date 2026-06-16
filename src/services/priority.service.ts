/**
 * priority.service.ts
 * מנוע תעדוף משותף ל-Daily Brief, Afternoon Reminder ו-"מה דחוף"
 * לא מחובר עדיין לאף flow — שלב א בלבד.
 */

export const getBriefDisplayTitle = (name: string): string => {
  if (!name) return "";

  const cleaned = name
    .trim()
    .replace(/^["״׳']+|["״׳']+$/g, "")
    .trim();

  if (cleaned.length <= 55) {
    return cleaned.replace(/[-–—,.:״"׳']+$/, "").trim();
  }

  const cut = cleaned.substring(0, 55);
  const lastSpace = cut.lastIndexOf(" ");
  const result = lastSpace > 0
    ? cut.substring(0, lastSpace)
    : cut;

  return result
    .replace(/[-–—,.:״"׳']+$/, "")
    .trim() + "…";
};

export type MissingStep = "filmed" | "edited" | "cover" | "published";
export type PriorityLevel = "P0" | "P1" | "P2" | "P3" | "P4" | "PLANNING";
export type RiskType =
  | "publishing"
  | "overdue-decision"
  | "production-deadline"
  | "production-early-warning"
  | "planning";
export type RecommendedAction =
  | "verify-upload"
  | "resolve-overdue"
  | "film"
  | "edit"
  | "cover"
  | "schedule"
  | "none";

export type ContentPriorityItem = {
  contentId: string;
  displayTitle: string;
  ganttDate: string | null;
  daysUntilUpload: number | null;

  productionDeadline?: string | null;
  readyAt?: string | null;
  updatedAt?: string | null;

  filmed: string;
  edited: string;
  coverReady: string;
  ganttStatus: string;

  isReadyToUpload: boolean;
  isPublished: boolean;
  isOverdueAwaitingDecision: boolean;
  missingSteps: MissingStep[];

  priorityLevel: PriorityLevel;
  riskType: RiskType;
  recommendedAction: RecommendedAction;

  reason: string;
  cta: string;
};

export type GanttItemInput = { contentId: string; name: string; date: string; status: string; uploadTime?: string; };
export type ProductionTaskInput = {
  contentId: string;
  taskName: string;
  filmed: string;
  edited: string;
  coverReady: string;
  deadline?: string;
  readyAt?: string;
  updatedAt?: string;
};

const getTodayIsraelStr = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

const parseDateIsrael = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10), month = parseInt(parts[1], 10) - 1, year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) return new Date(year, month, day);
  }
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  return null;
};

const calcDaysUntilUpload = (dateStr: string | null): number | null => {
  if (!dateStr) return null;
  const parsed = parseDateIsrael(dateStr);
  if (!parsed) return null;
  const todayStr = getTodayIsraelStr();
  const tp = todayStr.split("-");
  const todayLocal = new Date(parseInt(tp[0]), parseInt(tp[1]) - 1, parseInt(tp[2]));
  return Math.round((parsed.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
};

const computePriorityLevel = (days: number | null, ready: boolean, published: boolean, hasGantt: boolean): PriorityLevel => {
  if (!hasGantt) return "PLANNING";
  if (published) return "P0";
  if (days === null) return "PLANNING";
  if (days <= 0) return "P0";
  if (days === 1) return "P1";
  if (days === 2) return "P2";
  if (days === 3) return "P3";
  return "P4";
};

const computeRiskType = (level: PriorityLevel, days: number | null, ready: boolean): RiskType => {
  if (level === "PLANNING") return "planning";
  if (days !== null && days < 0) return "overdue-decision";
  if (ready && days !== null && days <= 0) return "publishing";
  if (days !== null && days <= 3) return "production-deadline";
  return "production-early-warning";
};

const computeRecommendedAction = (
  published: boolean,
  ready: boolean,
  days: number | null,
  filmed: string,
  edited: string,
  hasGantt: boolean
): RecommendedAction => {
  if (published) return "none";
  if (!hasGantt) return "schedule";
  if (days !== null && days < 0) return "resolve-overdue";
  if (filmed !== "כן") return "film";
  if (edited !== "כן") return "edit";

  if (ready && days !== null && days <= 0) {
    return "verify-upload";
  }

  return "none";
};

const buildReason = (
  level: PriorityLevel,
  days: number | null,
  ready: boolean,
  filmed: string,
  edited: string,
  hasGantt: boolean,
  title: string
): string => {
  if (!hasGantt) {
    return `"${title}" כבר בהפקה אבל עדיין אין לו תאריך עלייה.`;
  }

  if (days !== null && days < 0) {
    const timing = days === -1
      ? "אתמול"
      : `לפני ${Math.abs(days)} ימים`;
    return `"${title}" היה אמור לעלות ${timing} ולא סומן כפורסם.`;
  }

  if (level === "P0") {
    if (ready) return `"${title}" מתוכנן לעלות היום וכבר מוכן.`;
    if (filmed !== "כן") {
      return `"${title}" מתוכנן לעלות היום ועדיין לא צולם.`;
    }
    return `"${title}" מתוכנן לעלות היום ועדיין חסרה עריכה.`;
  }

  if (level === "P1") {
    if (ready) return `"${title}" עולה מחר וכבר מוכן.`;
    if (filmed !== "כן") {
      return `"${title}" עולה מחר ועדיין לא צולם.`;
    }
    return `"${title}" עולה מחר וכבר צולם - כדאי לסגור עריכה היום.`;
  }

  if (level === "P2") {
    if (ready) return `"${title}" עולה בעוד יומיים וכבר מוכן.`;
    if (filmed !== "כן") {
      return `"${title}" עולה בעוד יומיים ועדיין לא צולם.`;
    }
    return `"${title}" עולה בעוד יומיים - כדאי לסגור עריכה.`;
  }

  if (level === "P3") {
    if (ready) return `"${title}" עולה בעוד 3 ימים וכבר מוכן.`;
    if (filmed !== "כן") {
      return `"${title}" עולה בעוד 3 ימים ועדיין לא צולם.`;
    }
    return `"${title}" עולה בעוד 3 ימים וחסרה עריכה.`;
  }

  if (ready) {
    return `"${title}" מתוכנן לעלות בעוד כמה ימים וכבר מוכן.`;
  }

  if (filmed !== "כן") {
    return `"${title}" עולה בעוד כמה ימים ועדיין לא צולם - שווה להתחיל להניע.`;
  }

  return `"${title}" עולה בעוד כמה ימים. הצילום מאחורייך, כדאי לסגור עריכה.`;
};

const buildCta = (action: RecommendedAction, title: string): string => {
  switch (action) {
    case "verify-upload": return `העליתי את "${title}"`;
    case "resolve-overdue": return "עלה / לדחות ל-[תאריך] / לארכיון";
    case "film": return `צילמתי את "${title}"`;
    case "edit": return `ערכתי את "${title}"`;
    case "cover": return `קאבר ל-"${title}" מוכן`;
    case "schedule": return `שבצי את "${title}" לגאנט`;
    case "none": return "";
  }
};
const isUsableContentId = (contentId: string): boolean => {
  const normalized = (contentId || "").trim();

  return normalized !== "" && normalized !== "טרם תוכנן";
};

const TERMINAL_GANTT_STATUSES = new Set(["פורסם", "בוטל", "ארכיון"]);

export const computePriorityItems = (ganttItems: GanttItemInput[], productionTasks: ProductionTaskInput[]): ContentPriorityItem[] => {
  const taskById = new Map(productionTasks.map((t) => [t.contentId, t]));
  const ganttContentIds = new Set(
  ganttItems
    .map((g) => g.contentId)
    .filter(isUsableContentId)
);
  const results: ContentPriorityItem[] = [];

  for (const g of ganttItems) {
  if (!isUsableContentId(g.contentId)) continue;
  if (TERMINAL_GANTT_STATUSES.has(g.status)) continue;
    const task = taskById.get(g.contentId);
    const displayTitle = getBriefDisplayTitle(g.name);
    const days = calcDaysUntilUpload(g.date);
    const filmed = task?.filmed || "לא";
    const edited = task?.edited || "לא";
    const coverReady = task?.coverReady || "לא";
    const ganttStatus = g.status || "";
    const isPublished = ganttStatus === "פורסם";
    const isOverdueAwaitingDecision = days !== null && days < 0 && !isPublished;
    const ganttLooksReady = ["מוכן", "בזמן אמת"].includes(ganttStatus);
    const ef = filmed === "כן" || ganttLooksReady ? "כן" : filmed;
    const ee = edited === "כן" || ganttLooksReady ? "כן" : edited;
    const ready = ef === "כן" && ee === "כן";
    const missingSteps: MissingStep[] = [];
    if (ef !== "כן") missingSteps.push("filmed");
    if (ee !== "כן") missingSteps.push("edited");
    if (coverReady !== "כן") missingSteps.push("cover");
    if (!isPublished) missingSteps.push("published");
    const level = computePriorityLevel(days, ready, isPublished, true);
    const riskType = computeRiskType(level, days, ready);
    const recommendedAction = computeRecommendedAction(isPublished, ready, days, ef, ee, true);
    results.push({
  contentId: g.contentId,
  displayTitle,
  ganttDate: g.date,
  daysUntilUpload: days,
  productionDeadline: task?.deadline || null,
  readyAt: task?.readyAt || null,
  updatedAt: task?.updatedAt || null,
  filmed: ef,
  edited: ee,
  coverReady,
  ganttStatus,
  isReadyToUpload: ready,
  isPublished,
  isOverdueAwaitingDecision,
  missingSteps,
  priorityLevel: level,
  riskType,
  recommendedAction,
  reason: buildReason(
    level,
    days,
    ready,
    ef,
    ee,
    true,
    displayTitle
  ),
    cta: buildCta(recommendedAction, displayTitle),
});
}

for (const task of productionTasks) {
    if (ganttContentIds.has(task.contentId)) continue;
    const displayTitle = getBriefDisplayTitle(task.taskName);
    const filmed = task.filmed || "לא";
    const edited = task.edited || "לא";
    const coverReady = task.coverReady || "לא";
    const ready = filmed === "כן" && edited === "כן";
    const missingSteps: MissingStep[] = [];
    if (filmed !== "כן") missingSteps.push("filmed");
    if (edited !== "כן") missingSteps.push("edited");
    if (coverReady !== "כן") missingSteps.push("cover");
    missingSteps.push("published");
    results.push({
  contentId: task.contentId,
  displayTitle,
  ganttDate: null,
  daysUntilUpload: null,
  productionDeadline: task.deadline || null,
  readyAt: task.readyAt || null,
  updatedAt: task.updatedAt || null,
  filmed,
  edited,
  coverReady,
  ganttStatus: "",
  isReadyToUpload: ready,
  isPublished: false,
  isOverdueAwaitingDecision: false,
  missingSteps,
  priorityLevel: "PLANNING",
  riskType: "planning",
  recommendedAction: "schedule",
  reason: buildReason(
    "PLANNING",
    null,
    ready,
    filmed,
    edited,
    false,
    displayTitle
  ),
    cta: buildCta("schedule", displayTitle),
  });
}

const order: Record<PriorityLevel, number> = { P0: 0, P1: 2, P2: 3, P3: 4, P4: 5, PLANNING: 6 };
const getQueueRank = (item: ContentPriorityItem): number => {
  if (item.priorityLevel === "P0" && !item.isOverdueAwaitingDecision) return 0;
  if (item.isOverdueAwaitingDecision) return 1;
  return order[item.priorityLevel];
};

  results.sort((a, b) => {
  const priorityDiff =
    getQueueRank(a) - getQueueRank(b);

  if (priorityDiff !== 0) return priorityDiff;

  if (a.isOverdueAwaitingDecision && b.isOverdueAwaitingDecision) {
    return (b.daysUntilUpload || 0) - (a.daysUntilUpload || 0);
  }

  if (
    a.daysUntilUpload !== null &&
    b.daysUntilUpload !== null
  ) {
    const daysDiff = a.daysUntilUpload - b.daysUntilUpload;
    if (daysDiff !== 0) return daysDiff;
  }

  if (
    a.priorityLevel === "PLANNING" &&
    b.priorityLevel === "PLANNING"
  ) {
    if (a.isReadyToUpload !== b.isReadyToUpload) {
      return a.isReadyToUpload ? -1 : 1;
    }

    if (a.isReadyToUpload && b.isReadyToUpload) {
      const readyTimeA = a.readyAt
        ? Date.parse(a.readyAt)
        : Number.POSITIVE_INFINITY;

      const readyTimeB = b.readyAt
        ? Date.parse(b.readyAt)
        : Number.POSITIVE_INFINITY;

      if (readyTimeA !== readyTimeB) {
        return readyTimeA - readyTimeB;
      }
    }
  }

    return 0;
});

  return results;
};