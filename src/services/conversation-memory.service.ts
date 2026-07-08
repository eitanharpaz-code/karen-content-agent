import { getValue, setValue } from "./persistence.service";

// Phase A of the conversational-agent shift.
//
// Keeps the last MAX_HISTORY messages per sender (both user and agent
// sides) so that Claude prompts can be given real conversational context
// instead of judging each message in isolation. Persisted to
// data/agent-state.json under the "conversationHistory" section, so it
// survives restarts along with pending drafts and questions.
//
// Design choices:
// - Ring buffer: on every append we cap the array at MAX_HISTORY entries.
//   Never grows without bound.
// - Rolling window is calibrated for "current chat" (~10 turns), not
//   long-term memory. Long-term recall is out of scope for Phase A.
// - Never throws. All read/write failures degrade to "empty history" so a
//   corrupt or missing entry cannot break the conversation flow.
// - The Hebrew role labels ("קרן"/"עוזרת") in formatHistoryForPrompt are
//   how the model will see the exchange — deliberately keeping the same
//   persona voice the system prompt establishes.

export const MAX_HISTORY = 10;

export type ConversationRole = "user" | "agent";

export interface ConversationMessage {
  role: ConversationRole;
  text: string;
  ts: string; // ISO timestamp — informational, not used for retrieval logic
}

const readHistory = (sender: string): ConversationMessage[] => {
  const raw = getValue<unknown>("conversationHistory", sender);
  if (!Array.isArray(raw)) return [];
  // Defensive filter: only well-shaped entries survive.
  return raw.filter(
    (m: any): m is ConversationMessage =>
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "agent") &&
      typeof m.text === "string" &&
      typeof m.ts === "string"
  );
};

const appendMessage = (
  sender: string,
  role: ConversationRole,
  text: string
): void => {
  if (!sender || !text) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const history = readHistory(sender);
    history.push({ role, text: trimmed, ts: new Date().toISOString() });
    const capped = history.slice(-MAX_HISTORY);
    setValue("conversationHistory", sender, capped);
  } catch (error) {
    console.error(`[conversation-memory] Failed to append ${role} message: ${error}`);
  }
};

export const appendUserMessage = (sender: string, text: string): void =>
  appendMessage(sender, "user", text);

export const appendAgentMessage = (sender: string, text: string): void =>
  appendMessage(sender, "agent", text);

export const getRecentHistory = (
  sender: string,
  limit: number = MAX_HISTORY
): ConversationMessage[] => {
  const history = readHistory(sender);
  return history.slice(-limit);
};

// Format history as a Hebrew transcript prefix for prompts. Includes only
// the messages BEFORE the current turn — callers should pass the same
// current message as `excludeLastIfMatches` so we don't repeat it in the
// prompt after having appended it via appendUserMessage.
//
// Returns an empty string when there's nothing to show, so callers can
// safely concatenate it into an existing prompt.
export const formatHistoryForPrompt = (
  sender: string,
  excludeLastIfMatches?: string
): string => {
  const history = getRecentHistory(sender);
  if (history.length === 0) return "";

  let effective = history;
  if (excludeLastIfMatches) {
    const last = history[history.length - 1];
    if (last.role === "user" && last.text.trim() === excludeLastIfMatches.trim()) {
      effective = history.slice(0, -1);
    }
  }
  if (effective.length === 0) return "";

  const lines = effective.map((m) =>
    m.role === "user" ? `קרן: ${m.text}` : `עוזרת: ${m.text}`
  );

  return `הקשר: הנה השיחה האחרונה בין קרן לעוזרת (הכי חדש בסוף). קחי את זה בחשבון כשאת מגיבה, במיוחד אם ההודעה הנוכחית הפניה למשהו שכבר הוזכר.

${lines.join("\n")}

---
`;
};

// Test-only helper: reset a sender's history without touching other state.
export const __resetHistoryForTests = (sender: string): void => {
  setValue("conversationHistory", sender, []);
};
