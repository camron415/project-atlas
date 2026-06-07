const XAI_API_URL = process.env.XAI_API_URL ?? "https://api.x.ai/v1";
const REALTIME_MODEL =
  process.env.XAI_REALTIME_MODEL ?? "grok-voice-think-fast-1.0";

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  return key;
}

export function getRealtimeModel(): string {
  return REALTIME_MODEL;
}

export async function createRealtimeClientSecret(): Promise<{
  value: string;
  expiresAt: string;
  model: string;
}> {
  const response = await fetch(`${XAI_API_URL}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      expires_after: { seconds: 600 },
      session: { model: REALTIME_MODEL },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Realtime client secret failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    value?: string;
    expires_at?: string;
  };

  if (!data.value) {
    throw new Error("Realtime client secret response did not include a token.");
  }

  return {
    value: data.value,
    expiresAt: data.expires_at ?? new Date(Date.now() + 600_000).toISOString(),
    model: REALTIME_MODEL,
  };
}

export function buildRealtimeWebSocketUrl(): string {
  const url = new URL(XAI_API_URL.replace(/^http/i, "ws"));
  url.pathname = "/v1/realtime";
  url.searchParams.set("model", REALTIME_MODEL);
  return url.toString();
}
