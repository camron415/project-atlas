/**
 * Streaming PCM playback facade.
 * iOS: AVAudioEngine native module ONLY (no expo-av segment fallback).
 * Other platforms: expo-av segmented fallback.
 */
import { Platform } from "react-native";
import {
  isNativeStreamAudioAvailable,
  startNativeStreamingPlayback,
  stopNativeStreaming,
  prewarmNativeStreaming,
  shutdownNativeStreaming,
} from "atlas-stream-audio";
import {
  startStreamingPcmPlayback as fallbackStart,
  stopStreamingPlayback as fallbackStop,
  type StreamingPcmPlayback,
} from "./pcm-audio";
import { dlog, dwarn } from "./log";

export type { StreamingPcmPlayback };

export async function startStreamingPcmPlayback(
  sampleRate = 24000,
  onFirstAudio?: () => void,
): Promise<StreamingPcmPlayback> {
  if (Platform.OS === "ios") {
    if (!isNativeStreamAudioAvailable()) {
      dwarn("audio", "AVAudioEngine module unavailable on iOS");
      throw new Error("Native stream audio unavailable on iOS");
    }
    dlog("audio", "using native AVAudioEngine stream");
    return startNativeStreamingPlayback(sampleRate, onFirstAudio);
  }

  dlog("audio", "using expo-av segmented fallback");
  return fallbackStart(sampleRate, onFirstAudio);
}

export async function stopStreamingPlayback(): Promise<void> {
  if (Platform.OS === "ios") {
    await stopNativeStreaming();
    return;
  }
  await fallbackStop();
}

/**
 * Create the playback engine ahead of time, while foreground, so the audio
 * session is already active before the screen can lock. iOS forbids activating
 * a session in the background, so this is what makes locked-screen replies work.
 */
export async function prewarmStreamingPlayback(sampleRate = 24000): Promise<void> {
  if (Platform.OS === "ios" && isNativeStreamAudioAvailable()) {
    try {
      await prewarmNativeStreaming(sampleRate);
    } catch (e) {
      dwarn("audio", "prewarm streaming failed (non-fatal)", e);
    }
  }
}

/** Fully release the persistent playback engine + session when the voice session ends. */
export async function shutdownStreamingPlayback(): Promise<void> {
  if (Platform.OS === "ios" && isNativeStreamAudioAvailable()) {
    try {
      await shutdownNativeStreaming();
    } catch (e) {
      dwarn("audio", "shutdown streaming failed (non-fatal)", e);
    }
  }
}
