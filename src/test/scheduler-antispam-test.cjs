require("ts-node/register/transpile-only");

const Module = require("module");

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

process.env.DAILY_BRIEF_ENABLED = "true";
process.env.DAILY_BRIEF_TO = "whatsapp:+972500000000";

const scheduledCallbacks = [];
const sentMessages = [];
let afternoonMessage = null;
let interactedToday = true;

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === "node-cron") {
    return {
      __esModule: true,
      default: {
        schedule: (_expression, callback) => {
          scheduledCallbacks.push(callback);
          return {};
        },
      },
    };
  }

  if (request.endsWith("/whatsapp.service")) {
    return {
      sendWhatsAppMessage: async (_to, message) => {
        sentMessages.push(message);
      },
    };
  }

  if (request.endsWith("/daily-brief.service")) {
    return {
      buildMorningBrief: async () => null,
      buildAfternoonReminder: async () => afternoonMessage,
      hasInteractedToday: () => interactedToday,
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const run = async () => {
  try {
    const { startScheduler } = require("../services/scheduler.service");
    startScheduler();

    assert(
      scheduledCallbacks.length === 2,
      "scheduler registers morning and afternoon with mocked cron"
    );

    afternoonMessage = "תזכורת רגילה";
    interactedToday = true;
    await scheduledCallbacks[1]();
    assert(
      sentMessages.length === 0,
      "regular afternoon reminder is suppressed after interaction"
    );

    afternoonMessage = "היום אמור לעלות:\nתוכן מוכן";
    await scheduledCallbacks[1]();
    assert(
      sentMessages.length === 1,
      "ready P0 urgency phrase bypasses interaction suppression"
    );

    console.log("\nScheduler anti-spam scenarios passed.");
  } finally {
    Module._load = originalLoad;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
