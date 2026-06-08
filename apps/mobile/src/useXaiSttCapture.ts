/**
 * Voice capture via Atlas server → xAI streaming STT (Smart Turn endpointing).
 */
import { useCallback, useEffect, useRef } from "react";
import {
  isNativeAudioCaptureAvailable,
  startNativeAudioCapture,
  stopNativeAudioCapture,
} from "atlas-audio-capture";
import { fetchSttConfig } from "./api";
import { dlog } from "./log";
import {
  dominantSttSpeaker,
  openXaiSttSession,
  type SttTranscriptEvent,
  type XaiSttSession,
} from "./xai-stt";
import { LISTEN_WATCHDOG_MS } from "./voice-endpoint";
import type { VoiceCaptureOptions } from "./useVoiceCapture";

const noop = () => {};

export function useXaiSttCapture(options: VoiceCaptureOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeRef = useRef(false);
  const transcriptRef = useRef("");
  const submittedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sttSessionRef = useRef<XaiSttSession | null>(null);
  const stopCaptureFnRef = useRef<(() => Promise<void>) | null>(null);
  const sttSpeakerIdRef = useRef<number | null>(null);

  const getTranscript = () => transcriptRef.current.trim();

  const clearWatchdog = () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const notifyCaptureEnd = () => {
    optionsRef.current.onCaptureEnd?.();
  };

  const clearTranscript = () => {
    transcriptRef.current = "";
    optionsRef.current.onPartial("");
  };

  const teardown = useCallback(async () => {
    clearWatchdog();
    sttSessionRef.current?.close();
    sttSessionRef.current = null;

    if (stopCaptureFnRef.current) {
      const stop = stopCaptureFnRef.current;
      stopCaptureFnRef.current = null;
      await stop();
    } else {
      await stopNativeAudioCapture();
    }
  }, []);

  const forceSubmit = useCallback(async (explicitText?: string) => {
    if (submittedRef.current) return;

    const text = (explicitText ?? transcriptRef.current).trim();
    if (!text) return;

    submittedRef.current = true;
    activeRef.current = false;
    dlog("stt", `xai auto-submit "${text.slice(0, 80)}"`);

    const speakerId = sttSpeakerIdRef.current;
    sttSpeakerIdRef.current = null;
    await teardown();
    clearTranscript();
    await optionsRef.current.onSubmit(text, { sttSpeakerId: speakerId });
  }, [teardown]);

  const armWatchdog = () => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      dlog("stt", "xai watchdog auto-submit");
      void forceSubmit();
    }, LISTEN_WATCHDOG_MS);
  };

  const handleSttEvent = useCallback(
    (event: SttTranscriptEvent) => {
      if (!activeRef.current || submittedRef.current) return;

      if (event.type === "error") {
        activeRef.current = false;
        void teardown();
        clearTranscript();
        notifyCaptureEnd();
        optionsRef.current.onError(event.message ?? "STT error");
        return;
      }

      if (event.type !== "transcript.partial" || !event.text?.trim()) return;

      transcriptRef.current = event.text;
      optionsRef.current.onPartial(event.text);

      const speakerId = dominantSttSpeaker(event.words);
      if (speakerId !== null) {
        sttSpeakerIdRef.current = speakerId;
      }

      if (event.speech_final) {
        const confidence =
          typeof event.end_of_turn_confidence === "number"
            ? event.end_of_turn_confidence.toFixed(2)
            : "n/a";
        dlog("stt", `speech_final (confidence ${confidence})`);
        void forceSubmit(event.text);
      } else if (event.is_final) {
        dlog("stt", "chunk final — still listening");
      }
    },
    [forceSubmit, teardown],
  );

  const startCapture = useCallback(async () => {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native audio capture is not available — rebuild the iOS app.");
    }

    submittedRef.current = false;
    sttSpeakerIdRef.current = null;
    clearWatchdog();
    activeRef.current = true;
    clearTranscript();

    const config = await fetchSttConfig();
    if (!config.enabled) {
      throw new Error("xAI STT is disabled on the Atlas server");
    }

    const session = await openXaiSttSession(handleSttEvent, config);
    sttSessionRef.current = session;
    await session.ready;

    stopCaptureFnRef.current = await startNativeAudioCapture((chunk) => {
      session.sendPcmBase64(chunk.base64);
    });

    armWatchdog();
  }, [handleSttEvent]);

  const stopCapture = useCallback(
    async (submitIfHeard: boolean) => {
      if (submitIfHeard) {
        await forceSubmit();
        return;
      }

      activeRef.current = false;
      await teardown();
      clearTranscript();
      notifyCaptureEnd();
    },
    [forceSubmit, teardown],
  );

  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearWatchdog();
      sttSessionRef.current?.close();
      void stopNativeAudioCapture();
    };
  }, []);

  return {
    startCapture,
    stopCapture,
    forceSubmit,
    getTranscript,
    isActive: () => activeRef.current,
    onSpeechResult: noop,
    onSpeechEnd: noop,
    onSpeechError: noop,
  };
}
