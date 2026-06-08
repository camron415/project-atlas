/**
 * Voice capture — adaptive end-of-speech (ChatGPT-style longer pause tolerance).
 */
import { useCallback, useEffect, useRef } from "react";
import {
  abortListening,
  softStopRecognition,
  startListening,
  stopListening,
} from "./speech";
import { dlog } from "./log";
import { computeSilenceSubmitMs, LISTEN_WATCHDOG_MS } from "./voice-endpoint";

const IGNORE_END_MS = 900;
const IGNORE_ERROR_MS = 800;

const IGNORABLE_MIC_ERRORS = new Set([
  "aborted",
  "no-speech",
  "interrupted",
  "cancelled",
]);

export interface VoiceSubmitMeta {
  sttSpeakerId?: number | null;
}

export interface VoiceCaptureOptions {
  onPartial: (text: string) => void;
  onSubmit: (text: string, meta?: VoiceSubmitMeta) => void | Promise<void>;
  onError: (message: string) => void;
  onCaptureEnd?: () => void;
}

export function useVoiceCapture(options: VoiceCaptureOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeRef = useRef(false);
  const transcriptRef = useRef("");
  const submittedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenStartInFlightRef = useRef(false);
  const ignoreEndUntilRef = useRef(0);
  const ignoreErrorUntilRef = useRef(0);
  const restartInFlightRef = useRef(false);
  const lastScheduledTextRef = useRef("");

  const getTranscript = () => transcriptRef.current.trim();

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const clearWatchdog = () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const forceSubmitRef = useRef<(text?: string) => Promise<void>>(async () => {});
  const restartMicRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSubmitRef = useRef<(text: string) => void>(() => {});

  const notifyCaptureEnd = () => {
    optionsRef.current.onCaptureEnd?.();
  };

  const clearTranscript = () => {
    transcriptRef.current = "";
    lastScheduledTextRef.current = "";
    optionsRef.current.onPartial("");
  };

  const forceSubmit = useCallback(async (explicitText?: string) => {
    if (submittedRef.current) return;

    const text = (explicitText ?? transcriptRef.current).trim();
    if (!text) return;

    submittedRef.current = true;
    activeRef.current = false;
    clearSilenceTimer();
    clearWatchdog();
    ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;
    dlog("stt", `auto-submit "${text.slice(0, 80)}"`);

    try {
      await stopListening();
    } catch {}

    clearTranscript();
    await optionsRef.current.onSubmit(text);
  }, []);

  forceSubmitRef.current = forceSubmit;

  const scheduleSubmit = useCallback((text: string) => {
    const delayMs = computeSilenceSubmitMs(text);
    clearSilenceTimer();
    dlog("stt", `silence timer ${delayMs}ms (${text.trim().split(/\s+/).filter(Boolean).length} words)`);
    silenceTimerRef.current = setTimeout(() => {
      void forceSubmitRef.current();
    }, delayMs);
  }, []);

  scheduleSubmitRef.current = scheduleSubmit;

  const stopCapture = useCallback(async (submitIfHeard: boolean) => {
    if (submitIfHeard) {
      await forceSubmitRef.current();
      return;
    }

    activeRef.current = false;
    clearSilenceTimer();
    clearWatchdog();
    ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;

    try {
      await stopListening();
    } catch {}

    clearTranscript();
    notifyCaptureEnd();
  }, []);

  const armWatchdog = () => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      dlog("stt", "watchdog auto-submit (max listen duration)");
      void forceSubmitRef.current();
    }, LISTEN_WATCHDOG_MS);
  };

  const handleTranscript = (text: string, isFinal: boolean) => {
    transcriptRef.current = text;
    optionsRef.current.onPartial(text);

    // Never instant-send on iOS "final" segments — only sustained silence sends.
    // Finals often fire mid-sentence when you pause to think.
    if (text !== lastScheduledTextRef.current || !silenceTimerRef.current) {
      lastScheduledTextRef.current = text;
      scheduleSubmitRef.current(text);
    }

    if (isFinal) {
      dlog("stt", `segment final (${text.trim().split(/\s+/).filter(Boolean).length} words) — waiting for silence`);
    }
  };

  const openMic = useCallback(async () => {
    listenStartInFlightRef.current = true;
    ignoreEndUntilRef.current = Date.now() + IGNORE_END_MS;
    ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;
    try {
      await startListening({ continuous: true });
      listenStartInFlightRef.current = false;
      ignoreEndUntilRef.current = Date.now() + IGNORE_END_MS;
      ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;
      armWatchdog();
    } catch (error) {
      listenStartInFlightRef.current = false;
      activeRef.current = false;
      optionsRef.current.onError(
        error instanceof Error ? error.message : "Could not start listening.",
      );
      notifyCaptureEnd();
      throw error;
    }
  }, []);

  const restartMic = useCallback(async () => {
    if (!activeRef.current || submittedRef.current || restartInFlightRef.current) return;
    if (getTranscript()) return;
    restartInFlightRef.current = true;
    try {
      listenStartInFlightRef.current = true;
      ignoreEndUntilRef.current = Date.now() + IGNORE_END_MS;
      ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;
      softStopRecognition();
      await startListening({ continuous: true });
      listenStartInFlightRef.current = false;
      ignoreEndUntilRef.current = Date.now() + IGNORE_END_MS;
      ignoreErrorUntilRef.current = Date.now() + IGNORE_ERROR_MS;
      armWatchdog();
    } catch {
      activeRef.current = false;
      clearSilenceTimer();
      clearWatchdog();
      clearTranscript();
      notifyCaptureEnd();
    } finally {
      restartInFlightRef.current = false;
    }
  }, []);

  restartMicRef.current = restartMic;

  const startCapture = useCallback(async () => {
    submittedRef.current = false;
    lastScheduledTextRef.current = "";
    clearSilenceTimer();
    clearWatchdog();
    activeRef.current = true;
    clearTranscript();
    await openMic();
  }, [openMic]);

  const onSpeechResult = useCallback(
    (event: { isFinal: boolean; results?: { transcript?: string }[] }) => {
      if (!activeRef.current || submittedRef.current) return;
      listenStartInFlightRef.current = false;

      const text = event.results?.[0]?.transcript ?? "";
      if (!text.trim()) return;

      handleTranscript(text, event.isFinal);
    },
    [],
  );

  const onSpeechEnd = useCallback(() => {
    if (submittedRef.current) return;

    const text = getTranscript();
    if (text) {
      // Session paused — wait adaptive silence; don't cut off on a brief end event.
      scheduleSubmitRef.current(text);
      return;
    }

    if (!activeRef.current) return;
    if (listenStartInFlightRef.current || Date.now() < ignoreEndUntilRef.current) {
      return;
    }

    void restartMicRef.current();
  }, []);

  const onSpeechError = useCallback((event: { error?: string }) => {
    if (submittedRef.current) return;

    const code = String(event.error ?? "unknown");
    if (
      IGNORABLE_MIC_ERRORS.has(code) ||
      listenStartInFlightRef.current ||
      restartInFlightRef.current ||
      Date.now() < ignoreErrorUntilRef.current
    ) {
      if (code === "no-speech" && !submittedRef.current) {
        const text = getTranscript();
        if (text) {
          scheduleSubmitRef.current(text);
        } else if (activeRef.current) {
          void restartMicRef.current();
        }
      }
      return;
    }

    dlog("stt", `unhandled mic error: ${code}`);
    activeRef.current = false;
    clearSilenceTimer();
    clearWatchdog();
    clearTranscript();
    notifyCaptureEnd();
    optionsRef.current.onError(`Mic error: ${code}`);
  }, []);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearSilenceTimer();
      clearWatchdog();
      abortListening();
    };
  }, []);

  return {
    startCapture,
    stopCapture,
    forceSubmit,
    getTranscript,
    isActive: () => activeRef.current,
    onSpeechResult,
    onSpeechEnd,
    onSpeechError,
  };
};
