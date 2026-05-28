import dotenv from "dotenv";
dotenv.config();
import { getAllProductionTasksWithPriority } from "../services/sheets.service";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
getAllProductionTasksWithPriority(spreadsheetId).then((tasks) => {
  console.log('סה"כ משימות:', tasks.length);
  const high = tasks.filter(t => t.priority === "גבוה" && !t.isTrend);
  const trends = tasks.filter(t => t.isTrend);
  console.log('עדיפות גבוה (לא טרנד):', high.length);
  console.log('טרנדים:', trends.length);
  if (tasks[0]) console.log('דוגמה:', tasks[0]);
}).catch(console.error);
