import dotenv from "dotenv";
import { handleWhatsAppWebhook } from "../controllers/whatsapp.controller";
import { Request, Response } from "express";

// Test isolation (23.7.2026): these suites drive the real webhook, so state
// left behind by a previous run used to swallow every message in the next one.
// Clearing the test sender before starting makes each run independent.
import { clearPendingQuestion, clearPendingConfirmation } from "../services/confirmation.service";

// Live-write guard (23.7.2026): these suites drive the real webhook and
// therefore write real rows to Karen's sheet. Same protection the sprint
// suites already use, so a blanket "run everything" loop cannot dirty it.
if (process.env.ALLOW_LIVE_QA !== "true") {
  console.log(
    "\nThis QA writes to the real Google Sheet.\n" +
    "Run it explicitly with:\n" +
    "  ALLOW_LIVE_QA=true npx ts-node --transpile-only " + __filename.replace(process.cwd() + "/", "") + "\n"
  );
  process.exit(0);
}

const TEST_SENDERS = ["whatsapp:+1234567890", "whatsapp:+9999999999"];
const resetTestState = () => {
  for (const s of TEST_SENDERS) {
    try { clearPendingQuestion(s); } catch {}
    try { clearPendingConfirmation(s); } catch {}
  }
};


dotenv.config();

// Mock Express objects for testing
const createMockRequest = (body: any): Request => ({
  body,
} as Request);

const createMockResponse = (): Response & { statusCode: number; responseData: any } => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.responseData = data;
    return res;
  };
  return res;
};

const main = async () => {
  resetTestState();
  try {
    console.log("Draft Edit Flow QA Test\n");

    // Test 1: Create content idea draft
    const testMessage = "יש לי רעיון לסרטון על חתונה אזרחית בקפריסין";
    console.log(`Step 1 - User sends content idea: "${testMessage}"`);

    const req1 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: testMessage,
    });
    const res1 = createMockResponse();

    // Mock the WhatsApp service to avoid sending real messages
    const whatsappService = require("../services/whatsapp.service");
    const originalSendWhatsAppMessage = whatsappService.sendWhatsAppMessage;
    whatsappService.sendWhatsAppMessage = async (to: string, message: string) => {
      console.log(`\n[Mock WhatsApp] Would send to ${to}:\n${message}\n`);
    };

    await handleWhatsAppWebhook(req1, res1);

    console.log(`Step 1 Result: ${res1.responseData.status}`);
    console.log(`Draft created: ${!!res1.responseData.draft}\n`);

    // Test 2: User requests an unsupported edit phrase first
    console.log("Step 2 - User requests a fuzzy edit: 'תשני את זה' (should keep draft session alive)");

    const req2 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "תשני את זה",
    });
    const res2 = createMockResponse();

    await handleWhatsAppWebhook(req2, res2);

    console.log(`Step 2 Result: ${res2.responseData.status}`);
    console.log(`Draft still exists after failed edit: ${!!res2.responseData.draft}`);
    console.log(`Message: ${res2.responseData.status === "edit_not_understood" ? "failed edit prompt returned" : "unexpected"}\n`);

    // Test 3: User retries with a supported tone edit phrase
    console.log("Step 3 - User requests edit: 'תשני את הטון להומוריסטי'");

    const req3 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "תשני את הטון להומוריסטי",
    });
    const res3 = createMockResponse();

    await handleWhatsAppWebhook(req3, res3);

    console.log(`Step 3 Result: ${res3.responseData.status}`);
    console.log(`Draft updated: ${!!res3.responseData.draft}`);
    if (res3.responseData.draft) {
      console.log(`Updated tone: ${res3.responseData.draft.tone}\n`);
    }

    // Test 4: User applies another edit in the same session
    console.log("Step 4 - User requests edit: 'תשנה את הקטגוריה לחתונה'");

    const req4 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "תשנה את הקטגוריה לחתונה",
    });
    const res4 = createMockResponse();

    await handleWhatsAppWebhook(req4, res4);

    console.log(`Step 4 Result: ${res4.responseData.status}`);
    console.log(`Draft updated: ${!!res4.responseData.draft}`);
    if (res4.responseData.draft) {
      console.log(`Updated category: ${res4.responseData.draft.category}\n`);
    }

    // Test 5: User confirms the updated draft
    console.log("Step 5 - User confirms: 'כן'");

    const req5 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "כן",
    });
    const res5 = createMockResponse();

    await handleWhatsAppWebhook(req5, res5);

    console.log(`Step 5 Result: ${res5.responseData.status}`);
    console.log(`Content ID: ${res5.responseData.contentId}`);
    console.log(`Task creation failed: ${res5.responseData.taskCreationFailed}\n`);

    // Verify the complete flow
    if (res5.responseData.status === "confirmed_and_saved") {
      console.log("✅ Draft Edit Flow QA PASSED");
      console.log(`   - Content ID: ${res5.responseData.contentId}`);
      console.log("   - Draft was edited before confirmation");
      console.log("   - Content saved to Google Sheets");
    } else {
      console.log("❌ Draft Edit Flow QA FAILED");
      console.log(`   Got: ${res5.responseData.status}`);
    }

    // ===== Summary Edit Tests =====
    console.log("\n" + "=".repeat(60));
    console.log("Summary Edit Tests");
    console.log("=".repeat(60) + "\n");

    // Test 6a: Create a fresh draft for summary tests
    console.log("Test 6a - Create fresh draft for summary editing");
    const req6a = createMockRequest({
      From: "whatsapp:+1234567891",
      Body: "רעיון חדש: סרטון על שמלות כלה",
    });
    const res6a = createMockResponse();
    await handleWhatsAppWebhook(req6a, res6a);
    console.log(`Status: ${res6a.responseData.status}`);
    console.log(`Draft created: ${!!res6a.responseData.draft}`);
    const originalSummary = res6a.responseData.draft?.summary;
    console.log(`Original summary: "${originalSummary}"\n`);

    // Test 6b: Update summary with pattern "תשנה את הסיכום ל:"
    console.log("Test 6b - Update summary: 'תשנה את הסיכום ל: סרטון על זה שכולם אומרים שתקופת האירוסין היא הכי כיפית'");
    const newSummary1 = "סרטון על זה שכולם אומרים שתקופת האירוסין היא הכי כיפית";
    const req6b = createMockRequest({
      From: "whatsapp:+1234567891",
      Body: `תשנה את הסיכום ל: ${newSummary1}`,
    });
    const res6b = createMockResponse();
    await handleWhatsAppWebhook(req6b, res6b);
    console.log(`Status: ${res6b.responseData.status}`);
    console.log(`Draft updated: ${!!res6b.responseData.draft}`);
    if (res6b.responseData.draft) {
      console.log(`Updated summary: "${res6b.responseData.draft.summary}"`);
      console.log(`Summary changed: ${res6b.responseData.draft.summary === newSummary1 ? "✅ YES" : "❌ NO"}`);
      console.log(`Other fields unchanged: shortName=${res6b.responseData.draft.shortName}, category=${res6b.responseData.draft.category}\n`);
    }

    // Test 6c: Update summary with pattern "בסיכום תכתוב:"
    console.log("Test 6c - Update summary: 'בסיכום תכתוב: סרטון מהזווית של איתן'");
    const newSummary2 = "סרטון מהזווית של איתן";
    const req6c = createMockRequest({
      From: "whatsapp:+1234567891",
      Body: `בסיכום תכתוב: ${newSummary2}`,
    });
    const res6c = createMockResponse();
    await handleWhatsAppWebhook(req6c, res6c);
    console.log(`Status: ${res6c.responseData.status}`);
    console.log(`Draft updated: ${!!res6c.responseData.draft}`);
    if (res6c.responseData.draft) {
      console.log(`Updated summary: "${res6c.responseData.draft.summary}"`);
      console.log(`Summary changed: ${res6c.responseData.draft.summary === newSummary2 ? "✅ YES" : "❌ NO"}`);
      console.log(`Other fields unchanged: shortName=${res6c.responseData.draft.shortName}, category=${res6c.responseData.draft.category}\n`);
    }

    // Test 6d: Verify all existing editable fields still work
    console.log("Test 6d - Verify short name edit still works");
    const req6d = createMockRequest({
      From: "whatsapp:+1234567891",
      Body: "תשנה את השם לשמלה מיוחדת",
    });
    const res6d = createMockResponse();
    await handleWhatsAppWebhook(req6d, res6d);
    console.log(`Status: ${res6d.responseData.status}`);
    if (res6d.responseData.draft) {
      console.log(`Short name updated: ${res6d.responseData.draft.shortName === "שמלה מיוחדת" ? "✅ YES" : "❌ NO"}`);
      console.log(`Summary preserved: ${res6d.responseData.draft.summary === newSummary2 ? "✅ YES" : "❌ NO"}\n`);
    }

    // Test 6e: Verify priority and tone edits still work
    console.log("Test 6e - Verify priority edit still works");
    const req6e = createMockRequest({
      From: "whatsapp:+1234567891",
      Body: "תשנה את העדיפות לגבוהה",
    });
    const res6e = createMockResponse();
    await handleWhatsAppWebhook(req6e, res6e);
    console.log(`Status: ${res6e.responseData.status}`);
    if (res6e.responseData.draft) {
      console.log(`Priority updated: ${res6e.responseData.draft.priority === "גבוה" ? "✅ YES" : "❌ NO"}`);
      console.log(`Summary preserved: ${res6e.responseData.draft.summary === newSummary2 ? "✅ YES" : "❌ NO"}\n`);
    }

    // Summary of results
    console.log("=".repeat(60));
    console.log("Summary Edit QA Results");
    console.log("=".repeat(60));
    const allPassed = 
      res5.responseData.status === "confirmed_and_saved" &&
      res6b.responseData.status === "draft_updated" &&
      res6c.responseData.status === "draft_updated" &&
      res6d.responseData.status === "draft_updated" &&
      res6e.responseData.status === "draft_updated" &&
      res6b.responseData.draft?.summary === newSummary1 &&
      res6c.responseData.draft?.summary === newSummary2 &&
      res6d.responseData.draft?.shortName === "שמלה מיוחדת" &&
      res6d.responseData.draft?.summary === newSummary2 &&
      res6e.responseData.draft?.priority === "גבוה" &&
      res6e.responseData.draft?.summary === newSummary2;
    
    // ===== Field Precedence Regression Tests =====
    console.log("\n" + "=".repeat(60));
    console.log("Field Precedence Regression Tests");
    console.log("=".repeat(60) + "\n");

    // Test 7a: Summary contains tone word - should not change tone
    console.log("Test 7a - Summary edit with tone word inside value");
    const req7a = createMockRequest({
      From: "whatsapp:+1234567892",
      Body: "יש לי רעיון לסרטון על חתונה אזרחית בקפריסין",
    });
    const res7a = createMockResponse();
    await handleWhatsAppWebhook(req7a, res7a);
    console.log(`Initial draft - tone: ${res7a.responseData.draft?.tone}`);

    const req7a2 = createMockRequest({
      From: "whatsapp:+1234567892",
      Body: "תשנה את הסיכום ל: סרטון קליל ומצחיק על חתונה עם עדיפות לרגעים אותנטיים",
    });
    const res7a2 = createMockResponse();
    await handleWhatsAppWebhook(req7a2, res7a2);
    console.log(`After summary edit:`);
    console.log(`  Summary changed: ${res7a2.responseData.draft?.summary?.includes("קליל ומצחיק") ? "✅ YES" : "❌ NO"}`);
    console.log(`  Tone unchanged: ${res7a2.responseData.draft?.tone === res7a.responseData.draft?.tone ? "✅ YES" : "❌ NO"} (${res7a2.responseData.draft?.tone})`);
    console.log(`  Category unchanged: ${res7a2.responseData.draft?.category === res7a.responseData.draft?.category ? "✅ YES" : "❌ NO"}\n`);

    // Test 7b: Short name contains tone word - should not change tone
    console.log("Test 7b - Short name edit with tone word inside value");
    const req7b = createMockRequest({
      From: "whatsapp:+1234567893",
      Body: "יש לי רעיון לסרטון על שמלות",
    });
    const res7b = createMockResponse();
    await handleWhatsAppWebhook(req7b, res7b);
    const initialTone7b = res7b.responseData.draft?.tone;
    console.log(`Initial draft - tone: ${initialTone7b}`);

    const req7b2 = createMockRequest({
      From: "whatsapp:+1234567893",
      Body: "תשנה את השם לחתונה מצחיקה",
    });
    const res7b2 = createMockResponse();
    await handleWhatsAppWebhook(req7b2, res7b2);
    console.log(`After name edit:`);
    console.log(`  Short name updated: ${res7b2.responseData.draft?.shortName === "חתונה מצחיקה" ? "✅ YES" : "❌ NO"}`);
    console.log(`  Tone unchanged: ${res7b2.responseData.draft?.tone === initialTone7b ? "✅ YES" : "❌ NO"} (${res7b2.responseData.draft?.tone})\n`);

    // Test 7c: Short name contains category word - should not change category
    console.log("Test 7c - Short name edit with category word inside value");
    const req7c = createMockRequest({
      From: "whatsapp:+1234567894",
      Body: "יש לי רעיון לסרטון כללי",
    });
    const res7c = createMockResponse();
    await handleWhatsAppWebhook(req7c, res7c);
    const initialCategory7c = res7c.responseData.draft?.category;
    console.log(`Initial draft - category: ${initialCategory7c}`);

    const req7c2 = createMockRequest({
      From: "whatsapp:+1234567894",
      Body: "תשנה את השם לחתונה בקפריסין",
    });
    const res7c2 = createMockResponse();
    await handleWhatsAppWebhook(req7c2, res7c2);
    console.log(`After name edit:`);
    console.log(`  Short name updated: ${res7c2.responseData.draft?.shortName === "חתונה בקפריסין" ? "✅ YES" : "❌ NO"}`);
    console.log(`  Category unchanged: ${res7c2.responseData.draft?.category === initialCategory7c ? "✅ YES" : "❌ NO"} (${res7c2.responseData.draft?.category})\n`);

    // Test 7d: Verify field precedence passed
    const fieldPrecedenceOk = 
      res7a2.responseData.draft?.tone === res7a.responseData.draft?.tone &&
      res7a2.responseData.draft?.summary?.includes("קליל ומצחיק") &&
      res7b2.responseData.draft?.tone === initialTone7b &&
      res7b2.responseData.draft?.shortName === "חתונה מצחיקה" &&
      res7c2.responseData.draft?.category === initialCategory7c &&
      res7c2.responseData.draft?.shortName === "חתונה בקפריסין";

    console.log("=".repeat(60));
    console.log("Summary Edit QA Results");
    console.log("=".repeat(60));
    const finalPassed = allPassed && fieldPrecedenceOk;
    
    if (finalPassed) {
      console.log("✅ All Draft Edit QA tests PASSED");
      console.log("   - Summary editing with multiple patterns works");
      console.log("   - Other fields remain unchanged when editing summary");
      console.log("   - Existing field edits (short name, priority, tone) still work");
      console.log("   - Field precedence: explicit commands not affected by value keywords");
    } else {
      console.log("❌ Some Draft Edit QA tests FAILED");
      if (!allPassed) {
        console.log(`   Main tests: res5=${res5.responseData.status}, res6b=${res6b.responseData.status}, res6c=${res6c.responseData.status}, res6d=${res6d.responseData.status}, res6e=${res6e.responseData.status}`);
      }
      if (!fieldPrecedenceOk) {
        console.log(`   Field precedence: Failed - values were re-parsed for other fields`);
      }
    }

    // Restore original function
    whatsappService.sendWhatsAppMessage = originalSendWhatsAppMessage;

  } catch (error) {
    console.error("Error during Draft Edit Flow QA:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
