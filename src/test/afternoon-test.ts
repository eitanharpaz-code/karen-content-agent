import dotenv from "dotenv";
dotenv.config();
import { buildAfternoonReminder } from "../services/daily-brief.service";
import { sendWhatsAppMessage } from "../services/whatsapp.service";

const TO = process.env.DAILY_BRIEF_TO || "";

buildAfternoonReminder().then(async (msg: string | null) => {
  if (!msg) { console.log("NO MESSAGE - nothing urgent"); return; }
  console.log("Message:\n", msg);
  if (!TO) { console.log("NO TO"); return; }
  await sendWhatsAppMessage(TO, msg);
  console.log("Sent!");
}).catch(console.error);
