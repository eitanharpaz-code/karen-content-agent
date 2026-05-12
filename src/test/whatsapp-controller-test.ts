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
    console.log("Testing WhatsApp controller logic (without sending messages)...\n");

    // Test 1: Content idea message
    const testMessage = "יש לי רעיון לסרטון על חתונה אזרחית בקפריסין";
    console.log(`Test 1 - Input: "${testMessage}"`);

    const req1 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: testMessage,
    });
    const res1 = createMockResponse();

    // Temporarily replace the sendWhatsAppMessage function to avoid sending real messages
    const whatsappService = require("../services/whatsapp.service");
    const originalSendWhatsAppMessage = whatsappService.sendWhatsAppMessage;
    whatsappService.sendWhatsAppMessage = async () => {
      console.log("Mock: Would send WhatsApp message");
    };

    await handleWhatsAppWebhook(req1, res1);

    console.log("Response status:", res1.statusCode);
    console.log("Response data status:", res1.responseData.status);
    console.log("Has draft object:", !!res1.responseData.draft);
    console.log("Expected: draft_created status with draft object\n");

    // Test 2: Confirmation message
    console.log("Test 2 - Input: \"כן\" (confirmation)");
    const req2 = createMockRequest({
      From: "whatsapp:+1234567890",
      Body: "כן",
    });
    const res2 = createMockResponse();

    await handleWhatsAppWebhook(req2, res2);

    console.log("Response status:", res2.statusCode);
    console.log("Response data status:", res2.responseData.status);
    console.log("Expected: confirmed status\n");

    // Restore original function
    whatsappService.sendWhatsAppMessage = originalSendWhatsAppMessage;

    console.log("Sprint 5 WhatsApp controller test completed successfully.");

  } catch (error) {
    console.error("Error during WhatsApp controller test:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();
