/**
 * Atlas server connection config.
 *
 * Configure via apps/mobile/.env (EXPO_PUBLIC_ATLAS_SERVER_URL). Expo inlines
 * EXPO_PUBLIC_* variables at build time, so changing this requires restarting
 * the bundler (`expo start -c`).
 *
 * Default is localhost for running on the same Mac as the server. Set the
 * Mac's LAN IP (e.g. http://10.0.0.84:8787) to use a physical iPhone on the
 * same WiFi.
 */
const DEFAULT_SERVER_URL = "http://localhost:8787";

export const ATLAS_SERVER_URL = (
  process.env.EXPO_PUBLIC_ATLAS_SERVER_URL ?? DEFAULT_SERVER_URL
).replace(/\/+$/, "");

export const ATLAS_TTS_VOICE_LABEL = "Rex";

/**
 * Verbose runtime logging for the voice pipeline (STT, WebSocket, audio).
 * Enable by setting EXPO_PUBLIC_ATLAS_DEBUG=1 in apps/mobile/.env, then restart
 * the bundler with `expo start -c`. Logs print to the Metro / device console.
 */
export const ATLAS_DEBUG =
  (process.env.EXPO_PUBLIC_ATLAS_DEBUG ?? "1") === "1";
