/**
 * Path B playback facade — atlas-realtime-playback on iOS, pcm-audio fallback elsewhere.
 */
import { Platform } from "react-native";
import {
  isRealtimePlaybackAvailable,
  startRealtimePlayback,
  stopRealtimePlayback,
} from "atlas-realtime-playback";
import {
  startStreamingPcmPlayback as fallbackStart,
  stopStreamingPlayback as fallbackStop,
  type StreamingPcmPlayback,
} from "./pcm-audio";
import { dlog, dwarn } from "./log";

export type { StreamingPcmPlayback };

export async function startUnifiedPcmPlayback(
  sampleRate = 24000,
  onFirstAudio?: () => void,
): Promise<StreamingPcmPlayback> {
  if (Platform.OS === "ios" && isRealtimePlaybackAvailable()) {
    dlog("unified-audio", "using atlas-realtime-playback");
    const handle = await startRealtimePlayback(sampleRate, onFirstAudio);
    return {
      appendBase64Chunk: (chunk) => handle.appendBase64Chunk(chunk),
      finish: () => handle.finish(),
      completion: handle.completion,
      abort: () => handle.abort(),
    };
  }

  dwarn("unified-audio", "native playback unavailable — expo-av fallback");
  return fallbackStart(sampleRate, onFirstAudio);
}

export async function stopUnifiedPcmPlayback(): Promise<void> {
  if (Platform.OS === "ios" && isRealtimePlaybackAvailable()) {
    await stopRealtimePlayback();
    return;
  }
  await fallbackStop();
}
