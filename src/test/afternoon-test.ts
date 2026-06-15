import { buildAfternoonReminderFromData } from "../services/daily-brief.service";
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

const buildAfternoon = (
  priorityItems: ReturnType<typeof computePriorityItems>,
  ganttIsLight: boolean
) => buildAfternoonReminderFromData({
  priorityItems,
  ganttIsLight,
  monthName: "יוני",
});

// Afternoon 1: ready P0 remains the urgent upload reminder.
const afternoon1 = buildAfternoon(
  makeItems(
    [
      {
        contentId: "TODAY",
        name: "מוכן להיום",
        date: dateInDays(0),
        status: "מוכן",
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
    ]
  ),
  false
);
assert(
  afternoon1?.includes("היום אמור לעלות:") === true,
  "ready P0 keeps the scheduler urgency phrase"
);
assert(
  afternoon1?.includes('העליתי את "מוכן להיום"') === true,
  "ready P0 includes the upload CTA"
);
const overdueReady = buildAfternoon(
  makeItems(
    [
      {
        contentId: "OVERDUE",
        name: "מוכן באיחור",
        date: dateInDays(-2),
        status: "מוכן",
      },
    ],
    [
      {
        contentId: "OVERDUE",
        taskName: "מוכן באיחור",
        filmed: "כן",
        edited: "כן",
        coverReady: "לא",
      },
    ]
  ),
  false
);
assert(
  overdueReady?.includes("היום אמור לעלות:") === true,
  "ready overdue P0 currently keeps the same scheduler urgency phrase"
);

// Afternoon 2: P3 is selected before P4 when no P0/P1/P2 action exists.
const afternoon2 = buildAfternoon(
  makeItems(
    [
      {
        contentId: "P3",
        name: "צילום בעוד שלושה ימים",
        date: dateInDays(3),
        status: "בתכנון",
      },
      {
        contentId: "P4",
        name: "עריכה בהמשך",
        date: dateInDays(6),
        status: "בתכנון",
      },
    ],
    [
      {
        contentId: "P3",
        taskName: "צילום בעוד שלושה ימים",
        filmed: "לא",
        edited: "לא",
        coverReady: "לא",
      },
      {
        contentId: "P4",
        taskName: "עריכה בהמשך",
        filmed: "כן",
        edited: "לא",
        coverReady: "לא",
      },
    ]
  ),
  false
);
assert(
  afternoon2?.includes('לצלם את "צילום בעוד שלושה ימים"') === true,
  "P3 production action is selected before P4"
);
assert(
  afternoon2?.includes("עריכה בהמשך") === false,
  "afternoon contains only one action"
);

// Afternoon 3: ganttIsLight enables a PLANNING action.
const afternoon3 = buildAfternoon(
  makeItems([], [
    {
      contentId: "PLANNING",
      taskName: "מוכן בלי גאנט",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
      readyAt: "2026-06-10T10:00:00.000Z",
    },
  ]),
  true
);
assert(
  afternoon3?.includes("הגאנט קצת ריק") === true,
  "light gantt keeps the planning reminder"
);
assert(
  afternoon3?.includes('לשבץ את "מוכן בלי גאנט" לגאנט') === true,
  "light gantt selects a clear PLANNING action"
);

// Afternoon 4: no clear action and a non-light gantt means no message.
const afternoon4 = buildAfternoon(
  makeItems(
    [
      {
        contentId: "FUTURE-READY",
        name: "מוכן לעתיד",
        date: dateInDays(5),
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
  ),
  false
);
assert(
  afternoon4 === null,
  "afternoon skips when there is no clear action"
);
const p0NotReady = buildAfternoon(
  makeItems(
    [
      {
        contentId: "P0-NOT-READY",
        name: "לא מוכן להיום",
        date: dateInDays(0),
        status: "בתכנון",
      },
    ],
    [
      {
        contentId: "P0-NOT-READY",
        taskName: "לא מוכן להיום",
        filmed: "לא",
        edited: "לא",
        coverReady: "לא",
      },
    ]
  ),
  false
);
assert(
  p0NotReady === null,
  "Stage B does not add a new P0-not-ready afternoon flow"
);

const lightGanttWithoutPlanning = buildAfternoon([], true);
assert(
  lightGanttWithoutPlanning?.includes("בואי נתכנן את יוני") === true,
  "light gantt without a planning item keeps the dynamic monthly CTA"
);

console.log("\nAfternoon reminder scenarios passed.");
