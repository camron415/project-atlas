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
  speaker?: {
    slug: string;
    displayName: string;
    role: "owner" | "guest";
  } | null;
}

export interface SpeakerProfile {
  slug: string;
  displayName: string;
  role: "owner" | "guest";
  memorySummary: string;
  greetingStyle: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpeakerResolveResult {
  profile: SpeakerProfile;
  messagePrefix: string;
  instructionsAddon: string;
  mapped: boolean;
}

export interface RealtimeClientSecret {
  value: string;
  expiresAt: string;
  model: string;
  wsUrl: string;
  /** Mac proxy WebSocket URL (Path B unified realtime). */
  proxyWsUrl?: string;
}

/** iOS 17+ blocks WebSocket to raw IPs — use the same resolved hostname as HTTP. */
export function rewriteProxyWsUrl(httpBase: string, proxyWsUrl: string): string {
  try {
    const remote = new URL(proxyWsUrl);
    const local = new URL(httpBase);
    local.protocol = local.protocol === "https:" ? "wss:" : "ws:";
    local.pathname = remote.pathname;
    local.search = remote.search;
    return local.toString();
  } catch {
    return proxyWsUrl;
  }
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

export async function fetchChiefSession(
  sessionKey?: string,
  sttSpeakerId?: number | null,
): Promise<ChiefSession> {
  const params = new URLSearchParams();
  if (sessionKey) params.set("sessionKey", sessionKey);
  if (sttSpeakerId !== undefined && sttSpeakerId !== null && Number.isFinite(sttSpeakerId)) {
    params.set("sttSpeakerId", String(sttSpeakerId));
  }
  const qs = params.toString();
  return getJson<ChiefSession>(`/chief/instructions${qs ? `?${qs}` : ""}`);
}

export async function fetchSpeakers(): Promise<{ speakers: SpeakerProfile[] }> {
  return getJson<{ speakers: SpeakerProfile[] }>("/speakers");
}

export async function updateSpeakerProfile(input: {
  slug: string;
  displayName: string;
  role?: "owner" | "guest";
}): Promise<{ speaker: SpeakerProfile }> {
  return getJson<{ speaker: SpeakerProfile }>("/speakers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function resolveSpeakerProfile(
  sessionKey: string,
  sttSpeakerId: number,
): Promise<SpeakerResolveResult> {
  return getJson<SpeakerResolveResult>("/speakers/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, sttSpeakerId }),
  });
}

export async function resetSpeakerSession(sessionKey: string): Promise<{ cleared: number }> {
  return getJson<{ ok: boolean; cleared: number }>("/speakers/reset-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey }),
  });
}

/**
 * Mint a fresh ephemeral Realtime secret. xAI secrets are single-use per WebSocket —
 * never cache or reuse across turns.
 */
export async function fetchRealtimeClientSecret(): Promise<RealtimeClientSecret> {
  const base = await resolveAtlasServerUrl();
  const secret = await fetchJson<RealtimeClientSecret>(base, "/realtime/client-secret", {
    method: "POST",
  });
  if (secret.proxyWsUrl) {
    secret.proxyWsUrl = rewriteProxyWsUrl(base, secret.proxyWsUrl);
  }
  return secret;
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

let sttConfigCache: SttConfig | null = null;

/** STT config is static per server boot — cache it to avoid a round-trip on every mic resume. */
export async function fetchSttConfig(): Promise<SttConfig> {
  if (sttConfigCache) return sttConfigCache;
  const config = await getJson<SttConfig>("/stt/config");
  sttConfigCache = config;
  return config;
}

export function clearSttConfigCache(): void {
  sttConfigCache = null;
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

export interface ChatSessionMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionMessage {
  id: number;
  session_id: string;
  client_id: string | null;
  role: "user" | "atlas";
  text: string;
  error: number;
  created_at: string;
}

export async function fetchChatSessions(): Promise<ChatSessionMeta[]> {
  const data = await getJson<{ sessions: ChatSessionMeta[] }>("/sessions");
  return data.sessions ?? [];
}

export async function createChatSession(
  id: string,
  title = "New chat",
): Promise<ChatSessionMeta> {
  const data = await getJson<{ session: ChatSessionMeta }>("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });
  return data.session;
}

export async function fetchChatSession(sessionId: string): Promise<{
  session: ChatSessionMeta;
  messages: ChatSessionMessage[];
}> {
  return getJson(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function appendSessionMessage(
  sessionId: string,
  message: {
    clientId?: string;
    role: "user" | "atlas";
    text: string;
    error?: boolean;
  },
): Promise<void> {
  await getJson(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: message.clientId,
      role: message.role,
      text: message.text,
      error: message.error,
    }),
  });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await getJson(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export { getLastResolveError };
