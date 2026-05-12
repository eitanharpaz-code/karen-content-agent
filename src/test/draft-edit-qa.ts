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

const main = async () => {
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

    // Test 2: User requests an edit
    console.log("Step 2 - User requests edit: 'תשנה עדיפות לבינונית'");

    const req2 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "תשנה עדיפות לבינונית",
    });
    const res2 = createMockResponse();

    await handleWhatsAppWebhook(req2, res2);

    console.log(`Step 2 Result: ${res2.responseData.status}`);
    console.log(`Draft updated: ${!!res2.responseData.draft}`);
    if (res2.responseData.draft) {
      console.log(`Updated priority: ${res2.responseData.draft.priority}\n`);
    }

    // Test 3: User confirms the updated draft
    console.log("Step 3 - User confirms: 'כן'");

    const req3 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "כן",
    });
    const res3 = createMockResponse();

    await handleWhatsAppWebhook(req3, res3);

    console.log(`Step 3 Result: ${res3.responseData.status}`);
    console.log(`Content ID: ${res3.responseData.contentId}`);
    console.log(`Task creation failed: ${res3.responseData.taskCreationFailed}\n`);

    // Verify the complete flow
    if (res3.responseData.status === "confirmed_and_saved") {
      console.log("✅ Draft Edit Flow QA PASSED");
      console.log(`   - Content ID: ${res3.responseData.contentId}`);
      console.log(`   - Draft was edited before confirmation`);
      console.log(`   - Content saved to Google Sheets`);
    } else {
      console.log("❌ Draft Edit Flow QA FAILED");
      console.log(`   Got: ${res3.responseData.status}`);
    }

    // Restore original function
    whatsappService.sendWhatsAppMessage = originalSendWhatsAppMessage;

  } catch (error) {
    console.error("Error during Draft Edit Flow QA:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
