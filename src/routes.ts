import { Router } from "express";
import { handleWhatsAppWebhook } from "./controllers/whatsapp.controller";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

router.post("/webhook/whatsapp", handleWhatsAppWebhook);

export default router;
