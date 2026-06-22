import { computePriorityItems } from "../services/priority.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const items = computePriorityItems([], [
  {
    contentId: "test_name_1",
    taskName: "לא מוכן",
    filmed: "לא",
    edited: "לא",
    coverReady: "לא",
    readyAt: "",
    updatedAt: "2026-06-15T12:00:00.000Z",
  },
  {
    contentId: "test_name_2",
    taskName: "מוכן חדש",
    filmed: "כן",
    edited: "כן",
    coverReady: "לא",
    readyAt: "2026-06-14T12:00:00.000Z",
    updatedAt: "2026-06-14T12:00:00.000Z",
  },
  {
    contentId: "test_name_3",
    taskName: "מוכן ישן",
    filmed: "כן",
    edited: "כן",
    coverReady: "לא",
    readyAt: "2026-06-10T12:00:00.000Z",
    updatedAt: "2026-06-10T12:00:00.000Z",
  },
]);

assert(items.length === 3, "all planning items returned");
assert(items[0].contentId === "test_name_3", "oldest ready item ranks first");
assert(items[1].contentId === "test_name_2", "newer ready item ranks second");
assert(items[2].contentId === "test_name_1", "unfinished item ranks after ready items");
assert(items.every((item) => item.priorityLevel === "PLANNING"), "items remain PLANNING");

console.log("\nPriority ready age test passed.");