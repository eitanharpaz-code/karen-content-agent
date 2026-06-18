import {
  buildPlanningSourceRoutingMessage,
  createPlanningSourceRoutingState,
  handlePlanningSourceRoutingReply,
} from "../services/planning-source-routing.service";
const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const missingReel = buildPlanningSourceRoutingMessage({
  signalMessage: "שבוע הבא חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(missingReel.includes("מסלול מהיר"), "missing reel points to fastlane-style creation");
assert(!missingReel.includes("רעיונות לפוסט"), "missing reel does not offer post ideas");
assert(!missingReel.includes("רוצה שאציע 3 כיוונים"), "empty source does not ask an unsupported yes/no question");

const missingPost = buildPlanningSourceRoutingMessage({
  signalMessage: "שבוע הבא חסר עוד פוסט אחד בגאנט.",
  missingContentType: "פוסט",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(missingPost.includes("מסלול מהיר"), "missing post points to fastlane-style creation");
assert(!missingPost.includes("רעיונות לריל"), "missing post does not offer reel ideas");

const approvedReel = buildPlanningSourceRoutingMessage({
  signalMessage: "שבוע הבא חסר עוד ריל אחד בגאנט.",
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
  signalMessage: "שבוע הבא חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [],
  nearReadyProduction: [{ contentId: "ABC-003", title: "שמלה שלישית", status: "חסרה עריכה" }],
  approvedNotStarted: [],
  ideaBank: [],
});

assert(nearReady.includes("מה הכי קרוב להיות מוכן"), "near-ready source is used when no approved unscheduled exists");
assert(nearReady.includes("שמלה שלישית - חסרה עריכה"), "near-ready source includes status");
const state = createPlanningSourceRoutingState({
  signalMessage: "שבוע הבא חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [
    { contentId: "ABC-001", title: "זוגיות בזמן ארגון חתונה" },
    { contentId: "ABC-002", title: "שמלה שלישית" },
  ],
  nearReadyProduction: [{ contentId: "ABC-003", title: "יום לפני החתונה", status: "חסר צילום" }],
  approvedNotStarted: [],
  ideaBank: [{ contentId: "IDEA-001", title: "רעיון מבנק" }],
});

assert(state.activeSource === "approvedUnscheduled", "state starts from first available source");

const yesResult = handlePlanningSourceRoutingReply(state, "כן");
assert(yesResult.action === "clarify", "yes asks for explicit selection");
assert(
  yesResult.message.includes("מספר") || yesResult.message.includes("שם התוכן"),
  "yes selection explains how to choose"
);

const numberResult = handlePlanningSourceRoutingReply(state, "2");
assert(numberResult.action === "selected", "number selects option");
assert(
  numberResult.action === "selected" && numberResult.option.contentId === "ABC-002",
  "number selects the matching numbered content"
);

const nameResult = handlePlanningSourceRoutingReply(state, "שמלה שלישית");
assert(nameResult.action === "selected", "name selects matching option");
assert(
  nameResult.action === "selected" && nameResult.option.contentId === "ABC-002",
  "name selects the matching content"
);

const noResult = handlePlanningSourceRoutingReply(state, "לא");
assert(noResult.action === "next_source", "no moves to next available source");
assert(
  noResult.action === "next_source" && noResult.state.activeSource === "nearReadyProduction",
  "no advances to near-ready source"
);

const noExistingState = createPlanningSourceRoutingState({
  signalMessage: "שבוע הבא חסר עוד פוסט אחד בגאנט.",
  missingContentType: "פוסט",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [],
});

const noExistingYes = handlePlanningSourceRoutingReply(noExistingState, "כן");
assert(noExistingYes.action === "new_idea", "yes on empty source explains how to start a new idea");
assert(noExistingYes.message.includes("פוסט חדש") || noExistingYes.message.includes("פוסט"), "empty post source stays post-specific");

const noExistingNo = handlePlanningSourceRoutingReply(noExistingState, "לא");
assert(noExistingNo.action === "cancelled", "no on empty source cancels new content flow");
assert(noExistingNo.message.includes("מה דחוף"), "empty source cancellation offers next actions");

const ideaBankState = createPlanningSourceRoutingState({
  signalMessage: "שבוע הבא חסר עוד ריל אחד בגאנט.",
  missingContentType: "ריל",
  approvedUnscheduled: [],
  nearReadyProduction: [],
  approvedNotStarted: [],
  ideaBank: [{ contentId: "IDEA-001", title: "רעיון מבנק" }],
});

const ideaBankSelection = handlePlanningSourceRoutingReply(ideaBankState, "1");
assert(ideaBankSelection.action === "selected", "idea bank number selects first idea");
assert(
  ideaBankSelection.action === "selected" && ideaBankSelection.source === "ideaBank",
  "idea bank selection exposes selected source"
);
assert(
  ideaBankSelection.message.includes("לפני שיבוץ בגאנט"),
  "idea bank selection does not jump directly to gantt date"
);
console.log("\nPlanning source routing scenarios passed.");
