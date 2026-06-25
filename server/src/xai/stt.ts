const XAI_API_URL = process.env.XAI_API_URL ?? "https://api.x.ai/v1";

export interface SttSessionConfig {
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

function parseKeyterms(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return ["Atlas", "VocalLearn", "Grok"];
  }
  return raw
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 100);
}

// Higher threshold = Smart Turn must be more confident the speaker finished
// before ending the turn, so natural mid-thought pauses aren't clipped.
function parseSmartTurn(raw: string | undefined): number | null {
  if (!raw?.trim()) return 0.72;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return 0.72;
  return value;
}

// Max silence (ms) before Smart Turn forces speech_final.
function parseSmartTurnTimeout(raw: string | undefined): number | null {
  if (!raw?.trim()) return 2500;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > 12000) return 2500;
  return Math.round(value);
}

export function isSttEnabled(): boolean {
  return process.env.ATLAS_STT_ENABLED !== "0" && Boolean(process.env.XAI_API_KEY);
}

export function getSttSessionConfig(): SttSessionConfig {
  const smartTurn = parseSmartTurn(process.env.ATLAS_STT_SMART_TURN);
  const smartTurnTimeoutMs = parseSmartTurnTimeout(
    process.env.ATLAS_STT_SMART_TURN_TIMEOUT,
  );

  return {
    enabled: isSttEnabled(),
    sampleRate: 16000,
    encoding: "pcm",
    interimResults: true,
    smartTurn,
    smartTurnTimeoutMs,
    diarize: process.env.ATLAS_STT_DIARIZE !== "0",
    language: process.env.ATLAS_STT_LANGUAGE ?? "en",
    keyterms: parseKeyterms(process.env.ATLAS_STT_KEYTERMS),
    wsPath: "/stt/stream",
  };
}

export function getXaiApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  return key;
}

/** Upstream xAI STT WebSocket URL (server-side only). */
export function buildXaiSttWebSocketUrl(config: SttSessionConfig = getSttSessionConfig()): string {
  const url = new URL(XAI_API_URL.replace(/^http/i, "ws"));
  url.pathname = "/v1/stt";
  url.searchParams.set("sample_rate", String(config.sampleRate));
  url.searchParams.set("encoding", config.encoding);
  url.searchParams.set("interim_results", config.interimResults ? "true" : "false");
  url.searchParams.set("language", config.language);

  if (config.smartTurn !== null) {
    url.searchParams.set("smart_turn", String(config.smartTurn));
    if (config.smartTurnTimeoutMs !== null) {
      url.searchParams.set("smart_turn_timeout", String(config.smartTurnTimeoutMs));
    }
  }

  if (config.diarize) {
    url.searchParams.set("diarize", "true");
  }

  for (const term of config.keyterms) {
    url.searchParams.append("keyterm", term);
  }

  return url.toString();
}
