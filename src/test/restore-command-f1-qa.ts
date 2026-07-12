// Audit F1 QA — isRestoreCommand must require an explicit archive-context
// word (ארכיון / רעיונות / בצד). The generic "את" no longer qualifies, so
// draft-edit phrases like "תחזירי את הטון הקודם" are not hijacked as
// archive-restore commands (directly or via the modal escape hatches).
// Run: npx ts-node --transpile-only src/test/restore-command-f1-qa.ts

import { isRestoreCommand } from "../services/confirmation.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- Must still be detected as restore (real archive intent) ---
check('restore: "תחזירי את X מהארכיון"', isRestoreCommand("תחזירי את שמלות כלה מהארכיון") === true);
check('restore: "תוציאי את X מהארכיון"', isRestoreCommand("תוציאי את קפריסין מהארכיון") === true);
check('restore: "תחזרי את X לרעיונות"', isRestoreCommand("תחזרי את הסרטון של החתונה לרעיונות") === true);
check('restore: "תחזירי את מה ששמנו בצד"', isRestoreCommand("תחזירי את מה ששמנו בצד") === true);

// --- Must NOT be detected as restore (the F1 hijack cases) ---
check('not restore: "תחזירי את הטון הקודם"', isRestoreCommand("תחזירי את הטון הקודם") === false);
check('not restore: "תחזירי את מה שהיה קודם"', isRestoreCommand("תחזירי את מה שהיה קודם") === false);
check('not restore: "תחזירי את השם המקורי"', isRestoreCommand("תחזירי את השם המקורי") === false);
check('not restore: "תוציאי את המילה הזאת מהסיכום"', isRestoreCommand("תוציאי את המילה הזאת מהסיכום") === false);
check('not restore: "תחזיר את העדיפות לגבוה"', isRestoreCommand("תחזיר את העדיפות לגבוה") === false);

// --- Sanity: unrelated messages stay negative ---
check('not restore: plain new idea', isRestoreCommand("יש לי רעיון לסרטון על נאום החתן") === false);
check('not restore: status question', isRestoreCommand("מה הסטטוס של קפריסין?") === false);

console.log(`\nF1 restore-command QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
