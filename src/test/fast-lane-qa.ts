import dotenv from "dotenv";
import { handleWhatsAppWebhook } from "../controllers/whatsapp.controller";
import { Request, Response } from "express";

dotenv.config();

const createMockRequest = (body: any): Request => ({ body } as Request);

const createMockResponse = (): Response & { statusCode: number; responseData: any } => {
  const res: any = {};
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.responseData = data; return res; };
  return res;
};

const testCases = [
  "טרנד: סרטון על שמלה ויראלית",
  "טרנד - סרטון על לוקים לחתונה",
  "יש טרנד חדש, סרטון על קפריסין",
  "טרנד חדש: ריל על רווקות",
];

const runTest = async () => {
  console.log("Fast Lane QA\n");

  for (const text of testCases) {
    const req = createMockRequest({ From: "whatsapp:+1234567890", Body: text });
    const res = createMockResponse();
    await handleWhatsAppWebhook(req as any, res as any);

    const status = res.responseData?.status;
    const draft = res.responseData?.draft;

    if (status === "trend_started" && draft?.category === "טרנד" && draft?.priority === "גבוה") {
      console.log(`✅ "${text}"`);
      console.log(`   שם: ${draft.shortName}`);
      console.log(`   קטגוריה: ${draft.category} | עדיפות: ${draft.priority}\n`);
    } else {
      console.log(`❌ "${text}"`);
      console.log(`   status: ${status}\n`);
    }
  }

  console.log("בודק שמירה לגיליון...");
  const confirmReq = createMockRequest({ From: "whatsapp:+1234567890", Body: "כן" });
  const confirmRes = createMockResponse();
  await handleWhatsAppWebhook(confirmReq as any, confirmRes as any);

  if (confirmRes.responseData?.status === "confirmed_and_saved") {
    const id = confirmRes.responseData?.contentId;
    console.log(`✅ נשמר בהצלחה. ID: ${id}`);
    if (id?.startsWith("TRD-")) {
      console.log(`✅ מזהה TRD תקין`);
    } else {
      console.log(`❌ מזהה לא תקין: ${id}`);
    }
  } else {
    console.log(`❌ שמירה נכשלה: ${confirmRes.responseData?.status}`);
  }
};

runTest().catch(console.error);
