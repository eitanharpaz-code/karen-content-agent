import "dotenv/config";

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

import { getAllProductionTasks } from "../services/sheets.service";

const run = async (): Promise<void> => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_ID");
  }

  const tasks = await getAllProductionTasks(spreadsheetId);

  const rowsToUpdate = tasks
    .map((task, index) => ({
      sheetRow: index + 2,
      contentId: task.contentId,
      taskName: task.taskName,
      edited: task.edited,
      currentReadyAt: task.readyAt,
      currentUpdatedAt: task.updatedAt,
      setReadyAt: task.edited === "כן" && !task.readyAt,
      setUpdatedAt: !task.updatedAt,
    }))
    .filter(
      (task) =>
        task.contentId &&
        !task.contentId.startsWith("test_name_") &&
        (task.setReadyAt || task.setUpdatedAt)
    );

  console.log(`נמצאו ${tasks.length} משימות הפקה.`);
  console.log(`ה-migration יעדכן ${rowsToUpdate.length} שורות.\n`);

  for (const task of rowsToUpdate) {
    console.log(
      [
        `שורה ${task.sheetRow}`,
        `contentId=${task.contentId}`,
        `שם=${task.taskName}`,
        `ready_at=${task.setReadyAt ? "ייכתב" : "יישמר"}`,
        `updated_at=${task.setUpdatedAt ? "ייכתב" : "יישמר"}`,
      ].join(" | ")
    );
  }

  console.log("\nPREVIEW ONLY - לא נכתב דבר לשיטס.");
};

requireLiveQaOptIn();

run().catch((error) => {
  console.error(error);
  process.exit(1);
});