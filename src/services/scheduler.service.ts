import { storePendingQuestion } from "./confirmation.service";
import { getValue } from "./persistence.service";
import cron from "node-cron";
import { sendWhatsAppMessage } from "./whatsapp.service";
import {
  buildMorningBrief,
  buildAfternoonReminderResult,
  hasInteractedToday,
} from "./daily-brief.service";

const ENABLED = process.env.DAILY_BRIEF_ENABLED === "true";
const MORNING_TIME = process.env.DAILY_BRIEF_MORNING_TIME || "0 9 * * *";
const AFTERNOON_TIME = process.env.DAILY_BRIEF_AFTERNOON_TIME || "30 16 * * *";
const TIMEZONE = process.env.DAILY_BRIEF_TIMEZONE || "Asia/Jerusalem";
const TO = process.env.DAILY_BRIEF_TO || "";

const safeSend = async (message: string): Promise<void> => {
  if (!ENABLED) {
    console.log(`[Daily Brief] DRY RUN — would send:\n${message}`);
    return;
  }
  if (!TO) {
    console.error("[Daily Brief] DAILY_BRIEF_TO is not set.");
    return;
  }
  try {
    await sendWhatsAppMessage(TO, message);
    console.log("[Daily Brief] ✅ Sent successfully.");
  } catch (error) {
    console.error("[Daily Brief] ❌ Failed to send:", error);
  }
};

export const startScheduler = (): void => {
  if (!ENABLED) {
    console.log("[Daily Brief] Scheduler loaded in DRY RUN mode (DAILY_BRIEF_ENABLED=false).");
  }

  // Morning Brief
  cron.schedule(
    MORNING_TIME,
    async () => {
      console.log("[Daily Brief] Running morning brief...");
      try {
        const message = await buildMorningBrief();
        if (message) {
          await safeSend(message);
          // If the brief offered to show the waiting ideas, remember the
          // question so Karen's "כן" later lands in the right handler
          // (23.7.2026). Same pendingQuestion mechanism as in conversation.
          if (message.includes("שמחכים לתאריך") || message.includes("שמחכה לתאריך")) {
            const target = process.env.DAILY_BRIEF_TO;
            if (target) {
              storePendingQuestion(target, {
                questionType: "offer_saved_list",
                context: { fromBrief: true },
              });
            }
          }
        }
      } catch (error) {
        console.error("[Daily Brief] Error building morning brief:", error);
      }
    },
    { timezone: TIMEZONE }
  );

  // Afternoon Reminder
  cron.schedule(
    AFTERNOON_TIME,
    async () => {
      console.log("[Daily Brief] Running afternoon reminder check...");
      try {
        const { message, bypassInteraction } = await buildAfternoonReminderResult();
        if (!message) {
          console.log("[Daily Brief] No actionable reminder - skipping.");
          return;
        }
        // תוכן שעולה היום ומוכן - נשלח תמיד
        if (!bypassInteraction && hasInteractedToday(TO)) {
          console.log("[Daily Brief] Karen interacted today and no urgent today-content - skipping.");
          return;
        }
        await safeSend(message);
        // If this was the silence nudge offering the waiting ideas, arm the
        // same follow-up the conversation flow uses, so her "כן" lands right.
        // Arm the matching follow-up so her one-word answer lands correctly.
        if (message.includes("רוצה לראות אותם ולבחור אחד")) {
          storePendingQuestion(TO, {
            questionType: "offer_saved_list",
            context: { fromNudge: true },
          });
        } else if (message.includes("להשאיר אותו כמו שהוא, או להעביר ליום אחר")) {
          const nudgeCtx = getValue<any>("silenceNudge", `${TO}:context`);
          if (nudgeCtx?.contentId) {
            storePendingQuestion(TO, {
              questionType: "nudge_unfilmed_decision",
              context: {
                contentId: nudgeCtx.contentId,
                contentName: nudgeCtx.contentName,
                date: nudgeCtx.date,
              },
            });
          }
        }
      } catch (error) {
        console.error("[Daily Brief] Error building afternoon reminder:", error);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log("[Daily Brief] Scheduler started.");
};