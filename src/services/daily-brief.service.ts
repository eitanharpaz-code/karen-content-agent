import {
  getAllProductionTasksWithPriority,
  getGanttByDateRange,
  getApprovedContentNotInGantt,
  findAvailableDatesInMonth,
} from "./sheets.service";

const getSpreadsheetId = (): string => {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("Missing required parameters: spreadsheetId");
  return id;
};

// ===== Interaction Tracking =====
const interactionLog = new Map<string, string>();

export const markInteractionToday = (sender: string): void => {
  interactionLog.set(sender, getTodayDateString());
};

export const hasInteractedToday = (sender: string): boolean => {
  return interactionLog.get(sender) === getTodayDateString();
};

const getTodayDateString = (): string => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
};

// ===== Display Title Helper =====
export const getBriefDisplayTitle = (name: string): string => {
  if (!name) return "";

  // נקה ירכאות ופיסוק מהקצוות
  let cleaned = name.trim().replace(/^["״׳']+|["״׳']+$/g, "").trim();

  // אם יש מפריד -, קח את החלק הראשון אם הוא קצר (עד 5 מילים)
  const dashIndex = cleaned.indexOf(" - ");
  if (dashIndex !== -1) {
    const firstPart = cleaned.substring(0, dashIndex).trim();
    const firstPartWords = firstPart.split(/\s+/).length;
    if (firstPartWords <= 5) {
      return firstPart;
    }
    // אם החלק הראשון עדיין ארוך, קח 4 מילים ממנו
    return firstPart.split(/\s+/).slice(0, 4).join(" ");
  }

  // אם השם קצר (עד 6 מילים) — השתמש בו כמות שהוא
  const words = cleaned.split(/\s+/);
  if (words.length <= 6) {
    return cleaned.replace(/[-–—,.:]+$/, "").trim();
  }

  // fallback — 6 מילים ראשונות
  return words.slice(0, 6).join(" ").replace(/[-–—,.:]+$/, "").trim();
};

// ===== Data Fetching =====
type BriefItem = {
  contentId: string;
  name: string;
  displayTitle: string;
  filmed: string;
  edited: string;
  coverReady: string;
  deadline: string;
  ganttDate?: string;
  ganttStatus?: string;
};

const isReadyToUpload = (item: BriefItem): boolean => {
  return item.filmed === "כן" && item.edited === "כן";
};

const fetchBriefData = async () => {
  const now = new Date();
  const todayStr = getTodayDateString(); // YYYY-MM-DD

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 5);
  tenDaysFromNow.setHours(23, 59, 59, 999);

  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const firstOfMonth = `01/${String(month).padStart(2, "0")}/${year}`;

  const id = getSpreadsheetId();
  const [allTasks, upcomingGantt, unscheduled, availableDates] = await Promise.all([
    getAllProductionTasksWithPriority(id),
    getGanttByDateRange(id, today, tenDaysFromNow),
    getApprovedContentNotInGantt(id, month, year),
    findAvailableDatesInMonth(id, firstOfMonth),
  ]);

  const taskById = new Map(allTasks.map((t) => [t.contentId, t]));

  // בנה BriefItem לכל פריט גאנט
  const ganttItems: BriefItem[] = upcomingGantt
    .filter((item) => item.status !== "פורסם")
    .map((item) => {
      const task = taskById.get(item.contentId);
      return {
        contentId: item.contentId,
        name: item.name,
        displayTitle: getBriefDisplayTitle(item.name),
        filmed: task?.filmed || "לא",
        edited: task?.edited || "לא",
        coverReady: task?.coverReady || "לא",
        deadline: task?.deadline || "",
        ganttDate: item.date,
        ganttStatus: item.status,
      };
    });

  // הפרד בין היום לבקרוב
  const todayItems = ganttItems.filter((item) => {
    if (!item.ganttDate) return false;
    const parts = item.ganttDate.split("/");
    if (parts.length !== 3) return false;
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }) === todayStr;
  });

  const upcomingItems = ganttItems.filter((item) => !todayItems.includes(item));

  // תכנים בהפקה בלי גאנט
  const productionWithoutGantt: BriefItem[] = unscheduled
    .filter((c) => allTasks.some((t) => t.contentId === c.contentId))
    .map((c) => {
      const task = taskById.get(c.contentId);
      return {
        contentId: c.contentId,
        name: c.name,
        displayTitle: getBriefDisplayTitle(c.name),
        filmed: task?.filmed || "לא",
        edited: task?.edited || "לא",
        coverReady: task?.coverReady || "לא",
        deadline: task?.deadline || "",
      };
    });

  // חורים פנויים
  const futureHoles = availableDates.filter((date) => {
    const parts = date.split("/");
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    return d >= today;
  });

  return {
    todayItems,
    upcomingItems,
    productionWithoutGantt,
    futureHoles,
  };
};

// ===== Morning Brief =====
export const buildMorningBrief = async (): Promise<string | null> => {
  const { todayItems, upcomingItems, productionWithoutGantt, futureHoles } = await fetchBriefData();

  const lines: string[] = ["בוקר טוב קרן :)", "בריף בוקר קצר, רק כדי לשים פוקוס על היום."];

  // ===== מקרה 1: יש תוכן שעולה היום =====
  if (todayItems.length > 0) {
    const todayReady = todayItems.filter(isReadyToUpload);
    const todayNotReady = todayItems.filter((i) => !isReadyToUpload(i));

lines.push("", "*היום בגאנט*");
    todayItems.forEach((item) => {
      const status = isReadyToUpload(item)
        ? "מוכן לעלייה"
        : `חסר ${item.filmed !== "כן" ? "צילום" : "עריכה"}`;
      lines.push(`- ${item.displayTitle} — ${status}`);
    });

    lines.push("", "*הייתי מתחילה מ*");

    if (todayNotReady.length > 0) {
      const first = todayNotReady[0];
      const missing = first.filmed !== "כן" ? "לצלם" : "לערוך";
      lines.push(`- ${missing} את "${first.displayTitle}"`);
      lines.push("");
      lines.push(`כי הוא מתוכנן לעלות היום ועדיין חסר לו ${first.filmed !== "כן" ? "צילום" : "עריכה"}.`);

     lines.push("", "*כדי להתקדם עכשיו אפשר לענות*");
      lines.push(`- ${first.filmed !== "כן" ? "צילמתי" : "ערכתי"} את "${first.displayTitle}"`);
      lines.push(`- מה חסר ל"${first.displayTitle}"?`);
    } else if (todayReady.length > 0) {
      const first = todayReady[0];
      lines.push(`- לוודא שהסרטון "${first.displayTitle}" עולה היום בזמן`);
      lines.push("");
      lines.push("כי הוא כבר מוכן ומתוכנן לעלות היום.");

      lines.push("", "*כדי להתקדם עכשיו אפשר לענות*");
      lines.push(`- העליתי את "${first.displayTitle}"`);
      if (first.coverReady !== "כן") {
        lines.push(`- קאבר ל"${first.displayTitle}" מוכן`);
      }
    }

    // פעולה משנית — תוכן בקרוב שחסר לו שלב
    const upcomingNotReady = upcomingItems.filter((i) => !isReadyToUpload(i));
    if (upcomingNotReady.length > 0) {
      const second = upcomingNotReady[0];
     lines.push("", "*אחר כך, אם יש לך זמן*");
      lines.push(`- לצלם או לערוך את "${second.displayTitle}"`);
      lines.push("");
      lines.push("כי הוא עולה בקרוב ועדיין חסר לו צילום או עריכה.");
    }

    lines.push("", "*קיצורים נוספים*");
    lines.push("* מה דחוף");
    lines.push("* מה בלי גאנט");
    lines.push("* בואי נתכנן את החודש");

    return lines.join("\n");
  }

  // ===== מקרה 2: אין תוכן היום =====
  const upcomingNotReady = upcomingItems.filter((i) => !isReadyToUpload(i));
  const hasAnything = upcomingNotReady.length > 0 || productionWithoutGantt.length > 0;

  if (!hasAnything) {
    return [
      "בוקר טוב קרן :)",
      "",
      "היום נראה יחסית רגוע.",
      "לא מצאתי משהו דחוף שצריך טיפול מיידי.",
      "",
      "אם בא לך להתקדם בכל זאת, אפשר לכתוב:",
      "- מה החורים בגאנט",
      "- בואי נתכנן את החודש",
      "- תני לי רעיון לתוכן",
    ].join("\n");
  }

  lines.push("", "*מה שחשוב היום*", "");

  if (upcomingNotReady.length > 0) {
    lines.push(`- ${upcomingNotReady.length} ${upcomingNotReady.length === 1 ? "תוכן עולה" : "תכנים עולים"} בקרוב ועדיין חסר ${upcomingNotReady.length === 1 ? "לו" : "להם"} צילום או עריכה`);
  }
  if (productionWithoutGantt.length > 0) {
    lines.push(`- ${productionWithoutGantt.length} ${productionWithoutGantt.length === 1 ? "תוכן בהפקה עוד לא שובץ" : "תכנים בהפקה עוד לא שובצו"} לגאנט`);
  }
  if (futureHoles.length > 0) {
    lines.push(`- ${futureHoles.length} חורים פנויים בגאנט החודש`);
  }

  lines.push("", "*הייתי מתחילה מ*");

  let primaryItem: BriefItem | null = null;
  let primaryReason = "";
  let primaryAction = "";

  if (upcomingNotReady.length > 0) {
    primaryItem = upcomingNotReady[0];
    const missing = primaryItem.filmed !== "כן" ? "לצלם" : "לערוך";
    primaryAction = `- ${missing} או לסגור עריכה על "${primaryItem.displayTitle}"`;
    primaryReason = "כי הוא עולה בקרוב ועדיין חסר לו צילום או עריכה.";
  } else if (productionWithoutGantt.length > 0) {
    primaryItem = productionWithoutGantt[0];
    primaryAction = `- לשבץ את "${primaryItem.displayTitle}" לגאנט`;
    primaryReason = "כי הוא כבר בהפקה אבל עדיין אין לו תאריך עלייה.";
  }

  if (primaryItem) {
    lines.push(primaryAction);
    lines.push("");
    lines.push(primaryReason);

    lines.push("", "*כדי להתקדם עכשיו אפשר לענות*");

    if (upcomingNotReady.length > 0 && primaryItem) {
      lines.push(`- צילמתי את "${primaryItem.displayTitle}"`);
      lines.push(`- ערכתי את "${primaryItem.displayTitle}"`);
      lines.push(`- מה חסר ל"${primaryItem.displayTitle}"?`);
    } else if (productionWithoutGantt.length > 0 && primaryItem) {
      lines.push(`- שבצי את "${primaryItem.displayTitle}" לגאנט`);
      lines.push("- תראי לי מה עוד בלי גאנט");
      lines.push("- בואי נתכנן את החודש");
    }
  }

 lines.push("", "*קיצורים נוספים*");
  lines.push("- מה דחוף");
  lines.push("- מה בלי גאנט");
  lines.push("- בואי נתכנן את החודש");

  return lines.join("\n");
};

// ===== Afternoon Reminder =====
export const buildAfternoonReminder = async (): Promise<string | null> => {
  const { todayItems, upcomingItems, productionWithoutGantt } = await fetchBriefData();

  const upcomingNotReady = upcomingItems.filter((i) => !isReadyToUpload(i));

  // בדוק גאנט 14 ימים קדימה לצורך סף "ריק"
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoWeeksFromNow = new Date(today);
  twoWeeksFromNow.setDate(today.getDate() + 14);
  const id = getSpreadsheetId();
  const twoWeekGantt = await getGanttByDateRange(id, today, twoWeeksFromNow);
  const ganttIsLight = twoWeekGantt.filter((i) => i.status !== "פורסם").length < 3;

  const lines: string[] = ["היי קרן, תזכורת קטנה :)", ""];

  // עדיפות 1 — יש תוכן שאמור לעלות היום ומוכן
  const todayReady = todayItems.filter(isReadyToUpload);
  if (todayReady.length > 0) {
    const first = todayReady[0];
    lines.push("היום אמור לעלות:");
    lines.push(`"${first.displayTitle}"`);
    lines.push("");
    lines.push("הוא כבר מוכן לעלייה, אז הדבר היחיד שהייתי סוגרת היום הוא לוודא שהוא עולה.");
    lines.push("");
    lines.push("אם כבר העלית, תכתבי לי:");
    lines.push(`העליתי את "${first.displayTitle}"`);
    return lines.join("\n");
  }

  // עדיפות 2 — תוכן קרוב שחסר לו צילום או עריכה
  if (upcomingNotReady.length > 0) {
    const first = upcomingNotReady[0];
    const missing = first.filmed !== "כן" ? "צילום" : "עריכה";
    lines.push(`יש לך תוכן שעולה בקרוב ועדיין חסר לו ${missing}:`);
    lines.push(`"${first.displayTitle}"`);
    lines.push("");
    lines.push(`אם יש לך 20 דקות, זה הדבר שהכי יקדם אותך עכשיו.`);
    lines.push("");
    lines.push(`אפשר לעדכן אותי:`);
    lines.push(`${first.filmed !== "כן" ? "צילמתי" : "ערכתי"} את "${first.displayTitle}"`);
    return lines.join("\n");
  }

  // עדיפות 3 — גאנט ריק יחסית
  if (ganttIsLight) {
    if (productionWithoutGantt.length > 0) {
      const first = productionWithoutGantt[0];
      lines.push("הגאנט קצת ריק לשבועיים הקרובים.");
      lines.push(`יש לך תכנים מוכנים שעוד לא שובצו, למשל:`);
      lines.push(`"${first.displayTitle}"`);
      lines.push("");
      lines.push("אם בא לך לסדר את זה עכשיו, תכתבי:");
      lines.push(`שבצי את "${first.displayTitle}" לגאנט`);
    } else {
      lines.push("הגאנט קצת ריק לשבועיים הקרובים.");
      lines.push("אם בא לך להכניס תכנים חדשים להפקה, תכתבי:");
      lines.push("בואי נתכנן את החודש");
    }
    return lines.join("\n");
  }

  // אין כלום דחוף — לא שולחים
  return null;
};