import dotenv from "dotenv";
dotenv.config();
import { getAllProductionTasksWithPriority } from "../services/sheets.service";
import { formatWhatsImportantResponse, formatPriorityFilterResponse } from "../services/visibility.service";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

const run = async () => {
  const tasks = await getAllProductionTasksWithPriority(spreadsheetId);

  const highNotUploaded = tasks.filter(t => t.priority === "גבוה" && t.uploaded !== "כן" && !t.isTrend);
  const stuck = tasks.filter(t => t.filmed === "כן" && t.edited !== "כן" && !t.isTrend);
  const trends = tasks.filter(t => t.isTrend && t.uploaded !== "כן");
  const thisWeek = tasks.filter(t => t.deadlineDate !== null && t.uploaded !== "כן");

  console.log("\n===== מה הכי חשוב עכשיו? =====");
 console.log(formatWhatsImportantResponse(highNotUploaded, stuck, trends, thisWeek));
  console.log("\n===== עדיפות גבוה =====");
  console.log(formatPriorityFilterResponse(tasks, "גבוה"));

  console.log("\n===== עדיפות נמוך =====");
  console.log(formatPriorityFilterResponse(tasks, "נמוך"));
};

run().catch(console.error);
