import twilio from "twilio";

export const sendWhatsAppMessage = async (to: string, body: string): Promise<void> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
    throw new Error("Missing Twilio configuration: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_FROM.");
  }

  const client = twilio(accountSid, authToken);

  await client.messages.create({
    from,
    to,
    body,
  });
};
