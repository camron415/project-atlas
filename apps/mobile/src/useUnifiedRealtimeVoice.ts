/**
 * Path B voice capture — single Realtime WS + server VAD.
 * Serialized state machine; no Grok STT silence timers.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  isNativeAudioCaptureAvailable,
  releaseNativeAudioSession,
  startNativeAudioCapture,
  startNativeBackgroundHold,
  stopNativeAudioCapture,
  stopNativeBackgroundHold,
} from "atlas-audio-capture";
import type { ChatTurn } from "./api";
import { fetchRealtimeClientSecret } from "./api";
import { activateVoiceSessionAudio } from "./background-audio";
import { dlog, dwarn } from "./log";
import { applyVoiceAudioMode, ensureSpeechReady, prepareForNativeStream } from "./speech";
import { stopPlayback } from "./audio";
import { startUnifiedPcmPlayback, stopUnifiedPcmPlayback } from "./realtime-playback";
import {
  connectUnifiedRealtime,
  type UnifiedRealtimeClient,
} from "./unified-realtime-client";
import type { VoiceCaptureOptions } from "./useVoiceCapture";

const noop = () => {};

/** Wait for trailing words after VAD pause — single commit per utterance. */
const TURN_COMMIT_MS = 1400;

type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export interface UnifiedVoiceTurnDeps {
  getInstructions: () => string;
  getVoice: () => string;
  getHistory: () => ChatTurn[];
  isDeep: (text: string) => boolean;
  isRefresh: (text: string) => boolean;
  isResearch: (text: string) => boolean;
  onUserMessage: (text: string) => void;
  onAtlasDelta: (text: string) => void;
  onAtlasComplete: (text: string) => void;
  onStatus: (status: "listening" | "thinking" | "speaking") => void;
  onDeepTurn: (
    text: string,
    history: ChatTurn[],
    interrupted: boolean,
    afterHold: boolean,
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onMoment: () => Promise<void>;
  getLocationPrefix: () => Promise<string | null>;
}

function isClientLive(client: UnifiedRealtimeClient | null): boolean {
  return Boolean(client?.isOpen() && client.isConfigured());
}

export function useUnifiedRealtimeVoice(
  options: VoiceCaptureOptions,
  depsRef: MutableRefObject<UnifiedVoiceTurnDeps>,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const phaseRef = useRef<VoicePhase>("idle");
  const activeRef = useRef(false);
  const interruptedRef = useRef(false);

  const clientRef = useRef<UnifiedRealtimeClient | null>(null);
  const sessionGenRef = useRef(0);
  const captureStopRef = useRef<(() => Promise<void>) | null>(null);
  const micStreamPromiseRef = useRef<Promise<void> | null>(null);
  const holdActiveRef = useRef(false);
  const playbackRef = useRef<Awaited<ReturnType<typeof startUnifiedPcmPlayback>> | null>(null);
  const playbackChainRef = useRef<Promise<void>>(Promise.resolve());
  const turnInFlightRef = useRef(false);
  const atlasTextRef = useRef("");
  const turnTranscriptRef = useRef("");
  const lastCommittedTextRef = useRef("");
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lockRef = useRef<Promise<unknown>>(Promise.resolve());
  const runExclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = lockRef.current.then(fn, fn);
    lockRef.current = next.then(noop, noop);
    return next;
  }, []);

  const setPhase = (phase: VoicePhase) => {
    phaseRef.current = phase;
    if (phase === "listening") depsRef.current.onStatus("listening");
    if (phase === "thinking") depsRef.current.onStatus("thinking");
    if (phase === "speaking") depsRef.current.onStatus("speaking");
  };

  const emitListenPhase = useCallback(
    (p: "connecting" | "hearing" | "transcribing") => {
      optionsRef.current.onListenPhase?.(p);
    },
    [],
  );

  const stopMicCapture = useCallback(async () => {
    const stop = captureStopRef.current;
    captureStopRef.current = null;
    if (!stop) return;
    try {
      await stop();
    } catch {
      await stopNativeAudioCapture().catch(noop);
    }
  }, []);

  const startBackgroundHold = useCallback(async () => {
    if (holdActiveRef.current) return;
    try {
      await startNativeBackgroundHold();
      holdActiveRef.current = true;
    } catch (e) {
      dwarn("unified", "background hold failed", e);
    }
  }, []);

  const stopBackgroundHold = useCallback(async () => {
    if (!holdActiveRef.current) return;
    try {
      await stopNativeBackgroundHold();
    } catch {}
    holdActiveRef.current = false;
  }, []);

  const closeClient = useCallback(() => {
    sessionGenRef.current += 1;
    const client = clientRef.current;
    clientRef.current = null;
    client?.close();
  }, []);

  const stopPlaybackPipeline = useCallback(async () => {
    playbackRef.current = null;
    playbackChainRef.current = Promise.resolve();
    await stopUnifiedPcmPlayback();
    await stopPlayback();
  }, []);

  /**
   * Start mic capture exactly once. PCM is buffered client-side until Realtime is configured.
   * INVARIANT: only call from ensureMicStreaming / restartMicStreaming — never from event handlers.
   */
  const ensureMicStreaming = useCallback(async () => {
    if (captureStopRef.current) return;
    if (micStreamPromiseRef.current) return micStreamPromiseRef.current;

    const work = (async () => {
      if (captureStopRef.current) return;
      await stopBackgroundHold();
      await applyVoiceAudioMode({ continuousVoice: true });
      let firstChunk = false;
      const stop = await startNativeAudioCapture((chunk) => {
        if (!activeRef.current) return;
        if (phaseRef.current === "speaking") return;
        if (!firstChunk) {
          firstChunk = true;
          dlog("unified", "first pcm chunk");
        }
        clientRef.current?.appendMicPcmBase64(chunk.base64);
      });
      captureStopRef.current = stop;
    })().finally(() => {
      micStreamPromiseRef.current = null;
    });

    micStreamPromiseRef.current = work;
    return work;
  }, [emitListenPhase, stopBackgroundHold]);

  /** After speak / background hold — stop then start fresh. Do NOT use on initial session open. */
  const restartMicStreaming = useCallback(async () => {
    await stopMicCapture();
    await ensureMicStreaming();
  }, [ensureMicStreaming, stopMicCapture]);

  const finishPlayback = useCallback(async () => {
    await playbackChainRef.current;
    if (playbackRef.current) {
      await playbackRef.current.finish();
      await playbackRef.current.completion;
    }
    playbackRef.current = null;
  }, []);

  const clearTurnCommitTimer = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const handleUserTurn = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || turnInFlightRef.current) return;
      if (clean === lastCommittedTextRef.current) return;

      turnInFlightRef.current = true;
      lastCommittedTextRef.current = clean;
      const deps = depsRef.current;
      const interrupted = interruptedRef.current;
      interruptedRef.current = false;

      setPhase("thinking");
      emitListenPhase("transcribing");
      deps.onUserMessage(clean);
      turnTranscriptRef.current = "";
      optionsRef.current.onPartial("");

      const history = deps.getHistory();
      const deep = deps.isDeep(clean);
      const needsRefresh = deps.isRefresh(clean);
      const needsResearch = deps.isResearch(clean);
      const needsMoment = deep || needsRefresh || needsResearch;

      try {
        if (!isClientLive(clientRef.current)) {
          throw new Error("Voice connection lost — tap mic to reconnect.");
        }

        if (needsMoment) {
          await stopMicCapture();
          await deps.onMoment();
          await stopPlaybackPipeline();
        }

        if (needsRefresh) {
          await deps.onRefresh();
        }

        let messageForAtlas = clean;
        if (needsResearch) {
          const loc = await deps.getLocationPrefix();
          if (loc) messageForAtlas = `${loc} ${clean}`;
        }

        if (deep) {
          clientRef.current?.cancelResponse();
          await stopPlaybackPipeline();
          await deps.onDeepTurn(messageForAtlas, history, interrupted, needsMoment);
          setPhase("listening");
          await restartMicStreaming();
          return;
        }

        await prepareForNativeStream({ continuousVoice: true });
        clientRef.current?.requestResponse();
        atlasTextRef.current = "";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        optionsRef.current.onError(msg);
        lastCommittedTextRef.current = "";
        setPhase("listening");
        await restartMicStreaming();
      } finally {
        turnInFlightRef.current = false;
      }
    },
    [depsRef, emitListenPhase, restartMicStreaming, stopMicCapture, stopPlaybackPipeline],
  );

  const scheduleTurnCommit = useCallback(() => {
    clearTurnCommitTimer();
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      const text = turnTranscriptRef.current.trim();
      if (!text) return;
      void handleUserTurn(text);
    }, TURN_COMMIT_MS);
  }, [clearTurnCommitTimer, handleUserTurn]);

  const handleRealtimeEvent = useCallback(
    (event: Parameters<Parameters<typeof connectUnifiedRealtime>[2]>[0]) => {
      if (event.type === "configured") {
        dlog("unified", `configured session=${event.sessionId ?? ""}`);
        return;
      }
      if (event.type === "speech_started") {
        clearTurnCommitTimer();
        return;
      }
      if (event.type === "speech_stopped") {
        scheduleTurnCommit();
        return;
      }
      if (event.type === "user_transcript") {
        turnTranscriptRef.current = event.text;
        optionsRef.current.onPartial(event.text);
        return;
      }
      if (event.type === "atlas_text_delta") {
        atlasTextRef.current = event.text;
        depsRef.current.onAtlasDelta(event.text);
        return;
      }
      if (event.type === "audio_delta") {
        playbackChainRef.current = playbackChainRef.current.then(async () => {
          const enteringSpeak = phaseRef.current !== "speaking";
          if (enteringSpeak) {
            setPhase("speaking");
            await prepareForNativeStream({ continuousVoice: true });
          }
          if (!playbackRef.current) {
            playbackRef.current = await startUnifiedPcmPlayback(24000, () => {
              depsRef.current.onStatus("speaking");
            });
          }
          await playbackRef.current.appendBase64Chunk(event.base64);
          if (enteringSpeak) {
            setTimeout(() => {
              void stopMicCapture().then(() => startBackgroundHold());
            }, 220);
          }
        });
        return;
      }
      if (event.type === "response_done") {
        void (async () => {
          await playbackChainRef.current;
          await finishPlayback();
          await new Promise((resolve) => setTimeout(resolve, 150));
          const reply = atlasTextRef.current.trim();
          if (reply) depsRef.current.onAtlasComplete(reply);
          atlasTextRef.current = "";
          if (!isClientLive(clientRef.current)) {
            activeRef.current = false;
            setPhase("idle");
            optionsRef.current.onError("Voice connection ended — tap mic to continue.");
            return;
          }
          setPhase("listening");
          emitListenPhase("hearing");
          await restartMicStreaming();
          const m = clientRef.current?.metrics();
          if (m) {
            dlog(
              "unified",
              `turn complete connect=${m.realtimeConnectMs ?? "?"}ms firstAudio=${m.firstAudioDeltaMs ?? "?"}ms total=${m.turnCompleteMs ?? "?"}ms`,
            );
          }
        })();
        return;
      }
      if (event.type === "error") {
        optionsRef.current.onError(event.message);
      }
    },
    [
      depsRef,
      emitListenPhase,
      restartMicStreaming,
      finishPlayback,
      clearTurnCommitTimer,
      scheduleTurnCommit,
      handleUserTurn,
      startBackgroundHold,
      stopMicCapture,
    ],
  );

  const openSession = useCallback(async () => {
    const gen = sessionGenRef.current + 1;
    sessionGenRef.current = gen;

    await activateVoiceSessionAudio();
    await stopPlaybackPipeline();
    await applyVoiceAudioMode({ continuousVoice: true });
    await ensureSpeechReady();

    setPhase("connecting");
    emitListenPhase("connecting");

    const secret = await fetchRealtimeClientSecret();
    const wsUrl = secret.proxyWsUrl ?? secret.wsUrl;
    if (!secret.proxyWsUrl) {
      dwarn("unified", "proxyWsUrl missing — using direct xAI WS (no Mac proxy)");
    }

    const onEvent = (event: Parameters<Parameters<typeof connectUnifiedRealtime>[2]>[0]) => {
      if (gen !== sessionGenRef.current || clientRef.current === null) return;
      handleRealtimeEvent(event);
    };

    const client = connectUnifiedRealtime(wsUrl, secret.value, onEvent);
    clientRef.current = client;
    const history = depsRef.current.getHistory();
    if (history.length > 0) {
      dlog("unified", `seeding ${history.length} prior turns into realtime session`);
    }
    client.configure({
      instructions: depsRef.current.getInstructions(),
      voice: depsRef.current.getVoice(),
      history,
    });

    // Start mic while WS configures — PCM buffers until proxy.configured (proven on vad-tune).
    const micReady = ensureMicStreaming();

    try {
      await client.waitUntilConfigured();
      if (gen !== sessionGenRef.current) {
        throw new Error("Voice session interrupted — tap mic to try again.");
      }
      await micReady;
    } catch (error) {
      await stopMicCapture();
      throw error;
    }

    emitListenPhase("hearing");
    setPhase("listening");
  }, [depsRef, emitListenPhase, ensureMicStreaming, handleRealtimeEvent, stopMicCapture, stopPlaybackPipeline]);

  const teardownAll = useCallback(async () => {
    activeRef.current = false;
    turnInFlightRef.current = false;
    clearTurnCommitTimer();
    turnTranscriptRef.current = "";
    lastCommittedTextRef.current = "";
    closeClient();
    await stopMicCapture();
    await stopBackgroundHold();
    await stopPlaybackPipeline();
    await releaseNativeAudioSession().catch(noop);
    setPhase("idle");
    optionsRef.current.onPartial("");
  }, [clearTurnCommitTimer, closeClient, stopBackgroundHold, stopMicCapture, stopPlaybackPipeline]);

  const startCapture = useCallback(async () => {
    if (!isNativeAudioCaptureAvailable()) {
      throw new Error("Native audio capture is not available — rebuild the iOS app.");
    }
    await runExclusive(async () => {
      await teardownAll();
      activeRef.current = true;
      interruptedRef.current = false;
      try {
        await openSession();
      } catch (error) {
        activeRef.current = false;
        await stopMicCapture().catch(noop);
        await releaseNativeAudioSession().catch(noop);
        throw error;
      }
    });
  }, [openSession, runExclusive, stopMicCapture, teardownAll]);

  const resumeListen = useCallback(async () => {
    await runExclusive(async () => {
      if (!activeRef.current || !isClientLive(clientRef.current)) {
        closeClient();
        await stopMicCapture();
        await stopBackgroundHold();
        activeRef.current = true;
        interruptedRef.current = false;
        await openSession();
        return;
      }
      setPhase("listening");
      emitListenPhase("hearing");
      await restartMicStreaming();
    });
  }, [emitListenPhase, openSession, restartMicStreaming, runExclusive]);

  const stopCapture = useCallback(
    async (_submitIfHeard: boolean) => {
      await runExclusive(teardownAll);
      optionsRef.current.onCaptureEnd?.();
    },
    [runExclusive, teardownAll],
  );

  const pauseForPlayback = useCallback(async () => {
    await runExclusive(async () => {
      await stopMicCapture();
      await startBackgroundHold();
    });
  }, [runExclusive, startBackgroundHold, stopMicCapture]);

  const resetSession = useCallback(async () => {
    await runExclusive(teardownAll);
  }, [runExclusive, teardownAll]);

  const forceSubmit = useCallback(async (_explicitText?: string) => {
    // server_vad handles end-of-turn — manual submit not used on unified path
  }, []);

  const markInterrupted = useCallback(() => {
    interruptedRef.current = true;
    clientRef.current?.cancelResponse();
    void stopPlaybackPipeline().then(() => resumeListen());
  }, [resumeListen, stopPlaybackPipeline]);

  const isSessionHealthy = useCallback(
    () => activeRef.current && isClientLive(clientRef.current),
    [],
  );

  useEffect(() => {
    return () => {
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
    markInterrupted,
    isSessionHealthy,
    getTranscript: () => turnTranscriptRef.current.trim(),
    isActive: () => activeRef.current,
    isListenActive: () =>
      activeRef.current &&
      isClientLive(clientRef.current) &&
      Boolean(captureStopRef.current) &&
      phaseRef.current === "listening",
    isMonitorActive: () => false,
    isCaptureRunning: () => Boolean(captureStopRef.current) || holdActiveRef.current,
    startInterruptMonitor: async () => {},
    stopInterruptMonitor: () => {},
    prefetchListenSession: () => {},
    onSpeechResult: noop,
    onSpeechEnd: noop,
    onSpeechError: noop,
  };
}
