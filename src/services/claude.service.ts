import { readFile } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT_PATH = path.resolve(process.cwd(), "prompts", "system-prompt.md");

const loadSystemPrompt = async (): Promise<string> => {
  try {
    return await readFile(SYSTEM_PROMPT_PATH, "utf-8");
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

  const prompt = `${systemPrompt}\n
User: ${message}\n
Assistant:`;

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

  const response = await client.messages.create({
    model,
    messages: [
      { role: "user", content: `${systemPrompt}\n\n${message}` },
    ],
    max_tokens: 300,
  });

  if (!Array.isArray(response.content)) {
    throw new Error("Claude returned an unexpected response format.");
  }

  return response.content
    .map((item: any) => (item?.type === "text" ? item?.text : ""))
    .join("")
    .trim();
};
