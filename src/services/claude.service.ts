import { readFile } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { MatchingClaudeContext } from "../types/claude-context.types";

const SYSTEM_PROMPT_PATH = path.resolve(process.cwd(), "prompts", "system-prompt.md");
let cachedSystemPrompt: string | null = null;

const loadSystemPrompt = async (): Promise<string> => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  try {
    cachedSystemPrompt = await readFile(SYSTEM_PROMPT_PATH, "utf-8");
    return cachedSystemPrompt;
  } catch (error) {
    throw new Error(`Unable to read system prompt at ${SYSTEM_PROMPT_PATH}: ${error}`);
  }
};

export const askClaude = async (message: string): Promise<string> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment variables.");
  }

  const systemPrompt = await loadSystemPrompt();
  const client = new Anthropic({ apiKey });



  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const response = await client.messages.create({
    model,
    messages: [
      { role: "user", content: `${systemPrompt}\n\n${message}` },
    ],
    max_tokens: 1024,
  });

  if (!Array.isArray(response.content)) {
    throw new Error("Claude returned an unexpected response format.");
  }

  return response.content
    .map((item: any) => (item?.type === "text" ? item?.text : ""))
    .join("")
    .trim();
};

// ---------------------------------------------------------------------------
// Stage 2B — askClaudeForMatching
//
// Stage 2 wiring status: COMPLETE. All four matching functions in
// sheets.service.ts (findProductionTaskByName, getContentIdeaSummary,
// findSimilarContentIdea, findApprovedContentByName) are wired to this
// path. No matching function calls the Anthropic API directly. This is the single
// unified replacement for the matching logic previously duplicated across
// the four matching functions in sheets.service.ts.
//
// Per the Drafting vs Matching Claude context contract
// (src/types/claude-context.types.ts), matching calls NEVER use the Karen
// persona / system prompt. This function intentionally does not import or
// call loadSystemPrompt, and does not use the Anthropic SDK client used by
// askClaude above — it calls the Anthropic API directly via fetch(), to
// match the exact behavior of the existing matching functions in
// sheets.service.ts (same max_tokens, same "number or 0 only" instruction,
// same response parsing), so that a future swap-in is a like-for-like
// replacement rather than a behavior change.
//
// Returns the matched candidate's `index` (as given in the input
// candidates array), or null if there is no match or the call fails.
// Prompt builder for matching calls. Two wordings, selected by purpose:
// - similar_idea_match: duplicate detection ("is there a VERY similar
//   existing idea?"). Wording copied verbatim from the original
//   findSimilarContentIdea prompt so wiring is not a behavior change.
// - all other purposes: best-match selection among candidates.
const buildMatchingPrompt = (
  context: MatchingClaudeContext,
  candidateList: string
): string => {
  if (context.purpose === "similar_idea_match") {
    return `רעיון חדש: "${context.query}"\nהנה רעיונות קיימים:\n${candidateList}\n\nהאם יש רעיון קיים שדומה מאוד לרעיון החדש (אותו נושא, אותו קונספט)? החזר רק את המספר של הרעיון הדומה, או "0" אם אין רעיון דומה. רק מספר, בלי הסבר.`;
  }

  return `המשתמש חיפש: "${context.query}"\nהנה רשימת המועמדים:\n${candidateList}\n\nהחזר רק את המספר של המועמד שהכי מתאים לחיפוש, או "0" אם אין התאמה סבירה. רק מספר, בלי הסבר.`;
};

export const askClaudeForMatching = async (
  context: MatchingClaudeContext
): Promise<number | null> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment variables.");
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const candidateList = context.candidates
    .map((candidate, i) => `${i + 1}. ${candidate.label}`)
    .join("\n");

  // Prompt wording is selected by purpose. The unified contract is about
  // behavior (persona-free, number-or-zero, null on failure) — not about a
  // single prompt text. similar_idea_match is duplicate DETECTION ("is there
  // a very similar idea?" — usually the answer should be 0), while the other
  // purposes are best-match SELECTION ("which candidate best matches?").
  // Using the selection wording for duplicate detection would produce false
  // "similar idea found" answers for genuinely new ideas.
  const prompt = buildMatchingPrompt(context, candidateList);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = (await response.json()) as any;
    const resultText = (data.content?.[0]?.text || "0").trim();
    const parsedNumber = parseInt(resultText, 10);

    if (Number.isNaN(parsedNumber)) {
      return null;
    }

    const index = parsedNumber - 1;
    if (index < 0 || index >= context.candidates.length) {
      return null;
    }

    return context.candidates[index].index;
  } catch (error) {
    console.error(`[askClaudeForMatching] Error: ${error}. Returning null (no unsafe fallback).`);
    return null;
  }
};
