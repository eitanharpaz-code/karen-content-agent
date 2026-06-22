// Internal Claude context contract (Stage 2A — design-time contract only).
//
// This file defines, but does not yet enforce or wire, the principled split
// between two kinds of Claude calls in this app:
//
// - Drafting calls (content.service.ts -> claude.service.ts/askClaude):
//   use the Karen persona loaded from prompts/system-prompt.md, and expect
//   a structured multi-field response (parser labels below).
//
// - Matching calls (the four matching functions in sheets.service.ts):
//   never use the persona/system prompt, and expect Claude to return only
//   a number or "0" — nothing else.
//
// No production code references these types yet. They exist so that future
// work (Stage 2B and beyond) has a single named contract to implement
// against, and so the static contract test in
// src/test/claude-context-contract-qa.ts has concrete shapes to check.

export interface DraftingClaudeContext {
  kind: "drafting";
  purpose: "content_draft";
  userInput: string;
  usesSystemPrompt: true;
  expectedParserLabels: readonly string[];
}

export type MatchingPurpose =
  | "production_task_match"
  | "content_idea_match"
  | "similar_idea_match"
  | "approved_content_match";

export interface ClaudeMatchingCandidate {
  index: number;
  label: string;
  contentId?: string;
}

export interface MatchingClaudeContext {
  kind: "matching";
  purpose: MatchingPurpose;
  query: string;
  candidates: readonly ClaudeMatchingCandidate[];
  usesSystemPrompt: false;
  expectedReturn: "number_or_zero";
}

export type ClaudeContext = DraftingClaudeContext | MatchingClaudeContext;
