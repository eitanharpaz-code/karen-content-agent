import { computePriorityItems } from "../services/priority.service";
import { formatPriorityWhatsImportantResponse } from "../services/visibility.service";
import type { PlanningHealthSignal } from "../services/planning-health.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
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
      contentId: "P1-ITEM",
      name: "תוכן שעולה מחר",
      date: formatDate(1),
      status: "בתכנון",
    },
    {
      contentId: "P3-ITEM",
      name: "תוכן שעולה בעוד שלושה ימים",
      date: formatDate(3),
      status: "בתכנון",
    },
  ],
  [
    {
      contentId: "P1-ITEM",
      taskName: "תוכן שעולה מחר",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
    {
      contentId: "P3-ITEM",
      taskName: "תוכן שעולה בעוד שלושה ימים",
      filmed: "לא",
      edited: "לא",
      coverReady: "לא",
    },
  ]
);

const planningSignals: PlanningHealthSignal[] = [
  {
    type: "current_week_missing_reel",
    severity: "critical",
    message: "השבוע חסר עוד ריל אחד בגאנט.",
    recommendedAction: "בואי נשלים את השבוע",
    missingCount: 1,
  },
];

const response = formatPriorityWhatsImportantResponse(
  priorityItems,
  planningSignals
);

const p1Index = response.indexOf("תוכן שעולה מחר");
const planningIndex = response.indexOf("השבוע חסר עוד ריל אחד בגאנט");
const p3Index = response.indexOf("תוכן שעולה בעוד שלושה ימים");

assert(p1Index !== -1, "P1 appears in whats important");
assert(planningIndex !== -1, "planning health appears in whats important");
assert(p3Index !== -1, "P3 appears in whats important");
assert(p1Index < planningIndex, "P1 appears before planning health");
assert(planningIndex < p3Index, "planning health appears before P3");
assert(
  response.includes("* בואי נשלים את השבוע"),
  "planning health exposes a reply endpoint"
);

console.log("\nWhats important planning health scenarios passed.");
