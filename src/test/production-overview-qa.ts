// QA for production_overview (28.7.2026)
// Locks the pure logic: filtering (omit published + overdue-unpublished),
// deadline sort, collab resolution from approved rows, the three display
// states, and the closing invitation.
import { buildProductionOverviewItems, formatProductionOverview } from "../services/visibility.service";

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean) => {
  if (cond) { passed++; console.log(`\u2705 ${label}`); }
  else { failed++; console.log(`\u274c ${label}`); }
};

const mkTask = (contentId: string, taskName: string, filmed: string, edited: string, deadline: string, uploaded = "\u05dc\u05d0") =>
  ({ contentId, taskName, needsText: "\u05dc\u05d0", filmed, edited, coverReady: "\u05dc\u05d0", copyReady: "\u05db\u05df", uploaded, deadline, uploadTime: "", notes: "", readyAt: "", updatedAt: "" }) as any;

const today = new Date(); today.setHours(0, 0, 0, 0);
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const plus = (n: number) => { const d = new Date(today); d.setDate(today.getDate() + n); return fmt(d); };
const minus = (n: number) => { const d = new Date(today); d.setDate(today.getDate() - n); return fmt(d); };

const approved = [
  ["content_id", "\u05e9\u05dd", "\u05e1\u05d9\u05db\u05d5\u05dd", "\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4", "\u05d8\u05d5\u05df", "\u05e2\u05d3\u05d9\u05e4\u05d5\u05ea", "\u05e6\u05d9\u05dc\u05d5\u05dd", "\u05e9\u05ea\u05e4", "\u05e1\u05d8\u05d8\u05d5\u05e1", "\u05d4\u05e2\u05e8\u05d5\u05ea", "\u05e1\u05d5\u05d2"],
  ["MKB-001", "\u05de\u05db\u05d1\u05d9", "", "", "", "", "", "\u05db\u05df", "", "", "\u05e8\u05d9\u05dc"],
  ["GEN-001", "\u05e8\u05d2\u05d9\u05dc", "", "", "", "", "", "\u05dc\u05d0", "", "", "\u05e8\u05d9\u05dc"],
];

// --- Filtering ---
{
  const tasks = [
    mkTask("GEN-001", "\u05e2\u05ea\u05d9\u05d3\u05d9", "\u05db\u05df", "\u05dc\u05d0", plus(5)),
    mkTask("GEN-002", "\u05e2\u05d1\u05e8 \u05dc\u05d0 \u05e4\u05d5\u05e8\u05e1\u05dd", "\u05db\u05df", "\u05db\u05df", minus(3)),
    mkTask("GEN-003", "\u05e2\u05d1\u05e8 \u05e4\u05d5\u05e8\u05e1\u05dd", "\u05db\u05df", "\u05db\u05df", minus(3), "\u05db\u05df"),
    mkTask("GEN-004", "\u05e2\u05ea\u05d9\u05d3\u05d9 \u05e4\u05d5\u05e8\u05e1\u05dd", "\u05db\u05df", "\u05db\u05df", plus(2), "\u05db\u05df"),
  ];
  const items = buildProductionOverviewItems(tasks, approved);
  check("omits overdue-unpublished", !items.some((i) => i.name === "\u05e2\u05d1\u05e8 \u05dc\u05d0 \u05e4\u05d5\u05e8\u05e1\u05dd"));
  check("omits published (past)", !items.some((i) => i.name === "\u05e2\u05d1\u05e8 \u05e4\u05d5\u05e8\u05e1\u05dd"));
  check("omits published (future)", !items.some((i) => i.name === "\u05e2\u05ea\u05d9\u05d3\u05d9 \u05e4\u05d5\u05e8\u05e1\u05dd"));
  check("keeps active future item", items.some((i) => i.name === "\u05e2\u05ea\u05d9\u05d3\u05d9"));
  check("count is exactly 1", items.length === 1);
}

// --- Sort + no-deadline sink ---
{
  const tasks = [
    mkTask("GEN-001", "\u05e8\u05d7\u05d5\u05e7", "\u05db\u05df", "\u05dc\u05d0", plus(9)),
    mkTask("GEN-002", "\u05e7\u05e8\u05d5\u05d1", "\u05db\u05df", "\u05dc\u05d0", plus(2)),
    mkTask("GEN-003", "\u05d1\u05dc\u05d9 \u05ea\u05d0\u05e8\u05d9\u05da", "\u05dc\u05d0", "\u05dc\u05d0", ""),
    mkTask("GEN-004", "\u05d0\u05de\u05e6\u05e2", "\u05db\u05df", "\u05dc\u05d0", plus(5)),
  ];
  const items = buildProductionOverviewItems(tasks, approved);
  check("sorted nearest deadline first", items[0].name === "\u05e7\u05e8\u05d5\u05d1");
  check("sorted second", items[1].name === "\u05d0\u05de\u05e6\u05e2");
  check("sorted third", items[2].name === "\u05e8\u05d7\u05d5\u05e7");
  check("no-deadline sinks to bottom", items[items.length - 1].name === "\u05d1\u05dc\u05d9 \u05ea\u05d0\u05e8\u05d9\u05da");
}

// --- Collab resolution from approved rows ---
{
  const tasks = [
    mkTask("MKB-001", "\u05de\u05db\u05d1\u05d9 \u05d1\u05d4\u05e4\u05e7\u05d4", "\u05db\u05df", "\u05db\u05df", plus(3)),
    mkTask("GEN-001", "\u05e8\u05d2\u05d9\u05dc \u05d1\u05d4\u05e4\u05e7\u05d4", "\u05db\u05df", "\u05db\u05df", plus(4)),
  ];
  const items = buildProductionOverviewItems(tasks, approved);
  const mkb = items.find((i) => i.contentId === "MKB-001");
  const gen = items.find((i) => i.contentId === "GEN-001");
  check("collab true for MKB-001", Boolean(mkb && mkb.isCollab));
  check("collab false for GEN-001", Boolean(gen && !gen.isCollab));
}

// --- Text: three states + invitation ---
{
  const tasks = [
    mkTask("MKB-001", "\u05de\u05db\u05d1\u05d9", "\u05db\u05df", "\u05db\u05df", plus(2)),
    mkTask("GEN-002", "\u05d0\u05d9\u05df \u05d3\u05d3\u05dc\u05d9\u05d9\u05df", "\u05dc\u05d0", "\u05dc\u05d0", ""),
  ];
  const items = buildProductionOverviewItems(tasks, approved);
  const text = formatProductionOverview(items);
  check("text has header", text.includes("\u05d6\u05d4 \u05de\u05d4 \u05e9\u05e0\u05de\u05e6\u05d0 \u05db\u05e8\u05d2\u05e2 \u05d1\u05d4\u05e4\u05e7\u05d4:"));
  check("collab tag shown", text.includes("(\u05e9\u05ea\u05f4\u05e4)"));
  check("estimated upload shown (deadline+1)", text.includes(plus(3)));
  check("no-deadline line shown", text.includes("\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05dc\u05d5 \u05ea\u05d0\u05e8\u05d9\u05da \u05d1\u05d2\u05d0\u05e0\u05d8"));
  check("single-item invitation", text.includes("\u05ea\u05d5\u05db\u05df \u05d0\u05d7\u05d3 \u05e9\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05dc\u05d5 \u05ea\u05d0\u05e8\u05d9\u05da"));
}

// --- Text: empty state + plural invitation ---
{
  check("empty state message", formatProductionOverview([]) === "\u05db\u05e8\u05d2\u05e2 \u05d0\u05d9\u05df \u05ea\u05db\u05e0\u05d9\u05dd \u05d1\u05d4\u05e4\u05e7\u05d4.");
  const tasks = [
    mkTask("GEN-002", "\u05d0", "\u05dc\u05d0", "\u05dc\u05d0", ""),
    mkTask("GEN-003", "\u05d1", "\u05dc\u05d0", "\u05dc\u05d0", ""),
  ];
  const text = formatProductionOverview(buildProductionOverviewItems(tasks, approved));
  check("plural invitation", text.includes("2 \u05ea\u05db\u05e0\u05d9\u05dd \u05e9\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05dc\u05d4\u05dd \u05ea\u05d0\u05e8\u05d9\u05da"));
}

console.log(`\nProduction overview QA: ${passed} passed, ${failed} failed`);
