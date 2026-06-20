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
  count("options.previewLine || \"הייתי שומרת את זה ככה:\"") === 1,
  "Expected default preview line to live only inside the helper."
);

assert(
  count("previewLine: \"עכשיו הייתי שומרת את זה ככה:\"") === 1,
  "Expected updated-draft preview line to be passed only as helper option."
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
