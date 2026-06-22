import { config } from "dotenv";
import {
  getApprovedContentNotInGantt,
  getAllProductionTasksWithPriority,
  getGanttByDateRange,
  getOpenContentIdeas,
} from "../services/sheets.service";
import { computePlanningHealthSignals } from "../services/planning-health.service";
import { buildCurrentWeekPlanningSourceRoutingState } from "../services/planning-source-routing-data.service";

config();

const requireLiveQaOptIn = () => {
  if (process.env.ALLOW_LIVE_QA !== "true") {
    console.error(
      [
        "❌ This is a Live QA/audit script.",
        "It reads from or may write to the real Google Sheet.",
        "",
        "Run explicitly with:",
        `ALLOW_LIVE_QA=true npx ts-node ${__filename.replace(process.cwd() + "/", "")}`,
      ].join("\\n")
    );
    process.exit(1);
  }
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

const print = (title: string, rows: unknown): void => {
  console.log(`\n=== ${title} ===`);
  console.dir(rows, { depth: null });
};

const main = async (): Promise<void> => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID");

  const anchor = new Date();
  const currentWeekStart = startOfWeek(anchor);
  const currentWeekEnd = addDays(currentWeekStart, 6);
  const nextWeekEnd = addDays(currentWeekStart, 13);

  print("AUDIT DATES", {
    anchor: anchor.toISOString(),
    currentWeekStart: currentWeekStart.toISOString(),
    currentWeekEnd: currentWeekEnd.toISOString(),
    nextWeekEnd: nextWeekEnd.toISOString(),
  });

  const currentWeekGantt = await getGanttByDateRange(
    spreadsheetId,
    currentWeekStart,
    currentWeekEnd
  );

  print(
    "CURRENT WEEK GANTT ROWS",
    currentWeekGantt.map((item: any) => ({
      contentId: item.contentId,
      date: item.date,
      contentType: item.contentType,
      collaboration: item.collaboration,
      status: item.status,
      name: item.name,
    }))
  );

  const routingGanttWindow = await getGanttByDateRange(
    spreadsheetId,
    currentWeekStart,
    nextWeekEnd
  );

  const planningSignals = computePlanningHealthSignals(routingGanttWindow, {
    anchorDate: anchor,
  });

  print("PLANNING HEALTH SIGNALS", planningSignals);

  const fullGantt = await getGanttByDateRange(
    spreadsheetId,
    new Date(2020, 0, 1),
    new Date(2035, 11, 31)
  );

  print(
    "ALL GANTT CONTENT IDS",
    fullGantt.map((item: any) => ({
      contentId: item.contentId,
      date: item.date,
      contentType: item.contentType,
      collaboration: item.collaboration,
      status: item.status,
      name: item.name,
    }))
  );

  const approvedNotInGantt = await getApprovedContentNotInGantt(
    spreadsheetId,
    currentWeekStart.getMonth() + 1,
    currentWeekStart.getFullYear()
  );

  print("APPROVED NOT IN GANTT", approvedNotInGantt);

  const production = await getAllProductionTasksWithPriority(spreadsheetId);

  print(
    "PRODUCTION TASKS",
    production.map((task) => ({
      contentId: task.contentId,
      taskName: task.taskName,
      contentType: task.contentType,
      priority: task.priority,
      category: task.category,
      filmed: task.filmed,
      edited: task.edited,
      coverReady: task.coverReady,
      deadline: task.deadline,
      readyAt: task.readyAt,
      updatedAt: task.updatedAt,
      inAnyGantt: fullGantt.some((item: any) => item.contentId === task.contentId),
      ganttStatus: fullGantt.find((item: any) => item.contentId === task.contentId)?.status || "",
      ganttDate: fullGantt.find((item: any) => item.contentId === task.contentId)?.date || "",
    }))
  );

  const ideas = await getOpenContentIdeas(spreadsheetId);

  print(
    "OPEN IDEAS",
    ideas.map((idea) => ({
      contentId: idea.contentId,
      idea: idea.idea,
      contentType: idea.contentType,
      status: idea.status,
      priority: idea.priority,
      category: idea.category,
    }))
  );

  const routingState = await buildCurrentWeekPlanningSourceRoutingState(spreadsheetId);

  print("ROUTING STATE", routingState);
};

requireLiveQaOptIn();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});