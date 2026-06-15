import {
  buildMorningBriefFromData,
  getBriefGanttDateRange,
} from "../services/daily-brief.service";
import {
  computePriorityItems,
} from "../services/priority.service";
import type {
  GanttItemInput,
  ProductionTaskInput,
} from "../services/priority.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const dateInDays = (days: number): string => {
  const israelToday = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Jerusalem",
  });
  const [year, month, day] = israelToday.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
};

const makeItems = (
  ganttItems: GanttItemInput[],
  productionTasks: ProductionTaskInput[]
) => computePriorityItems(ganttItems, productionTasks);

const buildMorning = (
  priorityItems: ReturnType<typeof computePriorityItems>,
  futureHoles: string[] = []
) => buildMorningBriefFromData({
  priorityItems,
  futureHoles,
  monthName: "יוני",
});

const countOccurrences = (text: string, value: string): number =>
  text.split(value).length - 1;

const ganttRange = getBriefGanttDateRange();
const overdueDate = new Date();
overdueDate.setDate(overdueDate.getDate() - 2);
const beyondFiveDaysDate = new Date();
beyondFiveDaysDate.setDate(beyondFiveDaysDate.getDate() + 8);
assert(
  ganttRange.startDate <= overdueDate,
  "brief gantt range includes overdue content"
);
assert(
  ganttRange.endDate >= beyondFiveDaysDate,
  "brief gantt range includes content beyond five days"
);

// Morning 1: multiple P0 items, all unfinished.
const p0Gantt = [1, 2, 3, 4].map((index) => ({
  contentId: `P0-${index}`,
  name: `תוכן דחוף ${index}`,
  date: dateInDays(0),
  status: "בתכנון",
}));
const p0Tasks = [1, 2, 3, 4].map((index) => ({
  contentId: `P0-${index}`,
  taskName: `תוכן דחוף ${index}`,
  filmed: "לא",
  edited: "לא",
  coverReady: "לא",
}));
const morning1 = buildMorning(makeItems(p0Gantt, p0Tasks));
assert(Boolean(morning1), "P0 morning brief is created");
assert(
  countOccurrences(morning1 || "", "— חסר צילום") === 3,
  "morning displays at most three P0 items"
);
assert(
  morning1?.includes("ועוד פריט אחד") === true,
  "morning summarizes additional P0 items"
);
assert(
  morning1?.includes('לצלם את "תוכן דחוף 1"') === true,
  "multiple P0 items keep the primary title for clarity"
);
assert(
  morning1?.includes('לצלם את "תוכן דחוף 2"') === true,
  "second P0 action is the secondary focus"
);

// Morning 2: ready P0 followed by actionable P1.
const morning2Items = makeItems(
  [
    {
      contentId: "TODAY",
      name: "מוכן להיום",
      date: dateInDays(0),
      status: "מוכן",
    },
    {
      contentId: "TOMORROW",
      name: "צילום למחר",
      date: dateInDays(1),
      status: "בתכנון",
    },
  ],
  [
    {
      contentId: "TODAY",
      taskName: "מוכן להיום",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
    },
    {
      contentId: "TOMORROW",
      taskName: "צילום למחר",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
  ]
);
const morning2 = buildMorning(morning2Items);
assert(
  morning2?.includes("* לוודא שהוא עולה") === true,
  "single ready P0 uses a concise verify-upload focus"
);
assert(
  morning2?.includes('לצלם את "צילום למחר"') === true,
  "P1 action becomes secondary after ready P0"
);
assert(
  countOccurrences(morning2 || "", "מוכן להיום") === 2,
  "single P0 title appears only in the status and reply"
);
assert(
  morning2?.includes("*קיצורים נוספים*") === false,
  "morning omits the repeated shortcuts section"
);

// Morning 3: P1 and P2 keep their engine order.
const morning3Items = makeItems(
  [
    {
      contentId: "P1",
      name: "צילום מחר",
      date: dateInDays(1),
      status: "בתכנון",
    },
    {
      contentId: "P2",
      name: "עריכה בעוד יומיים",
      date: dateInDays(2),
      status: "בתכנון",
    },
  ],
  [
    {
      contentId: "P1",
      taskName: "צילום מחר",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
    {
      contentId: "P2",
      taskName: "עריכה בעוד יומיים",
      filmed: "כן",
      edited: "לא",
      coverReady: "לא",
    },
  ]
);
const morning3 = buildMorning(morning3Items);
assert(
  (morning3 || "").indexOf('לצלם את "צילום מחר"') <
    (morning3 || "").indexOf('לערוך את "עריכה בעוד יומיים"'),
  "P1 action appears before P2 action"
);

// Morning 4: PLANNING uses ready_at age and still shows explicit actions.
const morning4Items = makeItems([], [
  {
    contentId: "PLANNING-UNFINISHED",
    taskName: "לא מוכן בלי גאנט",
    filmed: "לא",
    edited: "לא",
    coverReady: "לא",
  },
  {
    contentId: "PLANNING-NEW",
    taskName: "מוכן חדש בלי גאנט",
    filmed: "כן",
    edited: "כן",
    coverReady: "לא",
    readyAt: "2026-06-14T10:00:00.000Z",
  },
  {
    contentId: "PLANNING-OLD",
    taskName: "מוכן ישן בלי גאנט",
    filmed: "כן",
    edited: "כן",
    coverReady: "לא",
    readyAt: "2026-06-10T10:00:00.000Z",
  },
]);
const morning4 = buildMorning(morning4Items, ["20/06/2026"]);
assert(
  (morning4 || "").indexOf('לשבץ את "מוכן ישן בלי גאנט"') <
    (morning4 || "").indexOf('לשבץ את "מוכן חדש בלי גאנט"'),
  "oldest ready PLANNING item appears first"
);
assert(
  morning4?.includes("ברקע: 1 חורים פנויים") === true,
  "planning morning keeps the gantt holes context"
);

// Morning 5: future ready items have no artificial action.
const morning5Items = makeItems(
  [
    {
      contentId: "FUTURE-READY",
      name: "מוכן לעתיד",
      date: dateInDays(8),
      status: "מוכן",
    },
  ],
  [
    {
      contentId: "FUTURE-READY",
      taskName: "מוכן לעתיד",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
    },
  ]
);
const morning5 = buildMorning(morning5Items, ["25/06/2026"]);
assert(
  morning5?.includes("היום נראה יחסית רגוע") === true,
  "future ready-only state uses the calm empty state"
);
assert(
  morning5?.includes("לערוך") === false &&
    morning5?.includes("לוודא עלייה") === false,
  "future ready item does not receive an artificial action"
);

console.log("\nMorning brief scenarios passed.");
