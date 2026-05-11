import { Request, Response } from "express";
import { sendWhatsAppMessage } from "../services/whatsapp.service";

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  const sender = (req.body.From || req.body.from || "").toString();
  const incomingText = (req.body.Body || req.body.body || "").toString();

  if (!sender || !incomingText) {
    return res.status(400).json({
      error: "Missing Twilio WhatsApp sender or message body in webhook payload.",
    });
  }

  const replyText = `שלום! קיבלתי את ההודעה שלך:\n${incomingText}`;

  try {
    await sendWhatsAppMessage(sender, replyText);
    return res.status(200).json({ status: "ok", sender, message: incomingText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: "Unable to send response message.", details: message });
  }
};
