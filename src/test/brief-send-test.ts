import dotenv from "dotenv";
dotenv.config();
import { buildMorningBrief } from "../services/daily-brief.service";
import { sendWhatsAppMessage } from "../services/whatsapp.service";

const TO = process.env.DAILY_BRIEF_TO || "";

buildMorningBrief().then(async (msg: string | null) => {
  if (!msg) { console.log("NO MESSAGE"); return; }
  if (!TO) { console.log("NO TO"); return; }
  console.log("Sending to:", TO);
  await sendWhatsAppMessage(TO, msg);
  console.log("Sent!");
}).catch(console.error);
