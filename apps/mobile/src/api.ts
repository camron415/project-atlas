import { ATLAS_SERVER_URL } from "./config";

export interface AtlasHealth {
  ok: boolean;
  service?: string;
  version?: string;
  url?: string;
  lanIp?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChiefSession {
  instructions: string;
  model: string;
  voice: string;
}

export interface RealtimeClientSecret {
  value: string;
  expiresAt: string;
  model: string;
  wsUrl: string;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ATLAS_SERVER_URL}${path}`, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      (data && typeof data.error === "string" && data.error) ||
      `Atlas server error (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function checkHealth(): Promise<AtlasHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    return await getJson<AtlasHealth>("/health", { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchChiefSession(): Promise<ChiefSession> {
  return getJson<ChiefSession>("/chief/instructions");
}

export async function fetchRealtimeClientSecret(): Promise<RealtimeClientSecret> {
  return getJson<RealtimeClientSecret>("/realtime/client-secret", { method: "POST" });
}

export interface TtsResponse {
  audio: string | null;
  audioFormat: string;
  audioError?: string;
}

export async function fetchTtsAudio(text: string): Promise<TtsResponse> {
  return getJson<TtsResponse>("/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export interface ChiefDeepReply {
  raw: string;
  filtered: string;
  model: string;
  deep: boolean;
}

/** Deep-reasoning turn: routes server-side to XAI_DEEP_MODEL, returns text. */
export async function askChiefDeep(
  message: string,
  history: ChatTurn[],
  interrupted = false,
  signal?: AbortSignal,
): Promise<ChiefDeepReply> {
  return getJson<ChiefDeepReply>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, interrupted, deep: true }),
    signal,
  });
}

export interface RefreshResponse {
  scanned: number;
  refreshed: number;
  forced: boolean;
  deep?: boolean;
}

/** Force a rescan of project files so the next turn sees the latest content. */
export async function refreshReports(force = true, deep = false): Promise<RefreshResponse> {
  return getJson<RefreshResponse>("/reports/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force, deep }),
  });
}

export function buildWsUrl(model: string): string {
  return `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`;
}
