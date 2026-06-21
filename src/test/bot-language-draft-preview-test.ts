declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const controllerPath = path.join(
  process.cwd(),
  "src/controllers/whatsapp.controller.ts"
);

const source = fs.readFileSync(controllerPath, "utf8");

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const count = (needle: string): number =>
  source.split(needle).length - 1;

console.log("Running bot language draft preview static test...");

assert(
  source.includes("const buildDraftPreviewMessage ="),
  "Expected buildDraftPreviewMessage helper to exist."
);

assert(
  count("buildDraftPreviewMessage(") >= 5,
  "Expected draft preview helper to be used in the main draft flows."
);

assert(
  source.includes("const replyText = buildDraftPreviewMessage(trendDraft, {"),
  "Expected trend draft preview to use draft preview helper."
);

assert(
  !source.includes("מעולה, הטרנד נשמר."),
  "Trend draft preview should not say it was saved before confirmation."
);

assert(
  source.includes("לא בטוחה איזה טרנד רצית לשמור."),
  "Expected softer trend missing-text message."
);

assert(
  !source.includes("לא בטוחה שהבנתי איזה טרנד התכוונת."),
  "Old trend missing-text message should not remain."
);

assert(
  source.includes("כדי לפתוח רעיון חדש, תשלחי לי למשל:"),
  "Expected softer new-idea missing-text message."
);

assert(
  !source.includes("רוצה לפתוח רעיון חדש?\\nתשלחי לי:"),
  "Old new-idea missing-text message should not remain."
);

assert(
  source.includes("מספר פנימי: ${contentId}"),
  "Expected content library save confirmation to use softer internal-id label."
);

assert(
  source.includes("בשלב הזה הוא נשאר כרעיון פתוח, ועדיין לא נכנס להפקה."),
  "Expected content library save confirmation to explain idea status softly."
);

assert(
  !source.includes("כרגע זה עדיין רעיון, לא משימת הפקה."),
  "Old technical idea-vs-production wording should not remain."
);

assert(
  count("options.previewLine || \"ככה הייתי שומרת את זה כרגע:\"") === 1,
  "Expected updated default preview line to live only inside the helper."
);

assert(
  source.includes("previewLine: \"ככה הייתי שומרת את זה עכשיו:\""),
  "Expected updated-draft preview line to be passed through helper options."
);

assert(
  source.includes("options.changeLine || \"אפשר גם להגיד לי מה לשנות.\""),
  "Expected default change line to use softer helper copy."
);

assert(
  source.includes("changeLine: \"אפשר גם להגיד לי מה עוד לשנות.\""),
  "Expected updated-draft change line to use softer copy."
);

assert(
  source.includes("const shouldIncludeContentType = options.includeContentType ?? true;"),
  "Expected content type to be shown by default when draft.contentType exists."
);

assert(
  !source.includes("if (options.includeContentType && draft.contentType)"),
  "Content type should not require includeContentType=true to be shown."
);

assert(
  !source.includes("שם: ${draft.shortName}\nקטגוריה: ${categoryText}\nטון: ${toneText}\nעדיפות: ${priorityText}"),
  "Old duplicated draft template for draft.shortName still exists."
);

assert(
  !source.includes("שם: ${draftSummary.shortName}\nקטגוריה: ${categoryText}\nסוג תוכן: ${contentTypeText}"),
  "Old duplicated new-idea draft template still exists."
);

assert(
  !source.includes("שם: ${updatedDraft.shortName}\nקטגוריה: ${updatedCategoryText}"),
  "Old duplicated updated-draft template still exists."
);

console.log("✅ bot-language-draft-preview-test passed");
