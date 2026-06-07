import { AtlasModels } from "../models/router.js";

const XAI_API_URL = process.env.XAI_API_URL ?? "https://api.x.ai/v1";

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  return key;
}

export interface ResponsesOptions {
  model?: string;
  maxOutputTokens?: number;
  tools?: Array<{ type: string }>;
}

function extractOutputText(data: Record<string, unknown>): string {
  const output = data.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    const msg = item as Record<string, unknown>;
    if (msg.type !== "message") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as Record<string, unknown>;
      if (p.type === "output_text" && typeof p.text === "string") {
        chunks.push(p.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

/** Agent-style completion with built-in tools (web search, etc.). */
export async function responsesCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: ResponsesOptions = {},
): Promise<string> {
  const response = await fetch(`${XAI_API_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? AtlasModels.fast(),
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: options.tools ?? [{ type: "web_search" }],
      max_output_tokens: options.maxOutputTokens ?? 1200,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`xAI responses failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return extractOutputText(data);
}
