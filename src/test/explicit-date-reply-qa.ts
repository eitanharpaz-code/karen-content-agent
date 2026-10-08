import { extractExplicitDateFromReply } from "../services/confirmation.service";

let passed = 0, failed = 0;
const check = (label: string, got: string | null, want: string | null) => {
  if (got === want) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label} — got ${got}, want ${want}`); }
};

check("explicit ב-20/8", extractExplicitDateFromReply("תכניס אותו ב20/8"), "20/08/2026");
check("with slash date", extractExplicitDateFromReply("תכניס אותו ב-4/8"), "04/08/2026");
check("full date", extractExplicitDateFromReply("שבצי ל-15/09/2026"), "15/09/2026");
check("plain yes → null", extractExplicitDateFromReply("כן"), null);
check("keep → null", extractExplicitDateFromReply("להשאיר בלי תאריך"), null);
check("empty → null", extractExplicitDateFromReply(""), null);

console.log(`\nExplicit-date-reply QA: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
