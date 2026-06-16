import { computePriorityItems } from "../services/priority.service";
import { formatPriorityWhatsImportantResponse } from "../services/visibility.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }

  console.log(`PASS: ${message}`);
};

const formatDate = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  return `${day}/${month}/${year}`;
};

const priorityItems = computePriorityItems(
  [
    {
      contentId: "ACTIVE-P0",
      name: "תוכן שעולה היום",
      date: formatDate(0),
      status: "בתכנון",
    },
    {
      contentId: "OVERDUE-1",
      name: "תוכן מאתמול",
      date: formatDate(-1),
      status: "בתכנון",
    },
    {
      contentId: "P1-1",
      name: "תוכן שעולה מחר",
      date: formatDate(1),
      status: "בתכנון",
    },
  ],
  [
    {
      contentId: "ACTIVE-P0",
      taskName: "תוכן שעולה היום",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
    {
      contentId: "OVERDUE-1",
      taskName: "תוכן מאתמול",
      filmed: "כן",
      edited: "כן",
      coverReady: "כן",
    },
    {
      contentId: "P1-1",
      taskName: "תוכן שעולה מחר",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
  ]
);

const response = formatPriorityWhatsImportantResponse(priorityItems);

const activeIndex = response.indexOf("תוכן שעולה היום");
const overdueIndex = response.indexOf("תוכן מאתמול");
const p1Index = response.indexOf("תוכן שעולה מחר");

assert(activeIndex !== -1, "active P0 appears in whats important");
assert(overdueIndex !== -1, "overdue decision appears in whats important");
assert(p1Index !== -1, "P1 appears in whats important");
assert(activeIndex < overdueIndex, "active P0 appears before overdue decision");
assert(overdueIndex < p1Index, "overdue decision appears before P1");
assert(response.includes("צריך החלטה"), "overdue item gets decision status");
assert(response.includes("* עלה"), "overdue response includes published endpoint");
assert(response.includes("* לדחות ל-[תאריך]"), "overdue response includes reschedule endpoint");
assert(response.includes("* לארכיון"), "overdue response includes archive endpoint");

console.log("\nWhats important priority scenarios passed.");
