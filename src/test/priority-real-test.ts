import dotenv from "dotenv";
dotenv.config();
import { getAllProductionTasksWithPriority, getGanttByDateRange } from "../services/sheets.service";
import { computePriorityItems } from "../services/priority.service";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

const main = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 10);
  tenDaysFromNow.setHours(23, 59, 59, 999);

  const [allTasks, ganttItems] = await Promise.all([
    getAllProductionTasksWithPriority(spreadsheetId),
    getGanttByDateRange(spreadsheetId, today, tenDaysFromNow),
  ]);

  console.log(`\nנטענו ${allTasks.length} משימות הפקה, ${ganttItems.length} פריטי גאנט (10 ימים קדימה)\n`);

  const items = computePriorityItems(
    ganttItems.map((g) => ({
      contentId: g.contentId,
      name: g.name,
      date: g.date,
      status: g.status,
      uploadTime: g.uploadTime,
    })),
    allTasks.map((t) => ({
      contentId: t.contentId,
      taskName: t.taskName,
      filmed: t.filmed,
      edited: t.edited,
      coverReady: t.coverReady,
      deadline: t.deadline,
    }))
  );

  console.log(`סה"כ פריטים שחזרו: ${items.length}`);
  console.log(`\n===== TOP 10 לפי Priority =====\n`);

  items.slice(0, 10).forEach((item, i) => {
    console.log(`[${i + 1}] ${item.displayTitle}`);
    console.log(`    contentId:         ${item.contentId}`);
    console.log(`    ganttDate:         ${item.ganttDate ?? "אין"}`);
    console.log(`    daysUntilUpload:   ${item.daysUntilUpload ?? "אין גאנט"}`);
    console.log(`    priorityLevel:     ${item.priorityLevel}`);
    console.log(`    riskType:          ${item.riskType}`);
    console.log(`    recommendedAction: ${item.recommendedAction}`);
    console.log(`    missingSteps:      ${item.missingSteps.join(", ")}`);
    console.log(`    isReadyToUpload:   ${item.isReadyToUpload}`);
    console.log(`    isPublished:       ${item.isPublished}`);
    console.log(`    reason:            ${item.reason}`);
    console.log(`    cta:               ${item.cta}`);
    console.log();
  });
};

main().catch(console.error);
