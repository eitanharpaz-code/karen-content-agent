import {
  computePlanningHealthSignals,
  type PlanningGanttItem,
} from "../services/planning-health.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const anchorDate = new Date(2026, 5, 17);

const baseItem = (
  overrides: Partial<PlanningGanttItem>
): PlanningGanttItem => ({
  contentId: "TEST-001",
  date: "14/06/2026",
  contentType: "ריל",
  collaboration: "לא",
  status: "בתכנון",
  ...overrides,
});

const publishedOrganicReelSignals = computePlanningHealthSignals(
  [
    baseItem({
      contentId: "PRW-005",
      date: "14/06/2026",
      status: "פורסם",
    }),
    baseItem({
      contentId: "PRW-002",
      date: "19/06/2026",
      status: "בתכנון",
    }),
  ],
  { anchorDate }
);

assert(
  !publishedOrganicReelSignals.some((signal) => signal.type === "current_week_missing_reel"),
  "published organic reels count toward weekly reel coverage"
);

const collaborationDoesNotCountSignals = computePlanningHealthSignals(
  [
    baseItem({
      contentId: "PRW-005",
      date: "14/06/2026",
      status: "פורסם",
    }),
    baseItem({
      contentId: "MSK-001",
      date: "15/06/2026",
      collaboration: "כן",
      status: "פורסם",
    }),
  ],
  { anchorDate }
);

assert(
  collaborationDoesNotCountSignals.some(
    (signal) =>
      signal.type === "current_week_missing_reel" &&
      signal.missingCount === 1
  ),
  "collaboration reels do not count toward organic reel coverage"
);

const cancelledDoesNotCountSignals = computePlanningHealthSignals(
  [
    baseItem({
      contentId: "PRW-005",
      date: "14/06/2026",
      status: "פורסם",
    }),
    baseItem({
      contentId: "PRW-002",
      date: "19/06/2026",
      status: "בוטל",
    }),
  ],
  { anchorDate }
);

assert(
  cancelledDoesNotCountSignals.some(
    (signal) =>
      signal.type === "current_week_missing_reel" &&
      signal.missingCount === 1
  ),
  "cancelled reels do not count toward weekly reel coverage"
);

console.log("\nPlanning health coverage scenarios passed.");