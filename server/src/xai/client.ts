import { buildPersonaPrompt, applyPersonaFallback } from "../persona/filter.js";
import { recordApiUsage } from "../cost/ledger.js";

const XAI_API_URL = process.env.XAI_API_URL ?? "https://api.x.ai/v1";

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  return key;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Cost ledger label (e.g. chief, analyst, voice-chief). */
  task?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatCompletionWithToolsResult {
  content: string;
  toolCalls: ChatToolCall[];
}

export async function chatCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: ChatOptions = {},
): Promise<string> {
  const result = await chatCompletionWithTools(messages, options);
  return result.content;
}

export async function chatCompletionWithTools(
  messages: ChatMessage[],
  options: ChatOptions & { tools?: ToolDefinition[] } = {},
): Promise<ChatCompletionWithToolsResult> {
  const body: Record<string, unknown> = {
    model: options.model ?? process.env.XAI_CHAT_MODEL ?? "grok-4-fast-non-reasoning",
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 800,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(`${XAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`xAI chat failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ChatToolCall[];
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  const model = (body.model as string) ?? "grok-4-fast-non-reasoning";
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    recordApiUsage({
      task: options.task ?? "chat",
      provider: "xai",
      model,
      inputTokens,
      outputTokens,
      estimatedUsd: 0,
    });
  }

  const message = data.choices?.[0]?.message;
  return {
    content: message?.content?.trim() ?? "",
    toolCalls: message?.tool_calls ?? [],
  };
}

export async function rewriteWithPersona(rawResponse: string): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    return applyPersonaFallback(rawResponse);
  }

  try {
    const filtered = await chatCompletion([
      {
        role: "system",
        content:
          "You rewrite assistant responses into a calm, polite, intelligent chief-assistant voice. Preserve facts exactly.",
      },
      { role: "user", content: buildPersonaPrompt(rawResponse) },
    ], { temperature: 0.3, maxTokens: 500, task: "persona" });

    return filtered || applyPersonaFallback(rawResponse);
  } catch {
    return applyPersonaFallback(rawResponse);
  }
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const response = await fetch(`${XAI_API_URL}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: process.env.XAI_TTS_VOICE ?? "rex",
      language: "en",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`xAI TTS failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const inputTokens = Math.max(1, Math.ceil(text.length / 4));
  recordApiUsage({
    task: "tts",
    provider: "xai",
    model: "xai-tts",
    inputTokens,
    outputTokens: 0,
    estimatedUsd: 0,
  });
  return Buffer.from(arrayBuffer);
}
