import {
  resolveAtlasServerUrl,
  clearResolvedServerUrl,
  getLastResolveError,
} from "./config";

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

async function fetchJson<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { Accept: "application/json", ...init?.headers },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message =
        (data && typeof data.error === "string" && data.error) ||
        `Atlas server error (${response.status})`;
      throw new Error(message);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const base = await resolveAtlasServerUrl(attempt > 0);
      return await fetchJson<T>(base, path, init);
    } catch (error) {
      clearResolvedServerUrl();
      if (attempt === 1) throw error;
    }
  }
  throw new Error(getLastResolveError() ?? "Atlas server unreachable");
}

export async function checkHealth(force = false): Promise<AtlasHealth> {
  if (force) clearResolvedServerUrl();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const base = await resolveAtlasServerUrl(force || attempt > 0);
      return await fetchJson<AtlasHealth>(base, "/health");
    } catch (error) {
      clearResolvedServerUrl();
      if (attempt === 1) throw error;
    }
  }
  throw new Error(getLastResolveError() ?? "Atlas server unreachable");
}

export async function fetchChiefSession(): Promise<ChiefSession> {
  return getJson<ChiefSession>("/chief/instructions");
}

export async function fetchRealtimeClientSecret(): Promise<RealtimeClientSecret> {
  return getJson<RealtimeClientSecret>("/realtime/client-secret", { method: "POST" });
}

export interface SttConfig {
  enabled: boolean;
  sampleRate: number;
  encoding: "pcm";
  interimResults: boolean;
  smartTurn: number | null;
  smartTurnTimeoutMs: number | null;
  diarize: boolean;
  language: string;
  keyterms: string[];
  wsPath: string;
}

export async function fetchSttConfig(): Promise<SttConfig> {
  return getJson<SttConfig>("/stt/config");
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

export interface TranscriptLine {
  ts: string;
  role: "user" | "atlas";
  text: string;
}

/** Append one conversation line to the Mac transcript log (best-effort). */
export async function postTranscriptLine(entry: TranscriptLine): Promise<void> {
  await getJson<{ ok: boolean }>("/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export function buildWsUrl(model: string): string {
  return `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`;
}

export { getLastResolveError };
