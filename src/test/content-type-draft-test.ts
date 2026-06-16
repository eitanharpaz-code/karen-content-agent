import {
  applyEditToDraft,
  displayContentType,
  parseEditRequest,
} from "../services/confirmation.service";
import type { DraftSummary } from "../types/content.types";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }

  console.log(`PASS: ${message}`);
};

const baseDraft: DraftSummary = {
  shortName: "בדיקת סוג תוכן",
  category: "כללי",
  tone: "הסברתי",
  priority: "בינוני",
  summary: "טיוטה לבדיקה",
  originalUserInput: "רעיון בדיקה",
};

const postEdit = parseEditRequest("זה פוסט");
assert(postEdit?.field === "contentType", "post content type edit is detected");
assert(postEdit?.value === "פוסט", "post content type value is parsed");

const updatedPost = applyEditToDraft(baseDraft, postEdit!);
assert(updatedPost.contentType === "פוסט", "post content type is applied to draft");

const reelEdit = parseEditRequest("סוג תוכן: ריל");
assert(reelEdit?.field === "contentType", "reel content type edit is detected");
assert(reelEdit?.value === "ריל", "reel content type value is parsed");

const storyEdit = parseEditRequest("זה סטורי");
assert(storyEdit?.field === "contentType", "story content type edit is detected");
assert(storyEdit?.value === "סטורי", "story content type value is parsed");

assert(displayContentType(undefined) === "ריל", "missing content type displays default reel");
assert(displayContentType("פוסט") === "פוסט", "existing content type displays as-is");

console.log("\nContent type draft scenarios passed.");
