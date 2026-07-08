import dotenv from "dotenv";

dotenv.config();

const { humanizeBrief } = require("../services/brief-humanizer.service");

const grade = { passed: 0, failed: 0, notes: [] as string[] };

const assert = (label: string, condition: boolean, detail?: string) => {
  if (condition) {
    grade.passed++;
    console.log(`  ✅ ${label}`);
  } else {
    grade.failed++;
    grade.notes.push(`FAIL: ${label}${detail ? " — " + detail : ""}`);
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  }
};

// A realistic deterministic morning brief with all the structural markers
// the humanizer must preserve (starred headers, bullet lines, CTAs).
const SAMPLE_MORNING_BRIEF = `בוקר טוב קרן :)
בריף בוקר קצר, רק כדי לשים פוקוס על היום.

*דורש תשומת לב עכשיו*
* שמלה קיצית לחתונה — חסר צילום
* טרנד קפריסין בקיץ — חסר עריכה

*פוקוס להיום*
* לצלם את "שמלה קיצית לחתונה" עד סוף היום

*ברקע*
בשבוע הבא יש רק ריל אחד מתוכנן — הגאנט יחסית ריק.
אפשר לכתוב: בואי נשלים את השבוע

*אפשר לענות*
* צילמתי את שמלה קיצית לחתונה
* בואי נשלים את השבוע`;

const SAMPLE_AFTERNOON_BRIEF = `היי קרן, תזכורת קטנה :)

הדבר שהכי יקדם אותך עכשיו:
* לערוך את "טרנד קפריסין בקיץ"

כשסיימת, אפשר לכתוב:
* ערכתי את טרנד קפריסין בקיץ`;

const main = async () => {
  console.log("=== Brief Humanizer QA ===\n");

  // ---- Empty brief → passthrough ----
  console.log("Test 1: Empty/blank brief returns as-is");
  const emptyResult = await humanizeBrief("", "morning");
  assert("Empty input → empty output", emptyResult === "");

  const blankResult = await humanizeBrief("   ", "morning");
  assert("Blank input → same output", blankResult === "   ");

  // ---- Morning brief: humanized but preserves key elements ----
  console.log("\nTest 2: Morning brief preserves content names, CTAs, and section headers");
  const morningHumanized = await humanizeBrief(SAMPLE_MORNING_BRIEF, "morning");
  console.log(`\n    ORIGINAL:\n${SAMPLE_MORNING_BRIEF.split("\n").map((l: string) => "      " + l).join("\n")}\n`);
  console.log(`    HUMANIZED:\n${morningHumanized.split("\n").map((l: string) => "      " + l).join("\n")}\n`);

  assert(
    "Content name 'שמלה קיצית לחתונה' preserved",
    morningHumanized.includes("שמלה קיצית לחתונה")
  );
  assert(
    "Content name 'טרנד קפריסין בקיץ' preserved",
    morningHumanized.includes("טרנד קפריסין בקיץ")
  );
  assert(
    "CTA 'בואי נשלים את השבוע' preserved verbatim",
    morningHumanized.includes("בואי נשלים את השבוע")
  );
  assert(
    "Section header with * still present (*פוקוס*, *ברקע*, etc.)",
    /\*[^*]+\*/.test(morningHumanized)
  );
  assert(
    "Humanized brief is not identical to input (something changed)",
    morningHumanized !== SAMPLE_MORNING_BRIEF
  );

  // ---- Afternoon brief: same expectations ----
  console.log("Test 3: Afternoon brief preserves content name and CTA");
  const afternoonHumanized = await humanizeBrief(SAMPLE_AFTERNOON_BRIEF, "afternoon");
  console.log(`\n    ORIGINAL:\n${SAMPLE_AFTERNOON_BRIEF.split("\n").map((l: string) => "      " + l).join("\n")}\n`);
  console.log(`    HUMANIZED:\n${afternoonHumanized.split("\n").map((l: string) => "      " + l).join("\n")}\n`);

  assert(
    "Content name 'טרנד קפריסין בקיץ' preserved in afternoon brief",
    afternoonHumanized.includes("טרנד קפריסין בקיץ")
  );
  assert(
    "CTA 'ערכתי את טרנד קפריסין בקיץ' preserved verbatim",
    afternoonHumanized.includes("ערכתי את טרנד קפריסין בקיץ")
  );
  // Note: Claude may sometimes return the afternoon brief unchanged if it
  // decides the source is already in a good voice — that's an acceptable
  // conservative outcome. We only assert that the facts are preserved.
  if (afternoonHumanized === SAMPLE_AFTERNOON_BRIEF) {
    console.log(
      "  ⚠️  Claude returned the afternoon brief unchanged (acceptable — short brief, already conversational)."
    );
  }

  // ---- Variety across two calls ----
  console.log("Test 4: Two runs produce different output (or at least not verbatim identical)");
  const morning2 = await humanizeBrief(SAMPLE_MORNING_BRIEF, "morning");
  assert(
    "Two humanization runs produce SOME variation (or at least differ from source)",
    morning2 !== SAMPLE_MORNING_BRIEF && morningHumanized !== SAMPLE_MORNING_BRIEF
  );

  // ---- Length sanity: humanized brief within safe bounds of original ----
  console.log("Test 5: Humanized brief length is within safe bounds");
  assert(
    "Morning humanized brief is not runaway-long (< 2.5x source)",
    morningHumanized.length <= SAMPLE_MORNING_BRIEF.length * 2.5
  );
  assert(
    "Morning humanized brief is not truncated (>= 0.4x source)",
    morningHumanized.length >= SAMPLE_MORNING_BRIEF.length * 0.4
  );

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${grade.passed}`);
  console.log(`Failed: ${grade.failed}`);
  if (grade.notes.length) {
    console.log(`Failures:`);
    grade.notes.forEach((n) => console.log(`  - ${n}`));
  }

  process.exit(grade.failed === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error("QA runner crashed:", err);
  process.exit(1);
});
