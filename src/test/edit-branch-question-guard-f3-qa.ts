// Audit F3 QA — the edit branch in whatsapp.controller.ts must not swallow
// question-shaped messages when a draft is pending.
//
// Two layers of verification:
// 1) Source-level: the controller's edit-branch guard actually contains
//    !isQuestionLikeMessage (same style as the existing routing-audit tests).
// 2) Behavior-level: replicate the guard expression and verify routing on
//    the audit's concrete examples.
// Run: npx ts-node --transpile-only src/test/edit-branch-question-guard-f3-qa.ts

import { readFileSync } from "fs";
import path from "path";
import {
  isEditRequest,
  isArchiveCommand,
  isApproveForProductionCommand,
  isRestoreCommand,
} from "../services/confirmation.service";
import { isQuestionLikeMessage } from "../services/visibility.service";
import { isDeadlineUpdate, isProductionStatusUpdate } from "../services/production-status.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Layer 1: source-level guard check ---
const controllerSource = readFileSync(
  path.resolve(__dirname, "../controllers/whatsapp.controller.ts"),
  "utf-8"
);
const guardStart = controllerSource.indexOf("isEditRequest(incomingText) &&");
const guardBlock = guardStart >= 0 ? controllerSource.slice(guardStart, guardStart + 400) : "";
check(
  "controller edit-branch guard includes !isQuestionLikeMessage",
  guardBlock.includes("!isQuestionLikeMessage(incomingText)")
);

// --- Layer 2: behavior via the replicated guard expression ---
const entersEditBranch = (incomingText: string): boolean =>
  isEditRequest(incomingText) &&
  !isQuestionLikeMessage(incomingText) &&
  !isDeadlineUpdate(incomingText) &&
  !isProductionStatusUpdate(incomingText) &&
  !isArchiveCommand(incomingText) &&
  !isApproveForProductionCommand(incomingText) &&
  !isRestoreCommand(incomingText);

// Questions that used to be swallowed — must now fall through:
check('question falls through: "מה הסטטוס של הריל על קפריסין?"', entersEditBranch("מה הסטטוס של הריל על קפריסין?") === false);
check('question falls through: "איזה פוסט מתוכנן השבוע?"', entersEditBranch("איזה פוסט מתוכנן השבוע?") === false);
check('question falls through: "מה אני צריכה לצלם היום?"', entersEditBranch("מה אני צריכה לצלם היום?") === false);
check('question falls through: "תזכירי לי מה הטון של הרעיון?"', entersEditBranch("תזכירי לי מה הטון של הרעיון?") === false);
check('question falls through: "כמה רעיונות לריל יש לי?"', entersEditBranch("כמה רעיונות לריל יש לי?") === false);

// Genuine statement-form edits — must still enter the branch:
check('edit still enters: "תשני את הטון למצחיק"', entersEditBranch("תשני את הטון למצחיק") === true);
check('edit still enters: "עדיף שזה יהיה פוסט ולא ריל"', entersEditBranch("עדיף שזה יהיה פוסט ולא ריל") === true);
check('edit still enters: "תעדכני את הקטגוריה לרווקות"', entersEditBranch("תעדכני את הקטגוריה לרווקות") === true);
check('edit still enters: "אני רוצה שהסיכום יהיה קליל יותר"', entersEditBranch("אני רוצה שהסיכום יהיה קליל יותר") === true);

// Existing exclusions unchanged (regression):
check('archive command still excluded', entersEditBranch("תעבירי את שמלות כלה לארכיון, צריך החלטה") === false);
check('deadline command still excluded', entersEditBranch("תשני את הדדליין של קפריסין ל-18/6") === false);
check('status update still excluded', entersEditBranch("ערכתי את הסרטון של קפריסין") === false);

console.log(`\nF3 edit-branch question guard QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
