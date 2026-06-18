declare const require: any;
const { readFileSync } = require("fs");

const controller = readFileSync("src/controllers/whatsapp.controller.ts", "utf8");
const sheets = readFileSync("src/services/sheets.service.ts", "utf8");

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

assert(controller.includes('questionType: "gantt_write_new_date"'), "planning flow creates gantt_write_new_date pending state");
assert(controller.includes('status: "planning_source_routing_date_suggested"'), "planning flow suggests a date after source selection");
assert(controller.includes('status: "gantt_write_new_date_rejected_date"'), "gantt date rejection keeps scheduling flow open");
assert(controller.includes('"תוכן אחר"'), "gantt date flow supports choosing another content");
assert(controller.includes("await addRowToGantt("), "gantt date flow writes through addRowToGantt");
assert(controller.includes('questionType: "gantt_upload_time"'), "gantt date flow asks for upload time after write");
assert(controller.includes('pendingDraft.contentType || "ריל"'), "fastlane passes content type when saving approved content");

assert(sheets.includes('contentType: string = "ריל"'), "saveFastTrackContent accepts content type");
const fastTrackStart = sheets.indexOf("export const saveFastTrackContent");
const fastTrackEnd = sheets.indexOf("// Fast Track", fastTrackStart + 1);
const fastTrackBlock = sheets.slice(
  fastTrackStart,
  fastTrackEnd === -1 ? undefined : fastTrackEnd
);

assert(fastTrackBlock.includes('contentType || "ריל"'), "saveFastTrackContent writes content type fallback");
assert(sheets.includes('contentType || "ריל", // E - סוג תוכן'), "addRowToGantt writes approved content type to gantt");

console.log("Gantt scheduling flow audit passed.");
