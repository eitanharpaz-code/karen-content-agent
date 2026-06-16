import { computePlanningHealthSignals } from "../services/planning-health.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const anchorDate = new Date(2026, 5, 16);

const baseItem = {
  contentId: "TEST-001",
  collaboration: "לא",
  status: "בתכנון",
};

const healthy = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "16/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "R2", date: "18/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "20/06/2026", contentType: "פוסט" },
    { ...baseItem, contentId: "N1", date: "23/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "N2", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(healthy.length === 0, "healthy gantt has no planning signals");

const missingReel = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "16/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "20/06/2026", contentType: "פוסט" },
    { ...baseItem, contentId: "N1", date: "23/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "N2", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  missingReel.some((signal) => signal.type === "current_week_missing_reel"),
  "missing reel creates signal"
);

const missingPost = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "16/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "R2", date: "18/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "N1", date: "23/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "N2", date: "25/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  missingPost.some((signal) => signal.type === "current_week_missing_post"),
  "missing post creates signal"
);

const collabOnlyDoesNotCount = computePlanningHealthSignals(
  [
    {
      ...baseItem,
      contentId: "C1",
      date: "16/06/2026",
      contentType: "ריל",
      collaboration: "כן",
    },
    {
      ...baseItem,
      contentId: "C2",
      date: "18/06/2026",
      contentType: "ריל",
      collaboration: "מותג",
    },
  ],
  { anchorDate }
);

assert(
  collabOnlyDoesNotCount.some(
    (signal) => signal.type === "current_week_missing_reel"
  ),
  "collaboration does not count as organic reel"
);

const placeholderDoesNotCount = computePlanningHealthSignals(
  [
    {
      ...baseItem,
      contentId: "טרם תוכנן",
      date: "16/06/2026",
      contentType: "ריל",
    },
    {
      ...baseItem,
      contentId: "",
      date: "18/06/2026",
      contentType: "ריל",
    },
  ],
  { anchorDate }
);

assert(
  placeholderDoesNotCount.some(
    (signal) => signal.type === "current_week_missing_reel"
  ),
  "placeholder content ids do not count as organic reel"
);

const lightNextWeek = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "16/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "R2", date: "18/06/2026", contentType: "ריל" },
    { ...baseItem, contentId: "P1", date: "20/06/2026", contentType: "פוסט" },
  ],
  { anchorDate }
);

assert(
  lightNextWeek.some((signal) => signal.type === "next_week_empty_or_light"),
  "light next week creates signal"
);

const publishedDoesNotCount = computePlanningHealthSignals(
  [
    { ...baseItem, contentId: "R1", date: "16/06/2026", contentType: "ריל", status: "פורסם" },
    { ...baseItem, contentId: "R2", date: "18/06/2026", contentType: "ריל", status: "בוטל" },
  ],
  { anchorDate }
);

assert(
  publishedDoesNotCount.some(
    (signal) => signal.type === "current_week_missing_reel"
  ),
  "inactive statuses do not count as organic reel"
);

console.log("\nPlanning health scenarios passed.");
