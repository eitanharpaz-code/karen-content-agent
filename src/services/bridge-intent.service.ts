/**
 * bridge-intent.service.ts
 *
 * After saving an idea the agent asks one question: set a date now, or leave
 * it without one. Karen answers in whatever words come to mind ("עדיף לא",
 * "בוא נחכה", "כן בטח", "לא בא לי עכשיו"). A phrase list will always trail
 * reality, so when the deterministic classifier returns "unclear" we ask
 * Claude one bounded question instead of telling her we did not understand.
 *
 * Runs only on the unclear path, so normal answers cost nothing extra.
 */

import { askClaude, CLASSIFIER_MODEL } from "./claude.service";

export type BridgeIntent = "schedule" | "keep" | "unclear";

export const askClaudeForBridgeIntent = async (
  message: string
): Promise<BridgeIntent> => {
  const prompt = [
    "יוצרת תוכן נשאלה: לקבוע לרעיון תאריך בגאנט עכשיו, או להשאיר אותו כרגע בלי תאריך.",
    "",
    "התשובה שלה:",
    `"${message}"`,
    "",
    "מה היא התכוונה?",
    "- אם היא רוצה לקבוע תאריך עכשיו, החזר/י: schedule",
    "- אם היא מעדיפה להשאיר בלי תאריך כרגע, החזר/י: keep",
    "- אם באמת אי אפשר להבין, החזר/י: unclear",
    "",
    "החזר/י מילה אחת בלבד, בלי שום טקסט נוסף.",
  ].join("\n");

  try {
    const raw = await askClaude(prompt, {
      withPersona: false,
      model: CLASSIFIER_MODEL,
    });
    const answer = (raw || "").trim().toLowerCase();
    if (answer.includes("schedule")) return "schedule";
    if (answer.includes("keep")) return "keep";
    return "unclear";
  } catch (error) {
    console.error(`[Bridge Intent] Claude classification failed: ${error}`);
    return "unclear";
  }
};
