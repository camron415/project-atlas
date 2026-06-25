/**
 * Atlas server URL resolution.
 *
 * iOS 17+ blocks HTTP to raw IP addresses in native apps (Safari still works).
 * Use Tailscale MagicDNS hostnames (*.ts.net) as the primary URL; keep LAN as
 * fallback at home. ATS exceptions are configured in app.config.ts / Info.plist.
 */
const DEFAULT_SERVER_URL = "http://localhost:8787";

function parseCandidates(raw: string | undefined): string[] {
  if (!raw?.trim()) return [DEFAULT_SERVER_URL];
  const urls = raw
    .split(",")
    .map((part) => part.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return urls.length ? urls : [DEFAULT_SERVER_URL];
}

/** MagicDNS hostname first, then Tailscale IP, then LAN. */
function sortCandidates(urls: string[]): string[] {
  function rank(url: string): number {
    if (url.includes(".ts.net")) return 0;
    if (url.includes("100.")) return 1;
    if (/\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\b/.test(url)) return 2;
    return 3;
  }
  return [...urls].sort((a, b) => rank(a) - rank(b));
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Learned at runtime from /health after a successful remote connection. */
let runtimeCandidates: string[] = [];

/** Register the Mac's current LAN URL (from /health) for faster local fallback. */
export function registerRuntimeServerUrl(base: string): void {
  const normalized = base.trim().replace(/\/+$/, "");
  if (!normalized || runtimeCandidates.includes(normalized)) return;
  runtimeCandidates = [normalized, ...runtimeCandidates];
}

function allCandidates(): string[] {
  return sortCandidates(uniqueUrls([...runtimeCandidates, ...ATLAS_SERVER_URL_CANDIDATES]));
}

export const ATLAS_SERVER_URL_CANDIDATES = sortCandidates(
  parseCandidates(process.env.EXPO_PUBLIC_ATLAS_SERVER_URL),
);

/** First configured URL (shown before probe completes). */
export const ATLAS_SERVER_URL = ATLAS_SERVER_URL_CANDIDATES[0];

export const ATLAS_TTS_VOICE_LABEL = "Rex";

export const ATLAS_DEBUG =
  (process.env.EXPO_PUBLIC_ATLAS_DEBUG ?? "1") === "1";

let resolvedServerUrl: string | null = null;
let lastResolveError: string | null = null;

export function getResolvedServerUrl(): string | null {
  return resolvedServerUrl;
}

export function getLastResolveError(): string | null {
  return lastResolveError;
}

function probeTimeoutMs(base: string): number {
  if (base.includes(".ts.net") || base.includes("100.")) return 15_000;
  return 5_000;
}

async function probeUrl(base: string, timeoutMs?: number): Promise<string> {
  const ms = timeoutMs ?? probeTimeoutMs(base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(`${base}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.ok) return base;
    throw new Error(`${base} → HTTP ${response.status}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${base}: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function probeSequential(candidates: string[]): Promise<string> {
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      return await probeUrl(url);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join(" | "));
}

export async function resolveAtlasServerUrl(force = false): Promise<string> {
  if (resolvedServerUrl && !force) {
    return resolvedServerUrl;
  }

  lastResolveError = null;
  try {
    const base = await probeSequential(allCandidates());
    resolvedServerUrl = base;
    return base;
  } catch (error) {
    resolvedServerUrl = null;
    lastResolveError =
      error instanceof Error ? error.message : "Atlas server unreachable";
    throw new Error(lastResolveError);
  }
}

export function clearResolvedServerUrl(): void {
  resolvedServerUrl = null;
  lastResolveError = null;
}

export function getServerUrlCandidates(): string[] {
  return allCandidates();
}
