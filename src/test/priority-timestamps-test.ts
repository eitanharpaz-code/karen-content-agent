import {
  computePriorityItems,
  getBriefDisplayTitle,
} from "../services/priority.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const dateInDays = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
};

const readyAt = "2026-06-10T10:00:00.000Z";
const updatedAt = "2026-06-11T10:00:00.000Z";

const items = computePriorityItems(
  [
    {
      contentId: "test_name_3",
      name: "תוכן מוכן שעולה היום",
      date: dateInDays(0),
      status: "מוכן",
    },
    {
      contentId: "test_name_4",
      name: "תוכן מוכן שעולה בעתיד",
      date: dateInDays(5),
      status: "מוכן",
    },
    {
      contentId: "טרם תוכנן",
      name: "שורת גאנט שאינה תוכן",
      date: dateInDays(3),
      status: "בתכנון",
    },
  ],
  [
    {
      contentId: "test_name_3",
      taskName: "תוכן מוכן שעולה היום",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
      deadline: dateInDays(-1),
      readyAt,
      updatedAt,
    },
    {
      contentId: "test_name_4",
      taskName: "תוכן מוכן שעולה בעתיד",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
      deadline: dateInDays(4),
      readyAt,
      updatedAt,
    },
    {
      contentId: "test_name_5",
      taskName: "תוכן מוכן בלי גאנט",
      filmed: "כן",
      edited: "כן",
      coverReady: "לא",
      readyAt,
      updatedAt,
    },
  ]
);

const today = items.find((item) => item.contentId === "test_name_3");
const future = items.find((item) => item.contentId === "test_name_4");
const planning = items.find((item) => item.contentId === "test_name_5");

assert(Boolean(today), "today item exists");
assert(today?.priorityLevel === "P0", "today item is P0");
assert(
  today?.recommendedAction === "verify-upload",
  "ready item due today verifies upload"
);
assert(today?.readyAt === readyAt, "today item carries ready_at");
assert(today?.updatedAt === updatedAt, "today item carries updated_at");
assert(
  today?.productionDeadline === dateInDays(-1),
  "today item carries production deadline"
);
assert(
  today?.isReadyToUpload === true,
  "cover does not block readiness"
);

assert(Boolean(future), "future item exists");
assert(future?.priorityLevel === "P4", "future item keeps upload priority");
assert(
  future?.recommendedAction === "none",
  "ready future item has no immediate action"
);
assert(
  future?.reason.includes("כבר מוכן") === true,
  "ready future item has accurate reason"
);

assert(Boolean(planning), "planning item exists");
assert(
  planning?.priorityLevel === "PLANNING",
  "ready item without gantt is PLANNING"
);
assert(
  planning?.recommendedAction === "schedule",
  "ready item without gantt recommends scheduling"
);
assert(planning?.readyAt === readyAt, "planning item carries ready_at");

assert(
  !items.some((item) => item.contentId === "טרם תוכנן"),
  "placeholder gantt row is excluded"
);

const longTitle =
  "כותרת ארוכה מאוד שנועדה לבדוק שהמערכת חותכת אותה במילה שלמה ולא באמצע מילה";

const displayTitle = getBriefDisplayTitle(longTitle);

assert(displayTitle.endsWith("…"), "long title ends with ellipsis");
assert(displayTitle.length <= 56, "long title respects display limit");

console.log("\nPriority timestamp tests passed.");