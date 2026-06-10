import { useCallback, useRef, type MutableRefObject } from "react";
import { useVoiceCapture, type VoiceCaptureOptions } from "./useVoiceCapture";
import { useXaiSttCapture } from "./useXaiSttCapture";
import {
  useUnifiedRealtimeVoice,
  type UnifiedVoiceTurnDeps,
} from "./useUnifiedRealtimeVoice";
import { useVoiceV2, type VoiceTurnDeps } from "./voice-v2";
import {
  CAN_USE_XAI_STT,
  USE_UNIFIED_REALTIME,
  USE_VOICE_V2,
  voiceCaptureModeLabel,
} from "./voice-flags";

export { CAN_USE_XAI_STT, USE_UNIFIED_REALTIME, USE_VOICE_V2, voiceCaptureModeLabel };
export type { UnifiedVoiceTurnDeps, VoiceTurnDeps };

/** Apple STT when xAI is off; Voice v2 / unified Path B when both flags on; else Grok STT. */
export function useAdaptiveVoiceCapture(
  options: VoiceCaptureOptions,
  unifiedDepsRef?: MutableRefObject<UnifiedVoiceTurnDeps | VoiceTurnDeps>,
) {
  const appleCapture = useVoiceCapture(options);
  const xaiCapture = useXaiSttCapture(options);
  const unifiedCapture = useUnifiedRealtimeVoice(
    options,
    unifiedDepsRef ?? {
      current: {
        getInstructions: () => "",
        getVoice: () => "rex",
        getHistory: () => [],
        isDeep: () => false,
        isRefresh: () => false,
        isResearch: () => false,
        onUserMessage: () => {},
        onAtlasDelta: () => {},
        onAtlasComplete: () => {},
        onStatus: () => {},
        onDeepTurn: async () => {},
        onRefresh: async () => {},
        onMoment: async () => {},
        getLocationPrefix: async () => null,
      },
    },
  );
  const voiceV2Capture = useVoiceV2(
    options,
    unifiedDepsRef ?? {
      current: {
        getInstructions: () => "",
        getVoice: () => "rex",
        getHistory: () => [],
        isDeep: () => false,
        isRefresh: () => false,
        isResearch: () => false,
        onUserMessage: () => {},
        onAtlasDelta: () => {},
        onAtlasComplete: () => {},
        onStatus: () => {},
        onDeepTurn: async () => {},
        onRefresh: async () => {},
        onMoment: async () => {},
        getLocationPrefix: async () => null,
      },
    },
  );

  const pathBCapture = USE_VOICE_V2 ? voiceV2Capture : unifiedCapture;

  const activeBackendRef = useRef<"unified" | "xai" | "apple">(
    USE_UNIFIED_REALTIME ? "unified" : CAN_USE_XAI_STT ? "xai" : "apple",
  );

  const startCapture = useCallback(async () => {
    if (USE_UNIFIED_REALTIME) {
      await pathBCapture.startCapture();
      activeBackendRef.current = "unified";
      return;
    }
    if (CAN_USE_XAI_STT) {
      await xaiCapture.startCapture();
      activeBackendRef.current = "xai";
      return;
    }
    activeBackendRef.current = "apple";
    await appleCapture.startCapture();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const pauseForPlayback = useCallback(async () => {
    if (activeBackendRef.current === "unified") {
      await pathBCapture.pauseForPlayback();
      return;
    }
    if (activeBackendRef.current === "xai") {
      await xaiCapture.pauseForPlayback();
    }
  }, [pathBCapture, xaiCapture]);

  const resumeListen = useCallback(async () => {
    if (activeBackendRef.current === "unified") {
      await pathBCapture.resumeListen();
      return;
    }
    if (activeBackendRef.current === "xai") {
      await xaiCapture.resumeListen();
      return;
    }
    await appleCapture.startCapture();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const resetSession = useCallback(async () => {
    if (activeBackendRef.current === "unified") {
      await pathBCapture.resetSession();
      return;
    }
    if (activeBackendRef.current === "xai") {
      await xaiCapture.resetSession();
      return;
    }
    await appleCapture.stopCapture(false);
  }, [appleCapture, pathBCapture, xaiCapture]);

  const stopCapture = useCallback(
    async (submitIfHeard: boolean) => {
      if (activeBackendRef.current === "unified") {
        await pathBCapture.stopCapture(submitIfHeard);
        return;
      }
      if (activeBackendRef.current === "xai") {
        await xaiCapture.stopCapture(submitIfHeard);
        return;
      }
      await appleCapture.stopCapture(submitIfHeard);
    },
    [appleCapture, pathBCapture, xaiCapture],
  );

  const forceSubmit = useCallback(
    async (explicitText?: string) => {
      if (activeBackendRef.current === "unified") {
        await pathBCapture.forceSubmit(explicitText);
        return;
      }
      if (activeBackendRef.current === "xai") {
        await xaiCapture.forceSubmit(explicitText);
        return;
      }
      await appleCapture.forceSubmit(explicitText);
    },
    [appleCapture, pathBCapture, xaiCapture],
  );

  const markInterrupted = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      pathBCapture.markInterrupted();
    }
  }, [pathBCapture]);

  const startInterruptMonitor = useCallback(
    async (onBargeIn: (text: string) => void) => {
      if (activeBackendRef.current === "xai") {
        await xaiCapture.startInterruptMonitor(onBargeIn);
      }
    },
    [xaiCapture],
  );

  const stopInterruptMonitor = useCallback(() => {
    if (activeBackendRef.current === "xai") {
      xaiCapture.stopInterruptMonitor();
    }
  }, [xaiCapture]);

  const prefetchListenSession = useCallback(() => {
    if (activeBackendRef.current === "xai") {
      void xaiCapture.prefetchListenSession();
    }
  }, [xaiCapture]);

  const getTranscript = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      return pathBCapture.getTranscript();
    }
    if (activeBackendRef.current === "xai") {
      return xaiCapture.getTranscript();
    }
    return appleCapture.getTranscript();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const isActive = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      return pathBCapture.isActive();
    }
    if (activeBackendRef.current === "xai") {
      return xaiCapture.isActive();
    }
    return appleCapture.isActive();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const isListenActive = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      return pathBCapture.isListenActive();
    }
    if (activeBackendRef.current === "xai") {
      return xaiCapture.isListenActive();
    }
    return appleCapture.isActive();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const isSessionHealthy = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      return pathBCapture.isSessionHealthy();
    }
    return activeBackendRef.current === "xai"
      ? xaiCapture.isListenActive()
      : appleCapture.isActive();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const isCaptureRunning = useCallback(() => {
    if (activeBackendRef.current === "unified") {
      return pathBCapture.isCaptureRunning();
    }
    if (activeBackendRef.current === "xai") {
      return xaiCapture.isCaptureRunning();
    }
    return appleCapture.isActive();
  }, [appleCapture, pathBCapture, xaiCapture]);

  const isMonitorActive = useCallback(() => {
    if (activeBackendRef.current === "xai") {
      return xaiCapture.isMonitorActive();
    }
    return false;
  }, [xaiCapture]);

  return {
    startCapture,
    pauseForPlayback,
    resumeListen,
    resetSession,
    stopCapture,
    forceSubmit,
    markInterrupted,
    startInterruptMonitor,
    stopInterruptMonitor,
    prefetchListenSession,
    getTranscript,
    isActive,
    isListenActive,
    isMonitorActive,
    isCaptureRunning,
    isSessionHealthy,
    onSpeechResult: appleCapture.onSpeechResult,
    onSpeechEnd: appleCapture.onSpeechEnd,
    onSpeechError: appleCapture.onSpeechError,
  };
}
