// Humanizer consolidation QA — the draft-preview wrapping copy (intro /
// closing question / change line) is now generated inside the SAME Claude
// call that creates or edits the draft, instead of a separate Sonnet call
// to humanizeDraftPreview. This saves a full Sonnet round-trip on every new
// idea and every AI edit.
//
// Layers:
// 1) Unit: parsePreviewCopy extracts the three lines and falls back to the
//    mode-appropriate defaults on any miss.
// 2) Source: both prompts in content.service.ts request the three fields,
//    and the controller keeps exactly ONE humanizeDraftPreview call (the
//    hardcoded-edit path, where no other Claude call exists to merge into).
// Run: npx ts-node --transpile-only src/test/humanizer-consolidation-qa.ts

import { readFileSync } from "fs";
import path from "path";
import { parsePreviewCopy } from "../services/content.service";
import {
  DEFAULT_NEW_DRAFT_COPY,
  DEFAULT_EDIT_COPY,
} from "../services/response-humanizer.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Layer 1: parsePreviewCopy unit tests ---
const fullResponse = [
  "Short Name: נאום החתן",
  "Category: חתונה",
  "Tone: מצחיק",
  "Priority: בינוני",
  "Content Type: ריל",
  "Summary: סרטון קליל על מה לא להגיד בנאום.",
  "Intro: אני אוהבת את הזווית",
  "ClosingQuestion: לשים בבנק?",
  "ChangeLine: פתוחה לשינויים אם בא לך",
].join("\n");

const parsed = parsePreviewCopy(fullResponse, "new");
check("parses Intro from full response", parsed.intro === "אני אוהבת את הזווית");
check("parses ClosingQuestion from full response", parsed.closingQuestion === "לשים בבנק?");
check("parses ChangeLine from full response", parsed.changeLine === "פתוחה לשינויים אם בא לך");

const noCopyResponse = "Short Name: משהו\nSummary: בלי שורות עטיפה בכלל";
const fallbackNew = parsePreviewCopy(noCopyResponse, "new");
check("missing lines fall back to NEW defaults", fallbackNew.intro === DEFAULT_NEW_DRAFT_COPY.intro && fallbackNew.closingQuestion === DEFAULT_NEW_DRAFT_COPY.closingQuestion);
const fallbackEdit = parsePreviewCopy(noCopyResponse, "edit");
check("missing lines fall back to EDIT defaults", fallbackEdit.intro === DEFAULT_EDIT_COPY.intro && fallbackEdit.changeLine === DEFAULT_EDIT_COPY.changeLine);

const partialResponse = fullResponse.replace("ClosingQuestion: לשים בבנק?\n", "");
const partial = parsePreviewCopy(partialResponse, "new");
check("partial parse: present lines kept, missing line defaulted", partial.intro === "אני אוהבת את הזווית" && partial.closingQuestion === DEFAULT_NEW_DRAFT_COPY.closingQuestion);

// --- Layer 2: source-level checks ---
const contentSource = readFileSync(path.resolve(__dirname, "../services/content.service.ts"), "utf-8");
const introFieldCount = (contentSource.match(/Intro: \[/g) || []).length;
const controllerSourceOrHumanizer = readFileSync(path.resolve(__dirname, "../services/response-humanizer.service.ts"), "utf-8");
check("wrapper copy is fixed, not generated", controllerSourceOrHumanizer.includes("USE_FIXED_PREVIEW_COPY"));
check("both return paths attach previewCopy", (contentSource.match(/previewCopy: parsePreviewCopy\(/g) || []).length === 2);

const controllerSource = readFileSync(path.resolve(__dirname, "../controllers/whatsapp.controller.ts"), "utf-8");
const humanizerCalls = (controllerSource.match(/humanizeDraftPreview\(/g) || []).length;
check("controller keeps exactly ONE humanizeDraftPreview call (hardcoded-edit path)", humanizerCalls === 1);
check("new-draft flow uses draft.previewCopy with default fallback", controllerSource.includes("draft.previewCopy ?? DEFAULT_NEW_DRAFT_COPY"));
check("AI-edit flows use aiEditedDraft.previewCopy with default fallback", (controllerSource.match(/aiEditedDraft\.previewCopy \?\? DEFAULT_EDIT_COPY/g) || []).length === 2);

console.log(`\nHumanizer consolidation QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
