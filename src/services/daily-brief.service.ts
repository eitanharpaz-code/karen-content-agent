import { getValue, setValue } from "./persistence.service";
import {
  getAllProductionTasksWithPriority,
  getGanttByDateRange,
  findAvailableDatesInMonth,
  getOpenContentIdeas,
} from "./sheets.service";
import {
  computePriorityItems,
  getBriefDisplayTitle,
} from "./priority.service";
import type {
  ContentPriorityItem,
  GanttItemInput,
  ProductionTaskInput,
} from "./priority.service";
import { humanizeBrief } from "./brief-humanizer.service";
import {
  computePlanningHealthSignals,
  computeWeeklyProgress,
} from "./planning-health.service";
import type {
  PlanningHealthSignal,
  WeeklyProgress,
} from "./planning-health.service";

const getSpreadsheetId = (): string => {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("Missing required parameters: spreadsheetId");
  return id;
};

// ===== Interaction Tracking =====
// Stage G: moved from an in-memory Map to persistence.service so the
// "already interacted today" flag survives restarts.
export const markInteractionToday = (sender: string): void => {
  setValue("interactionLog", sender, getTodayDateString());
};

export const hasInteractedToday = (sender: string): boolean => {
  return getValue<string>("interactionLog", sender) === getTodayDateString();
};

const getTodayDateString = (): string => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
};

// ===== Data Fetching =====
export const getBriefGanttDateRange = (): {
  startDate: Date;
  endDate: Date;
} => ({
  startDate: new Date(2000, 0, 1),
  endDate: new Date(2100, 11, 31, 23, 59, 59, 999),
});

const fetchBriefData = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { startDate, endDate } = getBriefGanttDateRange();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

  const id = getSpreadsheetId();
  const [allTasks, ganttItems, availableDates] = await Promise.all([
    getAllProductionTasksWithPriority(id),
    getGanttByDateRange(id, startDate, endDate),
    findAvailableDatesInMonth(id, firstOfMonth),
  ]);

  const ganttInput: GanttItemInput[] = ganttItems.map((g) => ({
    contentId: g.contentId,
    name: g.name,
    date: g.date,
    status: g.status,
    uploadTime: g.uploadTime,
  }));

  const taskInput: ProductionTaskInput[] = allTasks.map((t) => ({
    contentId: t.contentId,
    taskName: t.taskName,
    filmed: t.filmed,
    edited: t.edited,
    coverReady: t.coverReady,
    deadline: t.deadline,
    readyAt: t.readyAt,
    updatedAt: t.updatedAt,
  }));

  const priorityItems = computePriorityItems(ganttInput, taskInput);
  const planningSignals = computePlanningHealthSignals(ganttItems, {
    anchorDate: today,
  });
  // Weekly progress (12.7.2026): what already went live this week, from the
  // same gantt dataset (range is all-time, so earlier-this-week rows exist).
  const weeklyProgress = computeWeeklyProgress(ganttItems, { anchorDate: today });

  const futureHoles = availableDates.filter((date) => {
    const parts = date.split("/");
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return d >= today;
  });

  return { priorityItems, futureHoles, planningSignals, weeklyProgress };
};

// ===== Morning Brief =====
export type MorningBriefData = {
  priorityItems: ContentPriorityItem[];
  futureHoles: string[];
  monthName: string;
  planningSignals?: PlanningHealthSignal[];
  weeklyProgress?: WeeklyProgress;
  savedIdeasCount?: number;
};

// Weekly progress (12.7.2026): one context line at the top of the morning
// brief. Motivation layer only — selection/prioritization logic untouched.
// Reel-focused on purpose: 2 reels/week is the north-star metric.
export const formatWeeklyStatusLine = (
  progress?: WeeklyProgress
): string | null => {
  if (!progress) return null;
  const { publishedReels, reelTarget } = progress;

  if (publishedReels === 0) {
    return `סטטוס שבועי: עוד לא עלה ריל השבוע (היעד: ${reelTarget}).`;
  }
  if (publishedReels < reelTarget) {
    const missing = reelTarget - publishedReels;
    const publishedPart = publishedReels === 1 ? "עלה ריל אחד" : `עלו ${publishedReels} רילסים`;
    const missingPart = missing === 1 ? "עוד אחד וסגרנו את היעד" : `עוד ${missing} ליעד`;
    return `סטטוס שבועי: ${publishedPart} מתוך ${reelTarget}, ${missingPart}.`;
  }
  return `סטטוס שבועי: יעד הרילסים הושג, ${publishedReels} כבר באוויר. מכאן הכל בונוס.`;
};

const isActionable = (item: ContentPriorityItem): boolean =>
  item.recommendedAction !== "none" && item.cta.trim() !== "";

const getMorningPlanningSignal = (
  planningSignals: PlanningHealthSignal[] = []
): PlanningHealthSignal | null =>
  planningSignals.find((signal) => signal.severity === "critical") || null;


const formatAction = (item: ContentPriorityItem): string => {
  switch (item.recommendedAction) {
    case "film":
      return `לצלם את "${item.displayTitle}"`;
    case "edit":
      return `לערוך את "${item.displayTitle}"`;
    case "schedule":
      return `לשבץ את "${item.displayTitle}" לגאנט`;
    case "verify-upload":
      return `לוודא ש-"${item.displayTitle}" עולה`;
    case "resolve-overdue":
      return "";
    case "cover":
      return `לסגור קאבר ל-"${item.displayTitle}"`;
    case "none":
      return "";
  }
};

const formatMorningPrimaryAction = (
  item: ContentPriorityItem,
  p0Count: number
): string => {
  if (item.priorityLevel !== "P0" || p0Count !== 1) {
    return formatAction(item);
  }

  switch (item.recommendedAction) {
    case "film":
      return "לצלם אותו";
    case "edit":
      return "לערוך אותו";
    case "verify-upload":
      return "לוודא שהוא עולה";
    default:
      return formatAction(item);
  }
};

export const selectMorningFocus = (
  priorityItems: ContentPriorityItem[]
): {
  primary: ContentPriorityItem | null;
  secondary: ContentPriorityItem | null;
} => {
  const actionableItems = priorityItems.filter(isActionable);

  return {
    primary: actionableItems[0] || null,
    secondary: actionableItems[1] || null,
  };
};

export const getOverdueDecisionItems = (
  priorityItems: ContentPriorityItem[]
): ContentPriorityItem[] =>
  priorityItems.filter((item) => item.isOverdueAwaitingDecision);

const formatOverdueTiming = (item: ContentPriorityItem): string =>
  item.daysUntilUpload === -1
    ? "אתמול"
    : `לפני ${Math.abs(item.daysUntilUpload || 0)} ימים`;

const appendOverdueDecision = (
  lines: string[],
  item: ContentPriorityItem,
  additionalCount: number
): void => {
  lines.push("", "*צריך לסגור*");
  lines.push(
    `"${item.displayTitle}" היה אמור לעלות ${formatOverdueTiming(item)} ולא סומן כפורסם.`
  );
  lines.push("");
  lines.push("כדי לסגור, אפשר לענות:");
  lines.push("* עלה");
  lines.push("* לדחות ל-[תאריך]");
  lines.push("* לארכיון");

  if (additionalCount > 0) {
    lines.push(
      "",
      additionalCount === 1
        ? "יש עוד תוכן אחד שמחכה להחלטה."
        : `יש עוד ${additionalCount} תכנים שמחכים להחלטה.`
    );
  }
};

export const buildMorningBriefFromData = ({
  priorityItems,
  futureHoles,
  monthName,
  planningSignals = [],
  weeklyProgress,
  savedIdeasCount = 0,
}: MorningBriefData): string | null => {
  const lines: string[] = ["בוקר טוב קרן :)", "בריף בוקר קצר, רק כדי לשים פוקוס על היום."];

  const weeklyStatusLine = formatWeeklyStatusLine(weeklyProgress);
  if (weeklyStatusLine) lines.push(weeklyStatusLine);

  const p0Items = priorityItems.filter(
    (i) => i.priorityLevel === "P0" && !i.isOverdueAwaitingDecision
  );
  const overdueItems = getOverdueDecisionItems(priorityItems);
    const morningPlanningSignal = getMorningPlanningSignal(planningSignals);
  const { primary, secondary } = selectMorningFocus(priorityItems);

  if (p0Items.length > 0) {
    lines.push("", "*דורש תשומת לב עכשיו*");

    p0Items.slice(0, 3).forEach((item) => {
      const status = item.isReadyToUpload ? "מוכן לעלייה" :
        item.filmed !== "כן" ? "חסר צילום" : "חסר עריכה";
      lines.push(`* ${item.displayTitle}, ${status}`);
    });

    if (p0Items.length > 3) {
      const remainingP0 = p0Items.length - 3;
      lines.push(
        remainingP0 === 1
          ? "* ועוד פריט אחד שדורש תשומת לב"
          : `* ועוד ${remainingP0} פריטים שדורשים תשומת לב`
      );
    }
  }

    if (!primary) {
      const backgroundLine = morningPlanningSignal
        ? `\nברקע: ${morningPlanningSignal.message}`
        : futureHoles.length > 0
          ? `\nברקע: ${futureHoles.length} חורים פנויים בגאנט החודש.`
          : "";
      const suggestedAction = morningPlanningSignal
        ? morningPlanningSignal.recommendedAction
        : "מה החורים בגאנט";

      // Nothing urgent and nothing approved waiting: instead of a generic
      // "here are commands you could type", point at what is actually sitting
      // there and offer to show it (23.7.2026). savedIdeasCount is passed in
      // by the caller, which also arms the follow-up question.
      const idleOffer = (savedIdeasCount || 0) > 0
        ? [
            "",
            savedIdeasCount === 1
              ? "יש לך רעיון אחד שמחכה לתאריך. רוצה לראות אותו ולבחור מתי להעלות?"
              : `יש לך ${savedIdeasCount} רעיונות שמחכים לתאריך. רוצה לראות אותם ולבחור אחד?`,
          ]
        : [
            "",
            "אם בא לך להתקדם, אפשר לכתוב:",
            `* ${suggestedAction}`,
            `* בואי נתכנן את ${monthName}`,
          ];

      return [
        "בוקר טוב קרן :)",
        "בריף בוקר קצר, רק כדי לשים פוקוס על היום.",
        ...(weeklyStatusLine ? [weeklyStatusLine] : []),
        "",
        "היום נראה יחסית רגוע.",
        "לא מצאתי משהו דחוף שצריך טיפול מיידי." + backgroundLine,
        ...idleOffer,
      ].join("\n");
    }

  const selectedOverdue =
    primary.isOverdueAwaitingDecision
      ? primary
      : secondary?.isOverdueAwaitingDecision
        ? secondary
        : null;
  const regularItems = [primary, secondary].filter(
    (item): item is ContentPriorityItem =>
      Boolean(item && !item.isOverdueAwaitingDecision)
  );

  if (regularItems[0]) {
    lines.push("", "*פוקוס להיום*");
    lines.push(`* ${formatMorningPrimaryAction(regularItems[0], p0Items.length)}`);
  }

  if (selectedOverdue) {
    appendOverdueDecision(
      lines,
      selectedOverdue,
      Math.max(0, overdueItems.length - 1)
    );
  }

  if (regularItems[1]) {
    lines.push("", "*אחר כך, אם יש לך זמן*");
    lines.push(`* ${formatAction(regularItems[1])}`);
  }

    const showingGanttHolesBackground =
      futureHoles.length > 0 && primary.priorityLevel === "PLANNING";

    if (showingGanttHolesBackground) {
      lines.push("", `ברקע: ${futureHoles.length} חורים פנויים בגאנט החודש.`);
    } else if (morningPlanningSignal) {
      lines.push("", "*ברקע*");
      lines.push(morningPlanningSignal.message);
      lines.push(`אפשר לכתוב: ${morningPlanningSignal.recommendedAction}`);
    }

  const replyItems = regularItems.filter((item) => item.cta.trim() !== "");
  if (replyItems.length > 0) {
    lines.push("", "*אפשר לענות*");
    replyItems.forEach((item) => lines.push(`* ${item.cta}`));
  }


  return lines.join("\n");
};

export const buildMorningBrief = async (): Promise<string | null> => {
  const { priorityItems, futureHoles, planningSignals, weeklyProgress } = await fetchBriefData();
  const monthName = new Date().toLocaleDateString("he-IL", { month: "long", timeZone: "Asia/Jerusalem" });

  // Count ideas waiting without a date, so an otherwise quiet brief can point
  // at something concrete instead of listing commands (23.7.2026).
  let savedIdeasCount = 0;
  try {
    const savedIdeas = await getOpenContentIdeas(process.env.GOOGLE_SHEETS_ID!);
    savedIdeasCount = savedIdeas.length;
  } catch (savedError) {
    console.error(`[Daily Brief] saved-ideas count skipped: ${savedError}`);
  }

  const deterministic = buildMorningBriefFromData({
    priorityItems,
    futureHoles,
    monthName,
    planningSignals,
    weeklyProgress,
    savedIdeasCount,
  });

  if (!deterministic) return null;

  // Phase B extension — Claude rewrites the phrasing in Karen's persona.
  // All facts, names, and CTAs stay intact (humanizer enforces this and
  // falls back to the deterministic string on any failure).
  return await humanizeBrief(deterministic, "morning");
};


export const fetchOverdueDecisionItems = async (): Promise<
  ContentPriorityItem[]
> => {
  const { priorityItems } = await fetchBriefData();
  return getOverdueDecisionItems(priorityItems);
};

export const fetchPriorityItems = async (): Promise<ContentPriorityItem[]> => {
  const { priorityItems } = await fetchBriefData();
  return priorityItems;
};

// ===== Afternoon Reminder =====
export type AfternoonReminderData = {
  priorityItems: ContentPriorityItem[];
  ganttIsLight: boolean;
  monthName: string;
  weeklyProgress?: WeeklyProgress;
};

export const selectAfternoonFocus = (
  priorityItems: ContentPriorityItem[],
  ganttIsLight: boolean
): ContentPriorityItem | null => {
  const activeP0Items = priorityItems.filter(
    (item) =>
      item.priorityLevel === "P0" &&
      !item.isOverdueAwaitingDecision &&
      isActionable(item)
  );
  const p0Ready = activeP0Items.find(
    (item) => item.recommendedAction === "verify-upload"
  );

  if (p0Ready) return p0Ready;
  if (activeP0Items.length > 0) return null;

  const firstDayOverdue = priorityItems.find(
    (item) =>
      item.isOverdueAwaitingDecision &&
      item.daysUntilUpload === -1
  );

  if (firstDayOverdue) return firstDayOverdue;

  const productionAction = priorityItems.find(
    (item) =>
      ["P1", "P2", "P3", "P4"].includes(item.priorityLevel) &&
      ["film", "edit"].includes(item.recommendedAction) &&
      isActionable(item)
  );

  if (productionAction) return productionAction;
  if (!ganttIsLight) return null;

  return priorityItems.find(
    (item) =>
      item.priorityLevel === "PLANNING" &&
      item.recommendedAction === "schedule" &&
      isActionable(item)
  ) || null;
};

export const shouldBypassInteractionForAfternoonReminder = (
  priorityItems: ContentPriorityItem[],
  ganttIsLight: boolean
): boolean => {
  const focus = selectAfternoonFocus(priorityItems, ganttIsLight);

  return Boolean(
    focus?.priorityLevel === "P0" &&
      !focus.isOverdueAwaitingDecision &&
      focus.recommendedAction === "verify-upload"
  );
};

export const buildAfternoonReminderFromData = ({
  priorityItems,
  ganttIsLight,
  monthName,
  weeklyProgress,
}: AfternoonReminderData): string | null => {
  const focus = selectAfternoonFocus(priorityItems, ganttIsLight);
  const lines: string[] = ["היי קרן, תזכורת קטנה :)", ""];

  // Weekly progress (12.7.2026): recognition only, and only once the weekly
  // reel target is met. Never changes which focus item is chosen, and never
  // creates a message on its own (if all branches fall through to null,
  // nothing is sent).
  if (weeklyProgress?.reelTargetMet) {
    lines.push("רק שתדעי, יעד הרילסים השבועי כבר הושג. מכאן הכל בונוס.", "");
  }

  if (
    focus?.priorityLevel === "P0" &&
    !focus.isOverdueAwaitingDecision &&
    focus.recommendedAction === "verify-upload"
  ) {
    lines.push("היום אמור לעלות:");
    lines.push(`"${focus.displayTitle}"`);
    lines.push("");
    lines.push("הוא כבר מוכן. נשאר רק לוודא שהוא עולה.");
    lines.push("");
    lines.push("אם כבר העלית, תכתבי לי:");
    lines.push(`* ${focus.cta}`);
    return lines.join("\n");
  }

  if (focus?.isOverdueAwaitingDecision) {
    lines.push(
      `נשאר רק לסגור מה קרה עם "${focus.displayTitle}".`
    );
    lines.push("");
    lines.push("אפשר לענות:");
    lines.push("* עלה");
    lines.push("* לדחות ל-[תאריך]");
    lines.push("* לארכיון");
    return lines.join("\n");
  }

  if (
    focus &&
    ["P1", "P2", "P3", "P4"].includes(focus.priorityLevel)
  ) {
    lines.push("הדבר שהכי יקדם אותך עכשיו:");
    lines.push(`* ${formatAction(focus)}`);
    lines.push("");
    lines.push("כשסיימת, אפשר לכתוב:");
    lines.push(`* ${focus.cta}`);
    return lines.join("\n");
  }

  if (ganttIsLight) {
    if (focus?.priorityLevel === "PLANNING") {
      lines.push("הגאנט קצת ריק לשבועיים הקרובים.");
      lines.push(`* ${formatAction(focus)}`);
      lines.push("");
      lines.push("כדי להתקדם, אפשר לכתוב:");
      lines.push(`* ${focus.cta}`);
    } else {
      lines.push("הגאנט קצת ריק לשבועיים הקרובים.");
      lines.push("כדי לסדר את השבועיים הקרובים, אפשר לכתוב:");
      lines.push(`* בואי נתכנן את ${monthName}`);
    }
    return lines.join("\n");
  }

  return null;
};

export type AfternoonReminderResult = {
  message: string | null;
  bypassInteraction: boolean;
};

export const buildAfternoonReminderResult = async (): Promise<AfternoonReminderResult> => {
  const { priorityItems, weeklyProgress } = await fetchBriefData();

  // בדוק גאנט 14 ימים קדימה לצורך סף "ריק"
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoWeeksFromNow = new Date(today);
  twoWeeksFromNow.setDate(today.getDate() + 14);
  const id = getSpreadsheetId();
  const twoWeekGantt = await getGanttByDateRange(id, today, twoWeeksFromNow);
  const ganttIsLight =
    twoWeekGantt.filter(
      (item) => !["פורסם", "בוטל", "ארכיון"].includes(item.status)
    ).length < 3;
  const monthName = new Date().toLocaleDateString("he-IL", { month: "long", timeZone: "Asia/Jerusalem" });

  const deterministic = buildAfternoonReminderFromData({
    priorityItems,
    ganttIsLight,
    monthName,
    weeklyProgress,
  });

  // Phase B extension — humanize the afternoon reminder in Karen's
  // persona. Falls back to deterministic on any failure.
  const humanized = deterministic
    ? await humanizeBrief(deterministic, "afternoon")
    : null;

  return {
    message: humanized,
    bypassInteraction: shouldBypassInteractionForAfternoonReminder(
      priorityItems,
      ganttIsLight
    ),
  };
};

export const buildAfternoonReminder = async (): Promise<string | null> => {
  const result = await buildAfternoonReminderResult();

  return result.message;
};
