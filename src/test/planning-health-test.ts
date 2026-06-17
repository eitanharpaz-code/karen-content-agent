import { computePlanningHealthSignals } from "../services/planning-health.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const anchorDate = new Date(2026, 5, 16); // Tuesday, current week starts 14/06/2026

const baseItem = {
  contentId: "TEST-001",
  collaboration: "לא",
  status: "בתכנון",
};

const healthy = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "21/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "R2", date: "24/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(healthy.length === 0, "healthy next-week gantt has no planning signals");

const missingReel = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "21/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  missingReel.some((signal) => signal.type === "next_week_missing_reel"),
  "missing next-week reel creates signal"
);

const missingPost = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "21/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "R2", date: "24/06/2026", contentType: "ריל" },
  ],
  { anchorDate }
);

assert(
  missingPost.some((signal) => signal.type === "next_week_missing_post"),
  "missing next-week post creates signal"
);

const collabOnlyDoesNotCount = computePlanningHealthSignals(
  [
    {
      ...baseItem,
      contentId: "C1",
      date: "21/06/2026",
      contentType: "ריל",
      collaboration: "כן",
    },
    {
      ...baseItem,
      contentId: "C2",
      date: "24/06/2026",
      contentType: "ריל",
      collaboration: "מותג",
    },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  collabOnlyDoesNotCount.some(
    (signal) => signal.type === "next_week_missing_reel"
  ),
  "collaboration does not count as organic next-week reel"
);

const placeholderDoesNotCount = computePlanningHealthSignals(
  [
    {
      ...baseItem,
      contentId: "טרם תוכנן",
      date: "21/06/2026",
      contentType: "ריל",
    },
    {
      ...baseItem,
      contentId: "",
      date: "24/06/2026",
      contentType: "ריל",
    },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  placeholderDoesNotCount.some(
    (signal) => signal.type === "next_week_missing_reel"
  ),
  "placeholder content ids do not count as organic next-week reel"
);

const cancelledDoesNotCount = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "21/06/2026", contentType: "ריל", status: "פורסם" },
    { ...baseItem, contentId: "R2", date: "24/06/2026", contentType: "ריל", status: "בוטל" },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  cancelledDoesNotCount.some(
    (signal) => signal.type === "next_week_missing_reel"
  ),
  "cancelled next-week reels do not count as organic reel"
);

const ThursdayAnchor = new Date(2026, 5, 18);
const criticalLateWeek = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "21/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate: ThursdayAnchor }
);

assert(
  criticalLateWeek.some(
    (signal) =>
      signal.type === "next_week_missing_reel" &&
      signal.severity === "critical"
  ),
  "next-week gaps become critical from Thursday"
);

console.log("\nPlanning health scenarios passed.");
