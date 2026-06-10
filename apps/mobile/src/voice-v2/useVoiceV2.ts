/**
 * React hook wrapping VoiceSession — minimal surface matching adaptive voice capture.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { VoiceCaptureOptions } from "../useVoiceCapture";
import { VoiceSession } from "./VoiceSession";
import type { VoiceTurnDeps } from "./types";

const noop = () => {};

export type { VoiceTurnDeps };

export function useVoiceV2(
  options: VoiceCaptureOptions,
  depsRef: MutableRefObject<VoiceTurnDeps>,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sessionRef = useRef<VoiceSession | null>(null);

  const getSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new VoiceSession(
        {
          onPartial: (text) => optionsRef.current.onPartial(text),
          onListenPhase: (phase) => optionsRef.current.onListenPhase?.(phase),
          onError: (message) => optionsRef.current.onError(message),
          onCaptureEnd: () => optionsRef.current.onCaptureEnd?.(),
        },
        () => depsRef.current,
      );
    }
    return sessionRef.current;
  }, [depsRef]);

  const startCapture = useCallback(async () => {
    await getSession().start();
  }, [getSession]);

  const resumeListen = useCallback(async () => {
    await getSession().resumeListen();
  }, [getSession]);

  const stopCapture = useCallback(
    async (_submitIfHeard: boolean) => {
      await getSession().stop();
    },
    [getSession],
  );

  const pauseForPlayback = useCallback(async () => {
    await getSession().pauseForPlayback();
  }, [getSession]);

  const resetSession = useCallback(async () => {
    await getSession().resetSession();
  }, [getSession]);

  const forceSubmit = useCallback(async (_explicitText?: string) => {
    // server_vad handles end-of-turn on Path B
  }, []);

  const markInterrupted = useCallback(() => {
    getSession().markInterrupted();
  }, [getSession]);

  const isSessionHealthy = useCallback(() => getSession().isSessionHealthy(), [getSession]);

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  return {
    startCapture,
    resumeListen,
    stopCapture,
    pauseForPlayback,
    resetSession,
    forceSubmit,
    markInterrupted,
    isSessionHealthy,
    getTranscript: () => getSession().getTranscript(),
    isActive: () => getSession().isActive(),
    isListenActive: () => getSession().isListenActive(),
    isMonitorActive: () => false,
    isCaptureRunning: () => getSession().isCaptureRunning(),
    startInterruptMonitor: async () => {},
    stopInterruptMonitor: () => {},
    prefetchListenSession: () => {},
    onSpeechResult: noop,
    onSpeechEnd: noop,
    onSpeechError: noop,
  };
}
