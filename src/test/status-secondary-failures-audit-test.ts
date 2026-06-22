declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log("Running status secondary failures audit test...");

const controllerSource = fs.readFileSync(
  path.join(process.cwd(), "src/controllers/whatsapp.controller.ts"),
  "utf8"
);

const sheetsSource = fs.readFileSync(
  path.join(process.cwd(), "src/services/sheets.service.ts"),
  "utf8"
);

assert(
  sheetsSource.includes("export const updateGanttStatus") &&
    sheetsSource.includes("): Promise<boolean> =>"),
  "updateGanttStatus must return Promise<boolean>."
);

assert(
  sheetsSource.includes("return false;") && sheetsSource.includes("return true;"),
  "updateGanttStatus must return false for missing row and true after update."
);

assert(
  controllerSource.includes("secondaryUpdateFailures"),
  "controller must track secondary update failures."
);

assert(
  controllerSource.includes("status_updated_with_secondary_failures"),
  "controller must return a partial-success status when secondary writes fail."
);

assert(
  controllerSource.includes("const approvedUpdated = await updateApprovedContentStatusById"),
  "controller must check updateApprovedContentStatusById boolean result."
);

assert(
  controllerSource.includes("const ganttUpdated = await updateGanttStatus"),
  "controller must check updateGanttStatus boolean result."
);

assert(
  controllerSource.includes("כדאי לבדוק ידנית"),
  "controller must tell the user to check manually after secondary write failures."
);


assert(
  controllerSource.includes("Failed to mark approved content as published"),
  "markOverdueItemPublished must fail loudly when approved content publish update is missing."
);

assert(
  controllerSource.includes("Failed to mark gantt row as published"),
  "markOverdueItemPublished must fail loudly when gantt publish update is missing."
);


assert(
  controllerSource.includes("Failed to mark approved content as cancelled"),
  "overdue archive must fail loudly when approved content cancellation update is missing."
);

assert(
  controllerSource.includes("Failed to mark gantt row as cancelled"),
  "overdue archive must fail loudly when gantt cancellation update is missing."
);

console.log("✅ status-secondary-failures-audit-test passed");
