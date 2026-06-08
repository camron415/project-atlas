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
