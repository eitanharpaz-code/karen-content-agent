import dotenv from "dotenv";
dotenv.config();

import {
  getAllProductionTasksWithPriority,
  getGanttByDateRange,
} from "../services/sheets.service";

import {
  formatWhatsImportantResponse,
  formatPriorityFilterResponse,
} from "../services/visibility.service";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

const normalizeYesNo = (value: unknown, fallback: "כן" | "לא"): "כן" | "לא" => {
  if (value === "כן" || value === "לא") return value;
  return fallback;
};

const isReadyByGanttStatus = (status: string): boolean => {
  return ["מוכן", "פורסם", "בזמן אמת"].includes(status);
};

const run = async () => {
  console.log("\n===== Whats Important Live QA =====");
  console.log("בודק את הדאטה האמיתי: גאנט 10 ימים קדימה + משימות הפקה");
  console.log("הטסט הזה לא כותב לגיליון.\n");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 10);
  tenDaysFromNow.setHours(23, 59, 59, 999);

  const [allTasks, ganttUpcoming] = await Promise.all([
    getAllProductionTasksWithPriority(spreadsheetId),
    getGanttByDateRange(spreadsheetId, today, tenDaysFromNow),
  ]);

  console.log(`משימות הפקה: ${allTasks.length}`);
  console.log(`פריטים בגאנט ב-10 הימים הקרובים: ${ganttUpcoming.length}`);

  const productionById = new Map(
    allTasks.map((task: any) => [String(task.contentId || "").trim(), task])
  );

  const missingProductionRows: string[] = [];
  const duplicatedGanttIds: string[] = [];
  const seenGanttIds = new Set<string>();

  const thisWeek = ganttUpcoming
    .filter((item: any) => item.status !== "פורסם")
    .map((item: any) => {
      const contentId = String(item.contentId || "").trim();
      const productionTask: any = productionById.get(contentId);
      const ganttStatus = String(item.status || "").trim();

      if (contentId && seenGanttIds.has(contentId)) {
        duplicatedGanttIds.push(contentId);
      }

      if (contentId) {
        seenGanttIds.add(contentId);
      }

      if (!productionTask) {
        missingProductionRows.push(`${contentId || "ללא ID"} - ${item.name || "ללא שם"}`);
      }

      const fallbackProductionStatus = isReadyByGanttStatus(ganttStatus) ? "כן" : "לא";

      return {
        contentId,
        taskName: item.name || item.contentId || "ללא שם",
        needsText: productionTask?.needsText || "לא",
        filmed: normalizeYesNo(productionTask?.filmed, fallbackProductionStatus),
        edited: normalizeYesNo(productionTask?.edited, fallbackProductionStatus),
        coverReady: normalizeYesNo(productionTask?.coverReady, fallbackProductionStatus),
        copyReady: normalizeYesNo(productionTask?.copyReady, "כן"),
        uploaded: ganttStatus === "פורסם" ? "כן" : "לא",
        deadline: item.date || "",
        uploadTime: item.uploadTime || "",
        notes: item.notes || productionTask?.notes || "",
        priority: item.priority || productionTask?.priority || "בינוני",
        category: productionTask?.category || "",
        isTrend: contentId.startsWith("TRD-") || productionTask?.isTrend || false,
        deadlineDate: null,
        deadlineDayName: item.day || "",
      };
    });

  console.log("\n===== בדיקות דאטה =====");

  if (duplicatedGanttIds.length > 0) {
    console.log("יש כפילויות content_id בגאנט הקרוב:");
    duplicatedGanttIds.forEach((id) => console.log(`- ${id}`));
  } else {
    console.log("אין כפילויות content_id בגאנט הקרוב.");
  }

  if (missingProductionRows.length > 0) {
    console.log("\nפריטים בגאנט הקרוב שאין להם שורה במשימות הפקה:");
    missingProductionRows.forEach((item) => console.log(`- ${item}`));
    console.log("זה לא תמיד באג. אם הסטטוס בגאנט הוא מוכן/פורסם/בזמן אמת, הטסט לא יניח שחסר צילום.");
  } else {
    console.log("לכל פריט בגאנט הקרוב יש התאמה במשימות הפקה.");
  }

  console.log("\n===== פריטי 10 הימים הקרובים אחרי חיבור גאנט + הפקה =====");

  if (thisWeek.length === 0) {
    console.log("אין פריטים קרובים שלא פורסמו.");
  }

  thisWeek.forEach((item) => {
    console.log(
      [
        `${item.contentId} - ${item.taskName}`,
        `יום: ${item.deadlineDayName || "לא צוין"}`,
        `שעה: ${item.uploadTime || "לא צוינה"}`,
        `צולם: ${item.filmed}`,
        `נערך: ${item.edited}`,
        `קאבר: ${item.coverReady}`,
        `קופי: ${item.copyReady}`,
        `פורסם: ${item.uploaded}`,
      ].join(" | ")
    );
  });

  const highNotUploaded = allTasks.filter(
    (t: any) => t.priority === "גבוה" && t.uploaded !== "כן" && !t.isTrend
  );

  const stuck = allTasks.filter(
    (t: any) => t.filmed === "כן" && t.edited !== "כן" && !t.isTrend
  );

  const trends = allTasks.filter(
    (t: any) => t.isTrend && t.uploaded !== "כן"
  );

  const notFilmedThisWeek = thisWeek
    .filter((item) => item.filmed !== "כן")
    .map((item) => ({
      taskName: item.taskName,
      deadlineDayName: item.deadlineDayName,
    }));

  console.log("\n===== תשובת הסוכנת: מה הכי חשוב עכשיו? =====");
  console.log(
    formatWhatsImportantResponse(
      highNotUploaded as any,
      stuck as any,
      trends as any,
      thisWeek as any,
      notFilmedThisWeek
    )
  );

  console.log("\n===== תשובת הסוכנת: עדיפות גבוהה =====");
  console.log(formatPriorityFilterResponse(allTasks as any, "גבוה"));

  console.log("\n===== תשובת הסוכנת: עדיפות נמוכה =====");
  console.log(formatPriorityFilterResponse(allTasks as any, "נמוך"));

  console.log("\n===== סוף בדיקה =====");
};

run().catch((error) => {
  console.error("הטסט נכשל:");
  console.error(error);
  process.exit(1);
});