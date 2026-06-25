import { Platform } from "react-native";
import { isNativeAudioCaptureAvailable } from "atlas-audio-capture";
import { isRealtimePlaybackAvailable } from "atlas-realtime-playback";

export const XAI_STT_REQUESTED = (process.env.EXPO_PUBLIC_XAI_STT ?? "0") === "1";

export const REALTIME_UNIFIED_REQUESTED =
  (process.env.EXPO_PUBLIC_REALTIME_UNIFIED ?? "0") === "1";

/** Voice v2 rewrite — default on; set EXPO_PUBLIC_VOICE_V2=0 to rollback to legacy unified hook. */
export const VOICE_V2_REQUESTED = (process.env.EXPO_PUBLIC_VOICE_V2 ?? "1") === "1";

/** Economy voice: Grok STT + /voice/plan-turn (chat + TTS). No Realtime API billing. */
export const VOICE_ECONOMY_REQUESTED =
  (process.env.EXPO_PUBLIC_VOICE_ECONOMY ?? "0") === "1";

export const CAN_USE_XAI_STT =
  XAI_STT_REQUESTED && Platform.OS === "ios" && isNativeAudioCaptureAvailable();

/** Path B: single Realtime WS + server VAD (requires native capture + playback). */
export const USE_UNIFIED_REALTIME =
  !VOICE_ECONOMY_REQUESTED &&
  REALTIME_UNIFIED_REQUESTED &&
  XAI_STT_REQUESTED &&
  Platform.OS === "ios" &&
  isNativeAudioCaptureAvailable() &&
  isRealtimePlaybackAvailable();

export const USE_VOICE_V2 = VOICE_V2_REQUESTED && USE_UNIFIED_REALTIME;

/** STT listen + plan-turn reply — default for long road sessions. */
export const USE_VOICE_ECONOMY =
  VOICE_ECONOMY_REQUESTED && Platform.OS === "ios";

export function voiceCaptureModeLabel(): string {
  if (USE_VOICE_ECONOMY) return "FT3 economy";
  if (USE_VOICE_V2) return "Voice v2";
  if (USE_UNIFIED_REALTIME) return "Unified Realtime";
  if (CAN_USE_XAI_STT) return "Grok STT";
  return "Apple STT";
}
