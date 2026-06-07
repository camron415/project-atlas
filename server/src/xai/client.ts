import { buildPersonaPrompt, applyPersonaFallback } from "../persona/filter.js";

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
}

export async function chatCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: ChatOptions = {},
): Promise<string> {
  const response = await fetch(`${XAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? process.env.XAI_CHAT_MODEL ?? "grok-4-fast-non-reasoning",
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 800,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`xAI chat failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() ?? "";
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
    ], { temperature: 0.3, maxTokens: 500 });

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
  return Buffer.from(arrayBuffer);
}
