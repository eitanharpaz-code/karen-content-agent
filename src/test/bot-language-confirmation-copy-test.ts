declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const controllerSource = fs.readFileSync(
  path.join(process.cwd(), "src/controllers/whatsapp.controller.ts"),
  "utf8"
);

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log("Running bot language confirmation copy test...");

assert(
  controllerSource.includes("סבבה, לא שמרתי את זה."),
  "Duplicate rejection copy should feel natural and not technical."
);

assert(
  !controllerSource.includes("לא שמרתי את הרעיון הכפול."),
  "Old duplicate rejection copy should not remain."
);

assert(
  controllerSource.includes("איבדתי רגע את ההקשר של הרעיון. תשלחי אותו שוב ונמשיך."),
  "Context-missing copy should explain the problem naturally."
);

assert(
  !controllerSource.includes("משהו השתבש, נסי שוב."),
  "Generic error copy should not remain in draft confirmation flows."
);

assert(
  controllerSource.includes("מספר פנימי: ${contentId}"),
  "Saved-content confirmation should use softer internal-id wording."
);

assert(
  !controllerSource.includes("\\nID: ${contentId}"),
  "Saved-content confirmation should not expose raw ID label."
);

assert(
  controllerSource.includes("רוצה לשמור גם את הרעיון החדש?"),
  "Duplicate-found copy should ask naturally whether to keep the new idea."
);

assert(
  !controllerSource.includes("רוצה לשמור בכל זאת?"),
  "Old duplicate-found copy should not remain."
);

assert(
  !controllerSource.includes('..." (${similar.contentId})'),
  "Duplicate-found copy should not show technical content id to Karen."
);

assert(
  controllerSource.includes("קיבלתי את האישור, אבל השמירה לא הצליחה. תנסי שוב עוד רגע."),
  "Save failure should sound natural and clear."
);

assert(
  !controllerSource.includes("אישור התקבל אבל קרתה שגיאה בשמירה. אנא נסי שוב."),
  "Old save-failure copy should not remain."
);

assert(
  controllerSource.includes("לא הצלחתי לעדכן את הסטטוס כרגע. תנסי שוב עוד רגע."),
  "Status update failure should be natural."
);

assert(
  controllerSource.includes("לא הצלחתי להשלים את זה כרגע. תנסי שוב עוד רגע."),
  "General fallback error should be natural."
);

console.log("✅ bot-language-confirmation-copy-test passed");
