import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { isNativeAudioCaptureAvailable } from "atlas-audio-capture";
import { dlog } from "./log";
import { useVoiceCapture, type VoiceCaptureOptions } from "./useVoiceCapture";
import { useXaiSttCapture } from "./useXaiSttCapture";

export const XAI_STT_REQUESTED = (process.env.EXPO_PUBLIC_XAI_STT ?? "0") === "1";

export const CAN_USE_XAI_STT =
  XAI_STT_REQUESTED && Platform.OS === "ios" && isNativeAudioCaptureAvailable();

/** Apple STT when xAI is off, unavailable, or fails at session start. */
export function useAdaptiveVoiceCapture(options: VoiceCaptureOptions) {
  const appleCapture = useVoiceCapture(options);
  const xaiCapture = useXaiSttCapture(options);
  const activeBackendRef = useRef<"xai" | "apple">(CAN_USE_XAI_STT ? "xai" : "apple");

  const startCapture = useCallback(async () => {
    if (CAN_USE_XAI_STT) {
      try {
        await xaiCapture.startCapture();
        activeBackendRef.current = "xai";
        return;
      } catch (error) {
        dlog("stt", "xAI start failed — falling back to Apple STT", error);
        activeBackendRef.current = "apple";
        options.onError("Grok STT unavailable — using Apple listening.");
        await appleCapture.startCapture();
        return;
      }
    }
    activeBackendRef.current = "apple";
    await appleCapture.startCapture();
  }, [appleCapture, xaiCapture, options]);

  const stopCapture = useCallback(
    async (submitIfHeard: boolean) => {
      if (activeBackendRef.current === "xai") {
        await xaiCapture.stopCapture(submitIfHeard);
        return;
      }
      await appleCapture.stopCapture(submitIfHeard);
    },
    [appleCapture, xaiCapture],
  );

  const forceSubmit = useCallback(
    async (explicitText?: string) => {
      if (activeBackendRef.current === "xai") {
        await xaiCapture.forceSubmit(explicitText);
        return;
      }
      await appleCapture.forceSubmit(explicitText);
    },
    [appleCapture, xaiCapture],
  );

  const getTranscript = useCallback(() => {
    if (activeBackendRef.current === "xai") {
      return xaiCapture.getTranscript();
    }
    return appleCapture.getTranscript();
  }, [appleCapture, xaiCapture]);

  const isActive = useCallback(() => {
    return xaiCapture.isActive() || appleCapture.isActive();
  }, [appleCapture, xaiCapture]);

  return {
    startCapture,
    stopCapture,
    forceSubmit,
    getTranscript,
    isActive,
    onSpeechResult: appleCapture.onSpeechResult,
    onSpeechEnd: appleCapture.onSpeechEnd,
    onSpeechError: appleCapture.onSpeechError,
  };
}

export function voiceCaptureModeLabel(): string {
  return CAN_USE_XAI_STT ? "Grok STT" : "Apple STT";
}
