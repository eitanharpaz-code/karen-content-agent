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

import {
  createProductionTask,
  findRowIndexByContentId,
  getAllProductionTasks,
  updateDeadline,
  updateProductionStatus,
} from "../services/sheets.service";

const CONTENT_ID = "test_name_2";
const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getTestTask = async (spreadsheetId: string) => {
  const tasks = await getAllProductionTasks(spreadsheetId);
  const task = tasks.find((item) => item.contentId === CONTENT_ID);

  if (!task) {
    throw new Error(`Could not find ${CONTENT_ID}`);
  }

  return task;
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const run = async (): Promise<void> => {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_ID");
  }

  const existingRow = await findRowIndexByContentId(
    spreadsheetId,
    CONTENT_ID
  );

  if (existingRow) {
    throw new Error(
      `${CONTENT_ID} already exists at row ${existingRow}. Delete it before rerunning.`
    );
  }

  console.log(`Creating ${CONTENT_ID}...`);

  await createProductionTask(
    spreadsheetId,
    CONTENT_ID,
    CONTENT_ID
  );

  const rowIndex = await findRowIndexByContentId(
    spreadsheetId,
    CONTENT_ID
  );

  if (!rowIndex) {
    throw new Error("Test row was not created");
  }

  const created = await getTestTask(spreadsheetId);

  assert(created.readyAt === "", "ready_at starts empty");
  assert(Boolean(created.updatedAt), "updated_at is set on creation");

  await wait(25);
  await updateProductionStatus(spreadsheetId, rowIndex, 3);

  const filmed = await getTestTask(spreadsheetId);

  assert(filmed.filmed === "כן", "filmed status was updated");
  assert(filmed.readyAt === "", "filming does not set ready_at");
  assert(
    filmed.updatedAt !== created.updatedAt,
    "filming changes updated_at"
  );

  await wait(25);
  await updateProductionStatus(spreadsheetId, rowIndex, 4);

  const edited = await getTestTask(spreadsheetId);

  assert(edited.edited === "כן", "edited status was updated");
  assert(Boolean(edited.readyAt), "editing sets ready_at");
  assert(
    edited.updatedAt !== filmed.updatedAt,
    "editing changes updated_at"
  );

  const originalReadyAt = edited.readyAt;

  await wait(25);
  await updateProductionStatus(spreadsheetId, rowIndex, 5);

  const covered = await getTestTask(spreadsheetId);

  assert(covered.coverReady === "כן", "cover status was updated");
  assert(
    covered.readyAt === originalReadyAt,
    "cover does not overwrite ready_at"
  );
  assert(
    covered.updatedAt !== edited.updatedAt,
    "cover changes updated_at"
  );

  await wait(25);
  await updateDeadline(spreadsheetId, rowIndex, "20/06/2026");

  const deadlineUpdated = await getTestTask(spreadsheetId);

  assert(
    deadlineUpdated.deadline === "20/06/2026",
    "deadline was updated"
  );
  assert(
    deadlineUpdated.readyAt === originalReadyAt,
    "deadline does not overwrite ready_at"
  );
  assert(
    deadlineUpdated.updatedAt !== covered.updatedAt,
    "deadline changes updated_at"
  );

  console.log("\nProduction timestamp test passed.");
  console.log(
    `Delete the ${CONTENT_ID} row manually from משימות הפקה after inspection.`
  );
};

requireLiveQaOptIn();

run().catch((error) => {
  console.error(error);
  process.exit(1);
});