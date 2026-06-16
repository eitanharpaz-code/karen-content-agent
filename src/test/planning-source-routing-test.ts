import { buildPlanningSourceRoutingMessage } from "../services/planning-source-routing.service";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const missingReel = buildPlanningSourceRoutingMessage({
  signalMessage: "השבוע חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(missingReel.includes("רעיון חדש לריל"), "missing reel offers reel idea generation");
assert(!missingReel.includes("רעיונות לפוסט"), "missing reel does not offer post ideas");

const missingPost = buildPlanningSourceRoutingMessage({
  signalMessage: "השבוע חסר עוד פוסט אחד בגאנט.",
  missingContentType: "פוסט",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(missingPost.includes("רעיון חדש לפוסט"), "missing post offers post idea generation");
assert(!missingPost.includes("רעיונות לריל"), "missing post does not offer reel ideas");

const approvedReel = buildPlanningSourceRoutingMessage({
  signalMessage: "השבוע חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [{ contentId: "ABC-001", title: "זוגיות בזמן ארגון חתונה" }],
  nearReadyProduction: [{ contentId: "ABC-002", title: "לא אמור להופיע" }],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(approvedReel.includes("כבר אושר אבל עדיין לא שובץ בגאנט"), "approved source mentions gantt scheduling");
assert(approvedReel.includes("1. זוגיות בזמן ארגון חתונה"), "approved source lists options");
assert(!approvedReel.includes("לא אמור להופיע"), "first available source wins");

const nearReady = buildPlanningSourceRoutingMessage({
  signalMessage: "השבוע חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [],
  nearReadyProduction: [{ contentId: "ABC-003", title: "שמלה שלישית", status: "חסרה עריכה" }],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(nearReady.includes("מה הכי קרוב להיות מוכן"), "near-ready source is used when no approved unscheduled exists");
assert(nearReady.includes("שמלה שלישית - חסרה עריכה"), "near-ready source includes status");

console.log("\nPlanning source routing scenarios passed.");