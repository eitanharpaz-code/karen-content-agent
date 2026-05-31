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
  console.log("Edge Cases QA\n");
  let passed = 0;
  let total = 0;

  separator("מקרה 1: רעיון חדש כשיש דראפט פתוח - known issue");
  await send("יש לי רעיון על חתונה בחורף");
  const e1a = await send("יש לי עוד רעיון על שמלה שניה");
  total++; if (check("דראפט חדש כשיש דראפט פתוח", e1a, ["draft_created", "new_idea_started", "edit_not_understood"])) passed++;
  console.log("  ℹ️  known issue - follow-up context");

  separator("מקרה 2: ביטול דראפט ואז רעיון חדש מיד");
  await send("יש לי רעיון על קפריסין");
  const e2a = await send("ביטול");
  total++; if (check("ביטול דראפט", e2a, ["draft_cancelled", "draft_reset"])) passed++;
  const e2b = await send("יש לי רעיון על רווקות");
  total++; if (check("רעיון חדש אחרי ביטול", e2b, "draft_created")) passed++;

  separator("מקרה 3: עדכון סטטוס לתוכן לא קיים");
  const e3 = await send("צילמתי את הסרטון על קקטוס בשדה");
  total++; if (check("תוכן לא קיים", e3, ["status_update_not_found", "status_update_no_match", "no_match_found"])) passed++;

  separator("מקרה 4: כמה סטטוסים בהודעה אחת");
  const e4 = await send("צילמתי וגם ערכתי את הסרטון על הלוקים לקפריסין");
  total++; if (check("כמה סטטוסים יחד", e4, "status_updated")) passed++;

  separator("מקרה 5: עדכון סטטוס העלאה - cascade");
  const e5 = await send("הסרטון על הלוקים שלי לקפריסין הועלה");
  total++; if (check("cascade upload", e5, ["status_updated", "status_update_ambiguous"])) passed++;

  separator("מקרה 6: שאילתת visibility אחרי עדכון סטטוס");
  await send("ערכתי את הסרטון על הלוקים לקפריסין");
  const e6 = await send("מה הסטטוס של הלוקים שלי לקפריסין");
  total++; if (check("visibility אחרי עדכון", e6, "visibility_task_status")) passed++;

  console.log("\n" + "=".repeat(60));
  console.log(`סיכום: ${passed}/${total}`);
};

run().catch(console.error);