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
    console.log("Natural Hebrew Edit Phrases QA Test\n");

    // Mock the WhatsApp service to avoid sending real messages
    const whatsappService = require("../services/whatsapp.service");
    const originalSendWhatsAppMessage = whatsappService.sendWhatsAppMessage;
    whatsappService.sendWhatsAppMessage = async (to: string, message: string) => {
      console.log(`\n[Mock WhatsApp] Would send to ${to}:\n${message}\n`);
    };

    // Test cases for natural Hebrew edit phrases
    const testCases = [
      {
        description: "Create initial draft",
        message: "יש לי רעיון לסרטון על שמלות כלה",
        expectedStatus: "draft_created"
      },
      {
        description: "Test: 'אני רוצה לשנות קטגוריה לחתונה'",
        message: "אני רוצה לשנות קטגוריה לחתונה",
        expectedStatus: "draft_updated",
        checkField: "category",
        expectedValue: "Wedding"
      },
      {
        description: "Test: 'בא לי שהטון יהיה מצחיק'",
        message: "בא לי שהטון יהיה מצחיק",
        expectedStatus: "draft_updated",
        checkField: "tone",
        expectedValue: "Funny"
      },
      {
        description: "Test: 'עדיף שזה יהיה בקטגוריית שמלות'",
        message: "עדיף שזה יהיה בקטגוריית שמלות",
        expectedStatus: "draft_updated",
        checkField: "category",
        expectedValue: "Dresses"
      },
      {
        description: "Test: 'תשנה את השם לשמלה שלישית'",
        message: "תשנה את השם לשמלה שלישית",
        expectedStatus: "draft_updated",
        checkField: "shortName",
        expectedValue: "שמלה שלישית"
      },
      {
        description: "Test: 'העדיפות צריכה להיות גבוהה'",
        message: "העדיפות צריכה להיות גבוהה",
        expectedStatus: "draft_updated",
        checkField: "priority",
        expectedValue: "High"
      },
      {
        description: "Test: 'זה צריך להיות יותר רגשי'",
        message: "זה צריך להיות יותר רגשי",
        expectedStatus: "draft_updated",
        checkField: "tone",
        expectedValue: "Emotional"
      },
      {
        description: "Confirm the final draft",
        message: "כן",
        expectedStatus: "confirmed_and_saved"
      }
    ];

    let passedTests = 0;
    let totalTests = testCases.length;

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`\n--- Test ${i + 1}: ${testCase.description} ---`);
      console.log(`Message: "${testCase.message}"`);

      const req = createMockRequest({
        From: "whatsapp:+1234567890",
        Body: testCase.message,
      });
      const res = createMockResponse();

      await handleWhatsAppWebhook(req, res);

      console.log(`Status: ${res.responseData.status}`);

      if (res.responseData.status === testCase.expectedStatus) {
        console.log("✅ Status check passed");

        if (testCase.checkField && res.responseData.draft) {
          const actualValue = res.responseData.draft[testCase.checkField];
          if (actualValue === testCase.expectedValue) {
            console.log(`✅ Field check passed: ${testCase.checkField} = "${actualValue}"`);
            passedTests++;
          } else {
            console.log(`❌ Field check failed: expected "${testCase.expectedValue}", got "${actualValue}"`);
          }
        } else if (testCase.checkField) {
          console.log(`❌ Field check failed: no draft object in response`);
        } else {
          passedTests++;
        }
      } else {
        console.log(`❌ Status check failed: expected "${testCase.expectedStatus}", got "${res.responseData.status}"`);
      }
    }

    console.log(`\n--- Test Results ---`);
    console.log(`Passed: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
      console.log("🎉 All natural Hebrew edit phrase tests PASSED!");
    } else {
      console.log("❌ Some tests failed. Check the output above.");
      process.exit(1);
    }

    // Restore original function
    whatsappService.sendWhatsAppMessage = originalSendWhatsAppMessage;

  } catch (error) {
    console.error("Error during Natural Hebrew Edit Phrases QA:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

main();