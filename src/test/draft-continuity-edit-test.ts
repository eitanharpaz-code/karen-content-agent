import {
  applyEditToDraft,
  parseEditRequest,
} from "../services/confirmation.service";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const baseDraft: any = {
  shortName: "טסט בדיקת באגים",
  category: "כללי",
  tone: "הסברתי",
  priority: "נמוך",
  contentType: "ריל",
  summary: "בדיקת רציפות שיחה",
  originalUserInput: "יש לי רעיון חדש לטסט",
};

console.log("Running draft continuity edit test...");

const contentTypeContinuation = parseEditRequest("ואת סוג התוכן לפוסט");

assert(
  contentTypeContinuation?.field === "contentType",
  `Expected content type continuation edit, got ${JSON.stringify(contentTypeContinuation)}`
);

assert(
  contentTypeContinuation?.value === "פוסט",
  `Expected content type value פוסט, got ${contentTypeContinuation?.value}`
);

const updatedDraft = applyEditToDraft(baseDraft, contentTypeContinuation!);

assert(
  updatedDraft.contentType === "פוסט",
  `Expected draft contentType to become פוסט, got ${updatedDraft.contentType}`
);

assert(
  updatedDraft.summary === baseDraft.summary,
  "Expected summary to remain unchanged when editing content type."
);

assert(
  updatedDraft.shortName === baseDraft.shortName,
  "Expected shortName to remain unchanged when editing content type."
);

const storyContinuation = parseEditRequest("וגם את סוג התוכן לסטורי");

assert(
  storyContinuation?.field === "contentType",
  `Expected story continuation content type edit, got ${JSON.stringify(storyContinuation)}`
);

assert(
  storyContinuation?.value === "סטורי",
  `Expected content type value סטורי, got ${storyContinuation?.value}`
);

const explicitReelEdit = parseEditRequest("תשני את סוג התוכן לריל");

assert(
  explicitReelEdit?.field === "contentType",
  `Expected explicit reel content type edit, got ${JSON.stringify(explicitReelEdit)}`
);

assert(
  explicitReelEdit?.value === "ריל",
  `Expected content type value ריל, got ${explicitReelEdit?.value}`
);

const toneContinuation = parseEditRequest("ואת הטון למצחיק");

assert(
  toneContinuation?.field === "tone",
  `Expected tone continuation edit, got ${JSON.stringify(toneContinuation)}`
);

assert(
  toneContinuation?.value === "מצחיק",
  `Expected tone value מצחיק, got ${toneContinuation?.value}`
);

const priorityContinuation = parseEditRequest("ואת העדיפות לגבוהה");

assert(
  priorityContinuation?.field === "priority",
  `Expected priority continuation edit, got ${JSON.stringify(priorityContinuation)}`
);

assert(
  priorityContinuation?.value === "גבוה",
  `Expected priority value גבוה, got ${priorityContinuation?.value}`
);

const summaryContinuation = parseEditRequest("ואת הכיוון לצבע ירוק");

assert(
  summaryContinuation?.field === "summary",
  `Expected summary continuation edit, got ${JSON.stringify(summaryContinuation)}`
);

assert(
  summaryContinuation?.value === "צבע ירוק",
  `Expected summary value צבע ירוק, got ${summaryContinuation?.value}`
);

console.log("✅ draft-continuity-edit-test passed");
