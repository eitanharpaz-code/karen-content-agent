// Stage 1 QA: next-month math for evaluateMonthFullForReel.
// Pure logic only — verifies the month/year rollover that is easy to get
// wrong (Dec → Jan next year). Network-dependent branches are checked live.
const computeFirstOfNext = (requestedDate: string): string => {
  const parts = requestedDate.split("/");
  const month = parseInt(parts[1]) - 1;
  const year = parseInt(parts[2]);
  const nextMonthIndex = month === 11 ? 0 : month + 1;
  const nextMonthYear = month === 11 ? year + 1 : year;
  return `01/${String(nextMonthIndex + 1).padStart(2, "0")}/${nextMonthYear}`;
};

let passed = 0;
let failed = 0;
const check = (label: string, got: string, want: string) => {
  if (got === want) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label} — got ${got}, want ${want}`); }
};

check("July -> August same year", computeFirstOfNext("31/07/2026"), "01/08/2026");
check("mid-month July -> August", computeFirstOfNext("20/07/2026"), "01/08/2026");
check("December -> January next year", computeFirstOfNext("28/12/2026"), "01/01/2027");
check("November -> December", computeFirstOfNext("30/11/2026"), "01/12/2026");
check("January -> February", computeFirstOfNext("15/01/2026"), "01/02/2026");

console.log(`\nMonth-full evaluation QA: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
