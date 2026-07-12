// Audit F4 QA — ambiguous standalone status tokens removed from
// STATUS_MAPPINGS: "יצא" (uploaded), "קלטתי" (filmed), "הקאבר" (cover_ready).
// Everyday messages containing these words must no longer be detected as
// production status updates, while all unambiguous status phrasings must
// keep working exactly as before.
// Run: npx ts-node --transpile-only src/test/status-tokens-f4-qa.ts

import { detectStatusUpdate, isProductionStatusUpdate } from "../services/production-status.service";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
};

// --- The F4 hijack cases: must NOT be detected as status updates ---
check('not status: "יצא לי רעיון מהחתונה של אחותי"', isProductionStatusUpdate("יצא לי רעיון מהחתונה של אחותי") === false);
check('not status: "יצא מעולה הסיכום הזה"', isProductionStatusUpdate("יצא מעולה הסיכום הזה") === false);
check('not status: "קלטתי, אז מה עושים מחר?"', isProductionStatusUpdate("קלטתי, אז מה עושים מחר?") === false);
check('not status: "הקאבר של קפריסין עדיין אצל המעצבת"', isProductionStatusUpdate("הקאבר של קפריסין עדיין אצל המעצבת") === false);
check('not status: "מה קורה עם הקאבר?"', isProductionStatusUpdate("מה קורה עם הקאבר?") === false);

// --- Unambiguous phrasings: must still be detected, with correct type ---
const filmed = detectStatusUpdate("צילמתי את הסרטון של קפריסין");
check('status filmed: "צילמתי את הסרטון של קפריסין"', filmed?.statusType === "filmed");

const filmedLong = detectStatusUpdate("סיימתי לצלם את שמלות כלה");
check('status filmed: "סיימתי לצלם את שמלות כלה"', filmedLong?.statusType === "filmed");

const edited = detectStatusUpdate("ערכתי את הסרטון של רווקות");
check('status edited: "ערכתי את הסרטון של רווקות"', edited?.statusType === "edited");

const cover = detectStatusUpdate("הקאבר מוכן לסרטון של קפריסין");
check('status cover_ready: "הקאבר מוכן לסרטון של קפריסין"', cover?.statusType === "cover_ready");

const coverShort = detectStatusUpdate("סיימתי קאבר לשמלות כלה");
check('status cover_ready: "סיימתי קאבר לשמלות כלה"', coverShort?.statusType === "cover_ready");

const uploaded = detectStatusUpdate("העליתי את הסרטון של קפריסין");
check('status uploaded: "העליתי את הסרטון של קפריסין"', uploaded?.statusTypes.includes("uploaded") === true);

const uploadedAir = detectStatusUpdate("הסרטון של רווקות יצא לאוויר");
check('status uploaded: "הסרטון של רווקות יצא לאוויר" (multi-token pattern survives)', uploadedAir?.statusTypes.includes("uploaded") === true);

const published = detectStatusUpdate("פרסמתי את שמלות כלה");
check('status uploaded: "פרסמתי את שמלות כלה"', published?.statusTypes.includes("uploaded") === true);

console.log(`\nF4 status-tokens QA: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
