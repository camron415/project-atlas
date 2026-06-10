/**
 * xAI Streaming STT capture.
 *
 * Invariants:
 *  - Native capture applies playAndRecord + spokenAudio (never rely on JS alone).
 *  - Submit closes STT only; mic keeps running until pauseForPlayback (playback prep).
 *  - speech_final is the only auto-submit path (+ debounce, min listen window).
 *  - All transitions serialized via runExclusive.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  isNativeAudioCaptureAvailable,
  startNativeAudioCapture,
  startNativeBackgroundHold,
  stopNativeAudioCapture,
  stopNativeBackgroundHold,
} from "atlas-audio-capture";
import { fetchSttConfig } from "./api";
import { activateVoiceSessionAudio } from "./background-audio";
import { dlog, dwarn } from "./log";
import { applyVoiceAudioMode } from "./speech";
import { stopPlayback } from "./audio";
import { stopStreamingPlayback } from "./stream-audio";
import {
  dominantSttSpeaker,
  openXaiSttSession,
  type SttTranscriptEvent,
  type XaiSttSession,
} from "./xai-stt";
import { applySttPartialEvent, newSttTranscriptState } from "./stt-transcript";
import { computeSilenceSubmitMs, countWords, LISTEN_WATCHDOG_MS } from "./voice-endpoint";
import type { VoiceCaptureOptions } from "./useVoiceCapture";

const noop = () => {};
/** Ignore instant submit right after mic open — blocks false submits on noise. */
const MIN_LISTEN_MS = 800;

type SubmitReason = "silence" | "watchdog" | "manual";

export function useXaiSttCapture(options: VoiceCaptureOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeRef = useRef(false);
  const submittedRef = useRef(false);
  const transcriptRef = useRef("");
  const transcriptStateRef = useRef(newSttTranscriptState());
  const sttSpeakerIdRef = useRef<number | null>(null);
  const listenStartedAtRef = useRef(0);
  const pcmChunksSentRef = useRef(0);
  const lastScheduledTextRef = useRef("");

  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sttSessionRef = useRef<XaiSttSession | null>(null);
  const captureStopFnRef = useRef<(() => Promise<void>) | null>(null);
  const holdActiveRef = useRef(false);

  const listenHandlerRef = useRef<(e: SttTranscriptEvent) => void>(noop);

  const lockRef = useRef<Promise<unknown>>(Promise.resolve());
  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = lockRef.current.then(fn, fn);
    lockRef.current = next.then(noop, noop);
    return next;
  }, []);

  const getTranscript = () => transcriptRef.current.trim();

  const clearTimers = () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  const setTranscript = (text: string) => {
    transcriptRef.current = text;
    optionsRef.current.onPartial(text);
  };

  const clearTranscript = () => {
    transcriptStateRef.current = newSttTranscriptState();
    lastScheduledTextRef.current = "";
    setTranscript("");
  };

  const closeSttSocket = () => {
    sttSessionRef.current?.close();
    sttSessionRef.current = null;
  };

  const stopMicCapture = useCallback(async () => {
    const stop = captureStopFnRef.current;
    captureStopFnRef.current = null;
    if (stop) {
      try { await stop(); } catch { await stopNativeAudioCapture().catch(noop); }
    } else {
      await stopNativeAudioCapture().catch(noop);
    }
  }, []);

  const startBackgroundHold = useCallback(async () => {
    if (holdActiveRef.current) return;
    try {
      await startNativeBackgroundHold();
      holdActiveRef.current = true;
      dlog("stt", "background hold started");
    } catch (error) {
      dwarn("stt", "background hold failed", error);
    }
  }, []);

  const stopBackgroundHold = useCallback(async () => {
    if (!holdActiveRef.current) return;
    try {
      await stopNativeBackgroundHold();
    } catch (error) {
      dwarn("stt", "background hold stop failed", error);
    } finally {
      holdActiveRef.current = false;
    }
  }, []);

  const teardownStt = useCallback(() => {
    clearTimers();
    closeSttSocket();
  }, []);

  const teardownAll = useCallback(async () => {
    teardownStt();
    await stopMicCapture();
    await stopBackgroundHold();
  }, [stopBackgroundHold, stopMicCapture, teardownStt]);

  const emitListenPhase = useCallback(
    (phase: "connecting" | "hearing" | "transcribing") => {
      optionsRef.current.onListenPhase?.(phase);
    },
    [],
  );

  const ensureMicCapture = useCallback(async () => {
    if (captureStopFnRef.current) return;
    await stopBackgroundHold();
    pcmChunksSentRef.current = 0;
    captureStopFnRef.current = await startNativeAudioCapture((chunk) => {
      if (!activeRef.current) return;
      pcmChunksSentRef.current += 1;
      if (pcmChunksSentRef.current === 1) {
        emitListenPhase("hearing");
        dlog("stt", "first pcm chunk → stt");
      }
      sttSessionRef.current?.sendPcmBase64(chunk.base64);
    });
    dlog("stt", "mic capture running");
  }, [emitListenPhase, stopBackgroundHold]);

  const openListenUnit = useCallback(async (quick: boolean) => {
    teardownStt();

    await activateVoiceSessionAudio();
    if (!quick) {
      await stopStreamingPlayback();
      await stopPlayback();
    }
    await applyVoiceAudioMode({ continuousVoice: true });

    const config = await fetchSttConfig();
    if (!config.enabled) throw new Error("xAI STT is disabled on the Atlas server");

    await ensureMicCapture();

    const wasActive = activeRef.current;
    activeRef.current = true;
    emitListenPhase("connecting");

    const session = await openXaiSttSession((e) => listenHandlerRef.current(e), config);
    sttSessionRef.current = session;
    try {
      await session.ready;
    } catch (error) {
      activeRef.current = wasActive;
      sttSessionRef.current = null;
      throw error;
    }

    listenStartedAtRef.current = Date.now();
    dlog("stt", `listen unit open${quick ? " (quick)" : ""}`);
  }, [ensureMicCapture, emitListenPhase, teardownStt]);

  const submitRef = useRef<(text?: string, reason?: SubmitReason) => Promise<void>>(async () => {});

  const armWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      dlog("stt", "watchdog auto-submit");
      void submitRef.current(undefined, "watchdog");
    }, LISTEN_WATCHDOG_MS);
  }, []);

  /** End listening: close STT, hand text to Atlas. Mic stays up until pauseForPlayback. */
  const forceSubmit = useCallback(async (explicitText?: string, reason: SubmitReason = "manual") => {
    if (submittedRef.current) return;
    const text = (explicitText ?? transcriptRef.current).trim();
    if (!text) return;

    submittedRef.current = true;
    activeRef.current = false;
    clearTimers();

    const speakerId = sttSpeakerIdRef.current;
    sttSpeakerIdRef.current = null;
    dlog(
      "stt",
      `submit [${reason}] pcm=${pcmChunksSentRef.current} words=${countWords(text)} "${text.slice(0, 80)}"`,
    );

    closeSttSocket();
    clearTranscript();

    try {
      await optionsRef.current.onSubmit(text, { sttSpeakerId: speakerId });
    } catch (error) {
      submittedRef.current = false;
      throw error;
    }
  }, []);
  submitRef.current = forceSubmit;

  const scheduleSilenceSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const delayMs = computeSilenceSubmitMs(trimmed);
    dlog("stt", `silence timer ${delayMs}ms (${countWords(trimmed)} words)`);
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      if (!activeRef.current || submittedRef.current) return;
      if (Date.now() - listenStartedAtRef.current < MIN_LISTEN_MS) return;
      void forceSubmit(undefined, "silence");
    }, delayMs);
  }, [forceSubmit]);

  const handleListenEvent = useCallback(
    (event: SttTranscriptEvent) => {
      if (!activeRef.current || submittedRef.current) return;

      if (event.type === "error") {
        dwarn("stt", `event error: ${event.message ?? "unknown"}`);
        return;
      }

      if (event.type !== "transcript.partial" || !event.text?.trim()) return;

      const display = applySttPartialEvent(transcriptStateRef.current, {
        text: event.text,
        is_final: event.is_final,
        speech_final: event.speech_final,
      });
      setTranscript(display);
      emitListenPhase("transcribing");

      const speakerId = dominantSttSpeaker(event.words);
      if (speakerId !== null) sttSpeakerIdRef.current = speakerId;

      if (display !== lastScheduledTextRef.current || !silenceTimerRef.current) {
        lastScheduledTextRef.current = display;
        scheduleSilenceSubmit(display);
      }
    },
    [emitListenPhase, scheduleSilenceSubmit],
  );
  listenHandlerRef.current = handleListenEvent;

  const startCapture = useCallback(async () => {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native audio capture is not available — rebuild the iOS app.");
    }
    await runExclusive(async () => {
      submittedRef.current = false;
      sttSpeakerIdRef.current = null;
      clearTranscript();
      await teardownAll();
      await openListenUnit(false);
      armWatchdog();
    });
  }, [armWatchdog, openListenUnit, runExclusive, teardownAll]);

  const resumeListen = useCallback(async () => {
    await runExclusive(async () => {
      if (activeRef.current) return;
      submittedRef.current = false;
      sttSpeakerIdRef.current = null;
      clearTranscript();
      await openListenUnit(true);
      armWatchdog();
    });
  }, [armWatchdog, openListenUnit, runExclusive]);

  const stopCapture = useCallback(async (submitIfHeard: boolean) => {
    if (submitIfHeard && transcriptRef.current.trim()) {
      await forceSubmit(undefined, "manual");
      return;
    }
    await runExclusive(async () => {
      activeRef.current = false;
      submittedRef.current = false;
      await teardownAll();
      clearTranscript();
    });
    optionsRef.current.onCaptureEnd?.();
  }, [forceSubmit, runExclusive, teardownAll]);

  /** Hand mic → playback: stop capture, start silent hold for locked-screen audio. */
  const pauseForPlayback = useCallback(async () => {
    activeRef.current = false;
    teardownStt();
    await runExclusive(async () => {
      if (captureStopFnRef.current) {
        await stopMicCapture();
      }
      await startBackgroundHold();
    });
  }, [runExclusive, startBackgroundHold, stopMicCapture, teardownStt]);

  const resetSession = useCallback(async () => {
    await runExclusive(async () => {
      activeRef.current = false;
      submittedRef.current = false;
      await teardownAll();
      clearTranscript();
    });
  }, [runExclusive, teardownAll]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      void runExclusive(teardownAll);
    };
  }, [runExclusive, teardownAll]);

  return {
    startCapture,
    resumeListen,
    stopCapture,
    pauseForPlayback,
    resetSession,
    forceSubmit,
    getTranscript,
    isActive: () => activeRef.current,
    isListenActive: () => activeRef.current,
    isMonitorActive: () => false,
    isCaptureRunning: () => Boolean(captureStopFnRef.current) || holdActiveRef.current,
    startInterruptMonitor: async (_cb: (t: string) => void) => {},
    stopInterruptMonitor: () => {},
    prefetchListenSession: () => {},
    onSpeechResult: noop,
    onSpeechEnd: noop,
    onSpeechError: noop,
  };
}
