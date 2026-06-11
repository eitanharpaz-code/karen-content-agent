import dotenv from "dotenv";
dotenv.config();
import { handleWhatsAppWebhook } from "../controllers/whatsapp.controller";
import { Request } from "express";

const SENDER = "whatsapp:+9999999999";

const createMockRequest = (body: string): Request => ({
  body: { From: SENDER, Body: body }
} as Request);

const createMockResponse = (): any => {
  const res: any = {};
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.responseData = data; return res; };
  return res;
};

const send = async (text: string): Promise<string> => {
  const req = createMockRequest(text);
  const res = createMockResponse();
  await handleWhatsAppWebhook(req as any, res as any);
  return res.responseData?.status || "unknown";
};

const separator = (title: string) => {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
};

const check = (label: string, actual: string, expected: string | string[]) => {
  const pass = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  console.log(`${pass ? "✅" : "❌"} ${label}: ${actual}`);
  return pass;
};

const run = async () => {
  console.log("Gantt QA - בדיקת פיצ'רי גאנט\n");
  let passed = 0;
  let total = 0;

  separator("מקרה 1: שאילתת גאנט השבוע");
  const t1 = await send("מה בגאנט השבוע");
  total++; if (check("gantt_query", t1, "visibility_gantt")) passed++;

  separator("מקרה 2: מה עוד לא עלה");
  const t2 = await send("מה עוד לא עלה");
  total++; if (check("not_uploaded מגאנט", t2, "visibility_query")) passed++;

  separator("מקרה 3: מה דחוף - שני בלוקים");
  const t3 = await send("מה דחוף");
  total++; if (check("whats_important", t3, "visibility_query")) passed++;

  separator("מקרה 4: כתיבה לגאנט - שם מדויק");
  const t4a = await send("תוסיפי את ביזנס די לעוני לגאנט ב-22/06");
  total++; if (check("gantt_write exact", t4a, ["gantt_write_success", "gantt_collision_detected", "gantt_write_confirm_needed"])) passed++;
  // סגור שאלת שעה אם נפתחה
  await send("לא");

  separator("מקרה 5: כתיבה לגאנט - שם לא מדויק");
  const t5a = await send("תוסיפי את שינוי שם לגאנט ב-22/06");
  total++; if (check("gantt_write partial match", t5a, ["gantt_write_confirm_needed", "gantt_write_not_found", "gantt_collision_detected"])) passed++;
  if (t5a === "gantt_write_confirm_needed") {
    const t5b = await send("כן");
    total++; if (check("אישור התאמה חלקית", t5b, ["gantt_write_confirmed", "gantt_collision_detected", "gantt_upload_time_set"])) passed++;
    await send("לא");
  }

  separator("מקרה 6: כתיבה לגאנט - תאריך תפוס, קרן לא רוצה להחליף");
  const t6a = await send("תוסיפי את ביזנס די לעוני לגאנט ב-20/06");
  total++; if (check("gantt collision detected", t6a, ["gantt_collision_detected", "gantt_write_success", "gantt_write_confirm_needed"])) passed++;
  if (t6a === "gantt_collision_detected") {
    const t6b = await send("לא");
    total++; if (check("הצעת תאריך חלופי", t6b, "gantt_collision_suggest_new_date")) passed++;
    const t6c = await send("כן");
    total++; if (check("אישור תאריך חלופי", t6c, ["gantt_write_new_date_confirmed"])) passed++;
    await send("לא");
  }

  separator("מקרה 7: כתיבה לגאנט - תאריך תפוס, קרן רוצה להחליף");
  const t7a = await send("תוסיפי את מה איתן חושב לגאנט ב-20/06");
  total++; if (check("gantt collision detected", t7a, ["gantt_collision_detected", "gantt_write_success", "gantt_write_confirm_needed"])) passed++;
  if (t7a === "gantt_collision_detected") {
    const t7b = await send("כן");
    total++; if (check("הצעת הזזת קיים", t7b, "gantt_collision_suggest_move")) passed++;
    const t7c = await send("כן");
    total++; if (check("אישור הזזה", t7c, "gantt_move_confirmed")) passed++;
    await send("לא");
  }

  separator("מקרה 8: שם לא קיים בתכנים שאושרו");
  const t8 = await send("תוסיפי את סרטון על קקטוסים לגאנט ב-22/06");
  total++; if (check("תוכן לא קיים", t8, "gantt_write_not_found")) passed++;

  separator("מקרה 9: gantt_write לא נתפס כרעיון חדש");
  const t9 = await send("תוסיפי את שינוי שם משפחה להפקה");
  total++; if (check("להפקה לא נתפס כגאנט", t9, ["approved_for_production", "approve_not_found", "approve_parse_error"])) passed++;

  console.log("\n" + "=".repeat(60));
  console.log(`סיכום: ${passed}/${total}`);
};

run().catch(console.error);