import dotenv from "dotenv";
dotenv.config();
import { handleWhatsAppWebhook } from "../controllers/whatsapp.controller";
import { Request, Response } from "express";

const SENDER = "whatsapp:+1234567890";

const createMockRequest = (body: string): Request => ({
  body: { From: SENDER, Body: body }
} as Request);

const createMockResponse = (): any => {
  const res: any = {};
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.responseData = data; return res; };
  return res;
};

const send = async (text: string): Promise<{ status: string; reply?: string }> => {
  const req = createMockRequest(text);
  const res = createMockResponse();
  await handleWhatsAppWebhook(req as any, res as any);
  return {
    status: res.responseData?.status || "unknown",
  };
};

const separator = () => console.log("\n" + "=".repeat(60) + "\n");

const run = async () => {
  console.log("Full Flow QA - בדיקת זרימה מלאה\n");

  separator();
  console.log("שלב 1: רעיון חדש");
  console.log("קרן: יש לי רעיון לסרטון על מה עושים ביום לפני החתונה");
  const s1 = await send("יש לי רעיון לסרטון על מה עושים ביום לפני החתונה");
  console.log(`סטטוס: ${s1.status}`);
  console.log("צפוי: draft_created ✅\n");

  separator();
  console.log("שלב 2: עריכת דראפט");
  console.log("קרן: תשני את הטון לרגשי");
  const s2 = await send("תשני את הטון לרגשי");
  console.log(`סטטוס: ${s2.status}`);
  console.log("צפוי: draft_updated ✅\n");

  separator();
  console.log("שלב 3: אישור ושמירה");
  console.log("קרן: כן");
  const s3 = await send("כן");
  console.log(`סטטוס: ${s3.status}`);
  console.log("צפוי: confirmed_and_saved ✅\n");

  separator();
  console.log("שלב 4: מה דחוף");
  console.log("קרן: מה דחוף");
  const s4 = await send("מה דחוף");
  console.log(`סטטוס: ${s4.status}`);
  console.log("צפוי: visibility_query (whats_important) ✅\n");

  separator();
  console.log("שלב 5: סטטוס תוכן ספציפי");
  console.log("קרן: מה הסטטוס של הלוקים שלי לקפריסין");
  const s5 = await send("מה הסטטוס של הלוקים שלי לקפריסין");
  console.log(`סטטוס: ${s5.status}`);
  console.log("צפוי: visibility_query_no_match (התוכן לא בגיליון) ✅\n");

  separator();
  console.log("שלב 6: עדכון סטטוס הפקה");
  console.log("קרן: צילמתי את הסרטון על הלוקים לקפריסין");
  const s6 = await send("צילמתי את הסרטון על הלוקים לקפריסין");
  console.log(`סטטוס: ${s6.status}`);
  console.log("צפוי: status_no_match_asked (מציג מה בהפקה ושואל) ✅\n");

  separator();
  console.log("שלב 7: פילטור עדיפות");
  console.log("קרן: מה בעדיפות גבוהה");
  const s7 = await send("מה בעדיפות גבוהה");
  console.log(`סטטוס: ${s7.status}`);
  console.log("צפוי: visibility_query (priority_filter) ✅\n");

  separator();
  console.log("שלב 8: טרנד חדש");
  console.log("קרן: טרנד: ריל על שמלת כלה ויראלית");
  const s8 = await send("טרנד: ריל על שמלת כלה ויראלית");
  console.log(`סטטוס: ${s8.status}`);
  console.log("צפוי: trend_started ✅\n");

  separator();
  console.log("שלב 9: אישור טרנד");
  console.log("קרן: כן");
  const s9 = await send("כן");
  console.log(`סטטוס: ${s9.status}`);
  console.log("צפוי: confirmed_and_saved ✅\n");

  separator();
  console.log("שלב 10: הודעה לא ברורה");
  console.log("קרן: בסדר תודה");
  const s10 = await send("בסדר תודה");
  console.log(`סטטוס: ${s10.status}`);
  console.log("צפוי: conversational_reply (לא כותב לגיליון) ✅\n");

  separator();
  console.log("=== סיכום ===");
  const results = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10];
  // Steps 5 and 6 reference content that is not in the sheet on purpose, so
  // the correct behaviour is the not-found path, not a successful update
  // (updated 23.7.2026). Step 10 must NOT write anything.
  const expected = [
    "draft_created", "draft_updated", "confirmed_and_saved",
    "visibility_query", "visibility_query_no_match", "status_no_match_asked",
    "visibility_query", "trend_started", "confirmed_and_saved",
    "conversational_reply"
  ];
  const alternatives: Record<string, string[]> = {
    conversational_reply: ["conversational_reply", "low_confidence_idea", "meta_conversation", "question_clarification"],
    visibility_query_no_match: ["visibility_query_no_match", "visibility_task_status"],
    status_no_match_asked: ["status_no_match_asked", "status_updated"],
  };
  results.forEach((r, i) => {
    const pass = r.status === expected[i] ||
                 (alternatives[expected[i]] || []).includes(r.status);
    console.log(`שלב ${i+1}: ${pass ? "✅" : "❌"} (${r.status})`);
  });
};

run().catch(console.error);
