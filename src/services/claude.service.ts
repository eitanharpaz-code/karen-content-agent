import { readFile } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { recordClaudeCall } from "./routing-trace.service";
import type { MatchingClaudeContext } from "../types/claude-context.types";

const SYSTEM_PROMPT_PATH = path.resolve(process.cwd(), "prompts", "system-prompt.md");
let cachedSystemPrompt: string | null = null;

// Model routing. Two tiers:
// - CREATIVE_MODEL for prose generation (draft creation, edits,
//   conversational replies) where Sonnet quality matters.
// - CLASSIFIER_MODEL for narrow, bounded-output calls (return a number,
//   or one of N enum values). Haiku 4.5 is ~1/3 the cost of Sonnet and
//   is more than smart enough for classification.
// Either can be overridden per-deployment via .env.
export const CREATIVE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
export const CLASSIFIER_MODEL =
  process.env.ANTHROPIC_CLASSIFIER_MODEL || "claude-haiku-4-5-20251001";

const loadSystemPrompt = async (): Promise<string> => {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  try {
    cachedSystemPrompt = await readFile(SYSTEM_PROMPT_PATH, "utf-8");
    return cachedSystemPrompt;
  } catch (error) {
    throw new Error(`Unable to read system prompt at ${SYSTEM_PROMPT_PATH}: ${error}`);
  }
};

export interface AskClaudeOptions {
  model?: string;
  // When false, the call is sent WITHOUT the Karen persona system prompt.
  // For classifier-style calls (intent detection, visibility intent) the
  // persona contributes nothing to a one-word answer and only costs input
  // tokens on every message. Mirrors the Drafting vs Matching contract in
  // claude-context.types.ts. Default: true (creative calls keep the persona).
  withPersona?: boolean;
}

export const askClaude = async (
  message: string,
  options: AskClaudeOptions = {}
): Promise<string> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment variables.");
  }

  const systemPrompt = await loadSystemPrompt();
  const client = new Anthropic({ apiKey });

  const model = options.model || CREATIVE_MODEL;

  // Two improvements over the previous shape:
  // 1) System prompt lives in the `system` field, not stuffed into the
  //    user message — cleaner semantics; the model treats it as the
  //    stable persona frame, which is a better fit for how it's used.
  // 2) cache_control: ephemeral tags the system prompt for prompt
  //    caching. Subsequent calls within ~5 minutes reuse the cached
  //    prefix at ~10% of the normal input cost. The system prompt must
  //    reach the model's minimum cache size for this to take effect;
  //    if it's under threshold the response is unchanged and pricing
  //    stays as normal input tokens (no downside).
  const withPersona = options.withPersona !== false;

  // Routing trace: count this call against the message currently being routed.
  recordClaudeCall(model, withPersona);

  const response = await client.messages.create({
    model,
    ...(withPersona
      ? {
          system: [
            {
              type: "text" as const,
              text: systemPrompt,
              cache_control: { type: "ephemeral" as const },
            },
          ],
        }
      : {}),
    messages: [{ role: "user", content: message }],
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
// - similar_idea_match: duplicate detection ("is this the SAME specific
//   idea?"). Originally copied verbatim from findSimilarContentIdea;
//   tightened on 12/07/2026 after a live false positive — see comment
//   inside the branch.
// - all other purposes: best-match selection among candidates.
const buildMatchingPrompt = (
  context: MatchingClaudeContext,
  candidateList: string
): string => {
  if (context.purpose === "similar_idea_match") {
    // Duplicate-detection prompt, tightened after a live false positive
    // (12/07/2026): the original wording asked for "אותו נושא" — but ALL of
    // Karen's content shares the same topic (weddings), so Haiku matched
    // thematically and flagged genuinely new ideas as duplicates. A
    // duplicate now means the SAME specific idea/angle (would produce
    // essentially the same content), shared theme alone is explicitly not
    // enough, and doubt resolves to 0. Output contract unchanged: a number
    // or "0", nothing else.
    return `רעיון חדש: "${context.query}"\nהנה רעיונות קיימים:\n${candidateList}\n\nהאם אחד הרעיונות הקיימים הוא כפילות של הרעיון החדש?\n\nכפילות = שני הרעיונות יובילו בפועל לאותו תוכן: אותה זווית ספציפית, אותו רעיון מרכזי.\n\nחשוב: כל הרעיונות כאן עוסקים באותו עולם תוכן (חתונות, זוגיות, אירוסין) — נושא משותף או אווירה דומה לבדם הם לא כפילות. רק אם זה בעצם אותו רעיון בניסוח אחר.\n\nאם יש ספק — החזר "0".\n\nהחזר רק את המספר של הרעיון הכפול, או "0" אם אין כפילות. רק מספר, בלי הסבר.`;
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

  // Matching is a classifier task (return a number 1..N or 0). Use the
  // cheaper Haiku tier — it's plenty smart for this and roughly 1/3
  // the cost of Sonnet.
  const model =
    process.env.ANTHROPIC_MATCHING_MODEL ||
    process.env.ANTHROPIC_CLASSIFIER_MODEL ||
    CLASSIFIER_MODEL;

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

  // Routing trace: matching calls are always persona-free.
  recordClaudeCall(model, false);

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
