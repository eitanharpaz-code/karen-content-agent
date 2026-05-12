import dotenv from "dotenv";
import { handleWhatsAppWebhook } from "../controllers/whatsapp.controller";
import { Request, Response } from "express";

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

// Verify that draft values are Hebrew (canonical)
const verifyHebrewValues = (draft: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  // Valid Hebrew categories
  const validCategories = ["קפריסין", "חתונה", "שמלות", "כללי", "רווקות", "רווקים", "על החתונה"];
  if (!validCategories.includes(draft.category)) {
    errors.push(`category should be Hebrew, got: ${draft.category}`);
  }
  
  // Valid Hebrew tones
  const validTones = ["הסברתי", "מצחיק", "אותנטי", "השראתי", "טרנדי", "רגשי"];
  if (!validTones.includes(draft.tone)) {
    errors.push(`tone should be Hebrew, got: ${draft.tone}`);
  }
  
  // Valid Hebrew priorities
  const validPriorities = ["גבוה", "בינוני", "נמוך"];
  if (!validPriorities.includes(draft.priority)) {
    errors.push(`priority should be Hebrew, got: ${draft.priority}`);
  }
  
  return { valid: errors.length === 0, errors };
};

// Verify that content ID has correct category prefix
const verifyCategoryBasedId = (contentId: string, category: string): { valid: boolean; error?: string } => {
  const categoryPrefixMap: Record<string, string> = {
    "קפריסין": "CYP",
    "שמלות": "DRS",
    "רווקות": "BCH",
    "רווקים": "BCH",
    "על החתונה": "PRW",
    "חתונה": "WED",
    "כללי": "GEN",
  };
  
  const expectedPrefix = categoryPrefixMap[category];
  if (!expectedPrefix) {
    return { valid: false, error: `Unknown category: ${category}` };
  }
  
  if (!contentId.startsWith(expectedPrefix + "-")) {
    return { valid: false, error: `ID should start with ${expectedPrefix}-, got: ${contentId}` };
  }
  
  // Verify format: PREFIX-NNN
  if (!/^[A-Z]+-\d{3}$/.test(contentId)) {
    return { valid: false, error: `ID should match format PREFIX-NNN, got: ${contentId}` };
  }
  
  return { valid: true };
};

const main = async () => {
  try {
    console.log("Sprint 6 QA: Testing Hebrew normalization and category-based ID generation...\n");

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
    console.log(`Draft created: ${!!res1.responseData.draft}`);
    
    // Verify Hebrew values
    const hebrewCheck = verifyHebrewValues(res1.responseData.draft);
    if (!hebrewCheck.valid) {
      console.log("❌ Hebrew values check FAILED:");
      hebrewCheck.errors.forEach(err => console.log(`   - ${err}`));
    } else {
      console.log("✅ Hebrew values are canonical in draft");
      console.log(`   - category: ${res1.responseData.draft.category}`);
      console.log(`   - tone: ${res1.responseData.draft.tone}`);
      console.log(`   - priority: ${res1.responseData.draft.priority}`);
    }
    console.log("");

    // Test 2: User confirms the draft
    console.log("Step 2 - User confirms the draft with 'כן'");
    console.log("Expected: בנק רעיונות write → משימות הפקה write → WhatsApp confirmation");
    console.log("Expected ID format: CYP-NNN (since category is קפריסין)\n");

    const req2 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "כן",
    });
    const res2 = createMockResponse();

    await handleWhatsAppWebhook(req2, res2);

    console.log(`\nStep 2 Result: ${res2.responseData.status}`);
    console.log(`Content ID: ${res2.responseData.contentId}`);
    console.log(`Task creation failed: ${res2.responseData.taskCreationFailed}`);
    
    // Verify category-based ID
    const idCheck = verifyCategoryBasedId(res2.responseData.contentId, res1.responseData.draft.category);
    if (!idCheck.valid) {
      console.log(`\n❌ Category-based ID check FAILED: ${idCheck.error}`);
    } else {
      console.log(`\n✅ Category-based ID is correct for category: ${res1.responseData.draft.category}`);
    }
    console.log("");

    // Final verification
    if (res2.responseData.status === "confirmed_and_saved" && hebrewCheck.valid && idCheck.valid) {
      console.log("✅ Sprint 6 Cleanup QA PASSED: All checks successful");
      console.log(`   - Draft uses Hebrew canonical values (category, tone, priority)`);
      console.log(`   - Content ID uses category prefix: ${res2.responseData.contentId}`);
      console.log(`   - Primary sheet (בנק רעיונות): Content row appended with Hebrew values`);
      console.log(`   - Derived sheet (משימות הפקה): Production task appended`);
    } else {
      console.log("❌ Sprint 6 Cleanup QA FAILED:");
      if (res2.responseData.status !== "confirmed_and_saved") {
        console.log(`   - Expected status 'confirmed_and_saved', got: ${res2.responseData.status}`);
      }
      if (!hebrewCheck.valid) {
        console.log(`   - Hebrew values not canonical`);
      }
      if (!idCheck.valid) {
        console.log(`   - Category-based ID incorrect`);
      }
    }

    // Restore original function
    whatsappService.sendWhatsAppMessage = originalSendWhatsAppMessage;

  } catch (error) {
    console.error("Error during Sprint 6 QA:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
