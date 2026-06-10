import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  ListRenderItem,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { speakMomentSir, stopMomentSpeech } from "./src/moment";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  askChiefDeep,
  checkHealth,
  fetchChiefSession,
  fetchRealtimeClientSecret,
  fetchTtsAudio,
  refreshReports,
  resolveSpeakerProfile,
  type ChatTurn,
} from "./src/api";
import { SpeakerSettingsModal } from "./src/SpeakerSettingsModal";
import { playBase64Mp3, stopPlayback } from "./src/audio";
import {
  stopStreamingPlayback,
  prewarmStreamingPlayback,
  shutdownStreamingPlayback,
} from "./src/stream-audio";
import { ATLAS_SERVER_URL, getResolvedServerUrl } from "./src/config";
import { getLastResolveError } from "./src/api";
import { dlog, dwarn } from "./src/log";
import { formatXaiQuotaError, isXaiQuotaError } from "./src/xai-errors";
import { getLocationContext } from "./src/location";
import { abortRealtime, runRealtimeTurn } from "./src/realtime";
import {
  initAudibleAudioMode,
  prepareForNativeStream,
  resetAudioForPlayback,
  useSpeechRecognitionEvent,
} from "./src/speech";
import { recordTranscript } from "./src/transcript";
import { speakAtlasReply } from "./src/speak-reply";
import {
  useAdaptiveVoiceCapture,
  voiceCaptureModeLabel,
  CAN_USE_XAI_STT,
  USE_UNIFIED_REALTIME,
} from "./src/useAdaptiveVoiceCapture";
import type { UnifiedVoiceTurnDeps } from "./src/useUnifiedRealtimeVoice";
import {
  isWakeWordAvailable,
  useWakeWord,
  wakeWordLabel,
} from "./src/useWakeWord";
import { syncLiveActivity } from "./src/live-activity-sync";
import { loadAppSettings, saveWakeWordEnabled } from "./src/settings-store";
import { pauseWakeListeningForVoice } from "./src/voice-gates";
import { syncWidgetSnapshot } from "./src/widget-sync";
import {
  activateVoiceSessionAudio,
  deactivateVoiceSessionAudio,
  reactivateVoiceSessionAudio,
} from "./src/background-audio";
import { buildStatusMeta, shortServerLabel } from "./src/header-meta";
import { parseAtlasDeepLink, SHORTCUT_LISTEN_URL } from "./src/deep-links";
import type { ListenPhase, VoiceSubmitMeta } from "./src/useVoiceCapture";
import { ChatHistoryDrawer } from "./src/ChatHistoryDrawer";
import {
  createNewSession,
  deleteSession,
  ensureActiveSession,
  listLocalSessions,
  persistMessage,
  storedToUiMessages,
  syncSessionsFromServer,
} from "./src/chat-sessions";

// Phrase triggers that opt a single turn into the slower reasoning model.
const DEEP_INTENT = /\b(think (deeply|hard|carefully)|deep dive|deep[- ]?think|take your time|really think|think it through)\b/i;
// Phrases that should force a fresh project rescan before answering.
const REFRESH_INTENT = /\b(latest|refresh|re-?scan|up to date|most recent|current status|what's new|whats new|review (the )?code|scan (my )?projects|what context|what do you know|deep scan|read (my )?repos)\b/i;
// Phrases that trigger web search, lookups, or other slow research.
const RESEARCH_INTENT =
  /\b(search (the )?(web|internet)|look (it )?up|google|weather|forecast|news|headlines|current events|what(?:'s| is) (the |happening|going on)|find (out|me)|on the web|online|browse|tell me about (the )?(latest|news|weather))\b/i;

function looksDeep(text: string): boolean {
  return DEEP_INTENT.test(text);
}

function looksRefresh(text: string): boolean {
  return REFRESH_INTENT.test(text);
}

function looksResearch(text: string): boolean {
  return RESEARCH_INTENT.test(text);
}

type Role = "user" | "atlas";

interface Message {
  id: string;
  role: Role;
  text: string;
  error?: boolean;
}

type Status = "idle" | "listening" | "thinking" | "speaking";
type Connection = "unknown" | "online" | "offline";

/** Bumped each release — confirm in app header after install. */
const APP_BUILD_STAMP = "2026-06-10-voice-v2";

function formatListenError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (isXaiQuotaError(error)) {
    return formatXaiQuotaError(error, "Could not start listening");
  }
  if (msg.includes("timed out") || msg.includes("before ready")) {
    return "STT did not connect in time — check Mac server and xAI API key.";
  }
  if (msg.includes("not enabled") || msg.includes("disabled")) {
    return "xAI STT is disabled on the Mac server — check XAI_API_KEY in server/.env.";
  }
  return `Could not start listening: ${msg}`;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "Tap mic to speak",
  listening: "Listening… take your time",
  thinking: "Tap mic to interrupt",
  speaking: "Tap mic to interrupt",
};

/** Keep UI responsive; full history lives in transcript logs. */
const MAX_UI_MESSAGES = 80;

function toChatTurn(msg: Message): ChatTurn {
  return {
    role: msg.role === "atlas" ? "assistant" : "user",
    content: msg.text,
  };
}

function AtlasApp() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [partial, setPartial] = useState("");
  const [streamingAtlas, setStreamingAtlas] = useState("");
  const [connection, setConnection] = useState<Connection>("unknown");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [audioDiag, setAudioDiag] = useState<string | null>(null);
  const [deepMode, setDeepMode] = useState(false);
  const [activeServer, setActiveServer] = useState(ATLAS_SERVER_URL);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsLoadedRef = useRef(false);
  const [appInBackground, setAppInBackground] = useState(false);
  const [listenPhase, setListenPhase] = useState<ListenPhase>("connecting");
  const listenPhaseRef = useRef<ListenPhase>("connecting");
  listenPhaseRef.current = listenPhase;
  const [shortcutListenPending, setShortcutListenPending] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<
    Array<{ id: string; title: string; created_at: string; updated_at: string }>
  >([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const voiceSessionKeyRef = useRef(`vs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const messagesRef = useRef<Message[]>([]);
  const statusRef = useRef<Status>("idle");
  const connectionRef = useRef<Connection>("unknown");
  const activeRequestRef = useRef<AbortController | null>(null);
  const interruptedRef = useRef(false);
  const instructionsRef = useRef("");
  const voiceRef = useRef("rex");
  const partialRef = useRef("");
  const deepModeRef = useRef(false);
  /** True while user wants continuous voice mode (tap once, keep talking). */
  const micSessionRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const pendingShortcutListenRef = useRef(false);
  const beginListenInFlightRef = useRef(false);
  const voiceCaptureRef = useRef<ReturnType<typeof useAdaptiveVoiceCapture> | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);

  statusRef.current = status;
  connectionRef.current = connection;
  partialRef.current = partial;
  deepModeRef.current = deepMode;
  chatSessionIdRef.current = chatSessionId;

  const applySessionMessages = useCallback((sessionMessages: Message[]) => {
    messagesRef.current = sessionMessages;
    setMessages(sessionMessages);
  }, []);

  const pushMessage = useCallback((msg: Message) => {
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (
      last &&
      last.role === msg.role &&
      last.text.trim() === msg.text.trim() &&
      !msg.error
    ) {
      return;
    }
    let next = [...messagesRef.current, msg];
    if (next.length > MAX_UI_MESSAGES) {
      next = next.slice(-MAX_UI_MESSAGES);
    }
    messagesRef.current = next;
    setMessages(next);
    const sid = chatSessionIdRef.current;
    if (sid) {
      void persistMessage(sid, {
        id: msg.id,
        role: msg.role,
        text: msg.text,
        error: msg.error,
      });
    }
    if (!msg.error) {
      void recordTranscript(msg.role, msg.text);
    }
  }, []);

  const refreshChatSessionList = useCallback(async (preferServer = false) => {
    const list =
      preferServer || connectionRef.current === "online"
        ? await syncSessionsFromServer()
        : await listLocalSessions();
    setChatSessions(list);
  }, []);

  const loadChatSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureActiveSession(sessionId);
      chatSessionIdRef.current = session.id;
      setChatSessionId(session.id);
      applySessionMessages(storedToUiMessages(session.messages));
      setPartial("");
      setStreamingAtlas("");
      setStatus("idle");
      micSessionRef.current = false;
      setNotice(null);
      await voiceCaptureRef.current?.resetSession().catch(() => {});
      await refreshChatSessionList();
    },
    [applySessionMessages, refreshChatSessionList],
  );

  const startNewChatSession = useCallback(async () => {
    await voiceCaptureRef.current?.stopCapture(false).catch(() => {});
    await voiceCaptureRef.current?.resetSession().catch(() => {});
    micSessionRef.current = false;
    setPartial("");
    setStreamingAtlas("");
    setStatus("idle");
    setNotice(null);
    const session = await createNewSession();
    chatSessionIdRef.current = session.id;
    setChatSessionId(session.id);
    applySessionMessages([]);
    await refreshChatSessionList();
    setHistoryOpen(false);
  }, [applySessionMessages, refreshChatSessionList]);

  const removeChatSession = useCallback(
    async (sessionId: string) => {
      const { wasActive, nextActiveId } = await deleteSession(sessionId);
      await refreshChatSessionList();
      if (!wasActive) return;

      await voiceCaptureRef.current?.stopCapture(false).catch(() => {});
      await voiceCaptureRef.current?.resetSession().catch(() => {});
      micSessionRef.current = false;
      setPartial("");
      setStreamingAtlas("");
      setStatus("idle");
      setNotice(null);

      if (nextActiveId) {
        await loadChatSession(nextActiveId);
      } else {
        const session = await createNewSession();
        chatSessionIdRef.current = session.id;
        setChatSessionId(session.id);
        applySessionMessages([]);
        await refreshChatSessionList();
      }
    },
    [applySessionMessages, loadChatSession, refreshChatSessionList],
  );

  const connectToServer = useCallback(async () => {
    setConnectionError(null);
    try {
      const health = await checkHealth(true);
      setActiveServer(getResolvedServerUrl() ?? health.url ?? ATLAS_SERVER_URL);
      setConnection("online");
      connectionRef.current = "online";

      try {
        const session = await fetchChiefSession();
        instructionsRef.current = session.instructions;
        voiceRef.current = session.voice || "rex";
      } catch (error) {
        dwarn("session", "chief instructions failed after health ok", error);
      }
      void getLocationContext().catch(() => {});
      void refreshChatSessionList(true);
    } catch (error) {
      setConnection("offline");
      const detail =
        getLastResolveError() ??
        (error instanceof Error ? error.message : "Atlas server unreachable");
      const hint =
        /network request failed|unreachable|abort/i.test(detail)
          ? " — is the Mac server running? (cd server && npm run dev)"
          : "";
      setConnectionError(`${detail}${hint}`);
    }
  }, [refreshChatSessionList]);

  const refreshHealth = useCallback(() => connectToServer(), [connectToServer]);

  const loadChiefSession = useCallback(async () => {
    const session = await fetchChiefSession();
    instructionsRef.current = session.instructions;
    voiceRef.current = session.voice || "rex";
  }, []);

  useEffect(() => {
    void initAudibleAudioMode();
    connectToServer();
    void loadAppSettings().then(async (settings) => {
      setWakeWordEnabled(settings.wakeWordEnabled);
      settingsLoadedRef.current = true;
      setSettingsLoaded(true);
      const session = await ensureActiveSession();
      chatSessionIdRef.current = session.id;
      setChatSessionId(session.id);
      applySessionMessages(storedToUiMessages(session.messages));
      await refreshChatSessionList();
    });
  }, [applySessionMessages, connectToServer, refreshChatSessionList]);

  const handleToggleWakeWord = useCallback((enabled: boolean) => {
    setWakeWordEnabled(enabled);
    void saveWakeWordEnabled(enabled);
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, streamingAtlas, partial, status, scrollToEnd]);

  const cancelActiveRequest = useCallback(() => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  // Fast path: Grok-style AVAudioEngine PCM stream; TTS only if PCM never reached the engine.
  const runFastTurn = useCallback(
    async (
      clean: string,
      history: ChatTurn[],
      interrupted: boolean,
      controller: AbortController,
      afterHoldPhrase: boolean,
      voiceInputPrefix?: string,
      prefetchedSecret?: Awaited<ReturnType<typeof fetchRealtimeClientSecret>>,
    ) => {
      const secret = prefetchedSecret ?? (await fetchRealtimeClientSecret());
      setStatus("thinking");
      setAudioDiag(null);
      await Promise.all([
        stopStreamingPlayback(),
        stopPlayback(),
        prepareForNativeStream({ continuousVoice: micSessionRef.current }),
      ]);

      const result = await runRealtimeTurn({
        clientSecret: secret.value,
        wsUrl: secret.wsUrl,
        instructions: instructionsRef.current,
        history,
        userMessage: clean,
        interrupted,
        afterHoldPhrase,
        voiceInputPrefix,
        voice: voiceRef.current,
        textOnly: false,
        signal: controller.signal,
        onFirstAudio: () => {
          if (!controller.signal.aborted) {
            setStatus("speaking");
          }
        },
        onTextDelta: (delta) => {
          setStreamingAtlas(delta);
          scrollToEnd();
        },
      });

      if (controller.signal.aborted) return;

      if (result.pcmDelivered) {
        dlog(
          "turn",
          `native pcm turnId=${result.turnId} firstAudio=${result.firstAudioMs ?? "?"}ms`,
        );
        setAudioDiag(`voice: native pcm ${result.firstAudioMs ?? "?"}ms`);
      } else if (result.text) {
        dwarn("turn", `native pcm missed — TTS fallback turnId=${result.turnId}`);
        setStatus("speaking");
        const outcome = await speakAtlasReply(result.text, result.turnId, controller.signal);
        setAudioDiag(outcome === "spoken" ? "voice: tts fallback" : `voice: ${outcome}`);
      } else {
        setAudioDiag("voice: no text");
      }

      if (controller.signal.aborted) return;
      setConnection("online");
      setStreamingAtlas("");
      pushMessage({ id: makeId(), role: "atlas", text: result.text });
      scrollToEnd();
    },
    [pushMessage, scrollToEnd],
  );

  // Deep path: server reasoning model, then spoken via TTS. Used on explicit
  // permission ("think deeply") or the Deep toggle. Slower but more capable.
  const runDeepTurn = useCallback(
    async (
      clean: string,
      history: ChatTurn[],
      interrupted: boolean,
      controller: AbortController,
      afterHoldPhrase: boolean,
    ) => {
      const researchHint = afterHoldPhrase
        ? "[Camron already heard a brief hold phrase. Do NOT open with Yes sir or any acknowledgment. Say sir at most once. Answer directly.] "
        : "";
      const reply = await askChiefDeep(researchHint + clean, history, interrupted, controller.signal);
      if (controller.signal.aborted) return;

      setConnection("online");
      pushMessage({ id: makeId(), role: "atlas", text: reply.filtered });
      scrollToEnd();

      try {
        const tts = await fetchTtsAudio(reply.filtered);
        if (tts.audio && !controller.signal.aborted) {
          setStatus("speaking");
          await playBase64Mp3(tts.audio);
        }
      } catch {
        // Text reply still shown if TTS fails.
      }
    },
    [pushMessage, scrollToEnd],
  );

  const sendToAtlas = useCallback(
    async (text: string, interrupted: boolean, meta?: VoiceSubmitMeta) => {
      const clean = text.trim();
      if (!clean) {
        setStatus("idle");
        return;
      }

      const deep = deepModeRef.current || looksDeep(clean);
      const needsRefresh = looksRefresh(clean);
      const needsResearch = looksResearch(clean);
      const needsMoment = deep || needsRefresh || needsResearch;
      dlog(
        "turn",
        `send deep=${deep} refresh=${needsRefresh} research=${needsResearch} text="${clean.slice(0, 60)}"`,
      );

      pushMessage({ id: makeId(), role: "user", text: clean });

      const history: ChatTurn[] = messagesRef.current
        .filter((msg) => !msg.error)
        .slice(0, -1)
        .map(toChatTurn);

      setStatus("thinking");
      setStreamingAtlas("");
      setPartial("");
      scrollToEnd();

      if (micSessionRef.current) {
        await activateVoiceSessionAudio();
      }

      const controller = new AbortController();
      activeRequestRef.current = controller;
      turnStartedAtRef.current = Date.now();

      let messageForAtlas = clean;
      let voiceInputPrefix: string | undefined;

      if (meta?.sttSpeakerId !== undefined && meta.sttSpeakerId !== null) {
        try {
          const resolved = await resolveSpeakerProfile(
            voiceSessionKeyRef.current,
            meta.sttSpeakerId,
          );
          setActiveSpeaker(resolved.profile.displayName);
          const session = await fetchChiefSession(
            voiceSessionKeyRef.current,
            meta.sttSpeakerId,
          );
          instructionsRef.current = session.instructions;
          voiceRef.current = session.voice || "rex";
          messageForAtlas = `${resolved.messagePrefix} ${messageForAtlas}`;
          voiceInputPrefix = `[Voice input — ${resolved.profile.displayName} spoke aloud (${resolved.profile.role}); STT transcribed. You can hear them. Respond in voice.] `;
          dlog(
            "speaker",
            `${resolved.profile.displayName} (${resolved.profile.role}) sttId=${meta.sttSpeakerId}`,
          );
        } catch (error) {
          dwarn("speaker", "resolve failed", error);
        }
      }

      if (needsResearch) {
        const loc = await getLocationContext();
        if (loc) {
          messageForAtlas = `[User location: ${loc}. Use this for weather, local news, and nearby queries.] ${clean}`;
        }
      }

      try {
        const secretPromise = fetchRealtimeClientSecret();
        if (micSessionRef.current) {
          await voiceCaptureRef.current?.pauseForPlayback();
        }

        if (needsMoment) {
          await speakMomentSir();
          if (controller.signal.aborted) return;
          await stopStreamingPlayback();
          await resetAudioForPlayback();
        }

        if (needsRefresh) {
          try {
            dlog("turn", "refresh intent -> forcing deep report rescan");
            await refreshReports(true, true);
          } catch (e) {
            dlog("turn", "refresh failed (continuing)", e);
          }
          if (controller.signal.aborted) return;
        }

        if (!instructionsRef.current.trim()) {
          await loadChiefSession();
        }

        if (deep) {
          await runDeepTurn(messageForAtlas, history, interrupted, controller, needsMoment);
        } else {
          const secret = await secretPromise;
          await runFastTurn(
            messageForAtlas,
            history,
            interrupted,
            controller,
            needsMoment,
            voiceInputPrefix,
            secret,
          );
        }
      } catch (error) {
        if (
          (error as Error)?.name === "AbortError" ||
          (error as Error)?.message === "Aborted"
        ) {
          return;
        }
        const message = formatXaiQuotaError(error);
        pushMessage({ id: makeId(), role: "atlas", text: message, error: true });
        if (!isXaiQuotaError(error)) {
          setConnection("offline");
        }
        scrollToEnd();
      } finally {
        setStreamingAtlas("");
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
        turnStartedAtRef.current = null;
        if (controller.signal.aborted) {
          if (micSessionRef.current) {
            try {
              await voiceCaptureRef.current?.resumeListen();
              setStatus("listening");
              setNotice(null);
            } catch (error) {
              dwarn("voice", "resume mic after abort failed", error);
            }
          } else {
            setStatus("idle");
          }
          return;
        }
        if (micSessionRef.current) {
          try {
            await voiceCaptureRef.current?.resumeListen();
            setStatus("listening");
            setNotice(null);
          } catch (error) {
            dwarn("voice", "resume mic after turn failed", error);
            setStatus("listening");
            setNotice("Mic paused — tap mic to continue.");
          }
        } else {
          setStatus("idle");
        }
      }
    },
    [loadChiefSession, pushMessage, runDeepTurn, runFastTurn, scrollToEnd],
  );

  const unifiedDepsRef = useRef<UnifiedVoiceTurnDeps>({
    getInstructions: () => instructionsRef.current,
    getVoice: () => voiceRef.current,
    getHistory: () =>
      messagesRef.current
        .filter((msg) => !msg.error)
        .map(toChatTurn),
    isDeep: (text) => deepModeRef.current || looksDeep(text),
    isRefresh: looksRefresh,
    isResearch: looksResearch,
    onUserMessage: (text) => {
      pushMessage({ id: makeId(), role: "user", text });
      setPartial("");
      scrollToEnd();
    },
    onAtlasDelta: (text) => {
      setStreamingAtlas(text);
      scrollToEnd();
    },
    onAtlasComplete: (text) => {
      setStreamingAtlas("");
      pushMessage({ id: makeId(), role: "atlas", text });
      setConnection("online");
      scrollToEnd();
    },
    onStatus: (s) => setStatus(s),
    onDeepTurn: async (text, history, interrupted, afterHold) => {
      const controller = new AbortController();
      activeRequestRef.current = controller;
      try {
        await runDeepTurn(text, history, interrupted, controller, afterHold);
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
      }
    },
    onRefresh: async () => {
      try {
        await refreshReports(true, true);
      } catch (e) {
        dlog("unified", "refresh failed (continuing)", e);
      }
    },
    onMoment: async () => {
      await speakMomentSir();
      await stopStreamingPlayback();
      await resetAudioForPlayback();
    },
    getLocationPrefix: async () => {
      const loc = await getLocationContext();
      return loc ? `[User location: ${loc}. Use this for weather, local news, and nearby queries.]` : null;
    },
  });

  const voiceCapture = useAdaptiveVoiceCapture(
    {
      onPartial: (text) => {
        partialRef.current = text;
        setPartial(text);
      },
      onListenPhase: (phase) => setListenPhase(phase),
      onError: (message) => setNotice(message),
      onCaptureEnd: () => {
        if (micSessionRef.current) return;
        if (statusRef.current === "listening") {
          setStatus("idle");
        }
      },
      onSubmit: async (text, meta) => {
        if (USE_UNIFIED_REALTIME) return;
        const interrupted = interruptedRef.current;
        interruptedRef.current = false;
        setPartial("");
        setListenPhase("connecting");
        setStatus("thinking");
        if (micSessionRef.current) {
          await activateVoiceSessionAudio();
        }
        await sendToAtlas(text, interrupted, meta);
      },
    },
    unifiedDepsRef,
  );

  voiceCaptureRef.current = voiceCapture;

  const waitForServerOnline = useCallback(async (timeoutMs = 10_000): Promise<boolean> => {
    const started = Date.now();
    for (;;) {
      const conn = connectionRef.current;
      if (conn === "online") return true;
      if (conn === "offline") return false;
      if (Date.now() - started >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }, []);

  const beginVoiceListen = useCallback(async () => {
    if (beginListenInFlightRef.current) return;
    const sessionHealthy = voiceCapture.isSessionHealthy?.() ?? voiceCapture.isListenActive();
    if (voiceCapture.isActive() && sessionHealthy && voiceCapture.isListenActive()) return;
    if (
      statusRef.current !== "idle" &&
      statusRef.current !== "thinking" &&
      statusRef.current !== "speaking" &&
      !(statusRef.current === "listening" && !voiceCapture.isListenActive())
    ) {
      return;
    }

    if (!settingsLoadedRef.current) {
      for (let i = 0; i < 30 && !settingsLoadedRef.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    let online = await waitForServerOnline(4_000);
    if (!online) {
      await connectToServer();
      online = await waitForServerOnline(8_000);
    }
    if (!online) {
      setNotice("Start the Mac server (cd server && npm run dev), then try again.");
      pendingShortcutListenRef.current = false;
      setShortcutListenPending(false);
      return;
    }

    if (!instructionsRef.current) {
      await loadChiefSession().catch(() => {});
    }

    await pauseWakeListeningForVoice();
    await new Promise((resolve) => setTimeout(resolve, 120));

    beginListenInFlightRef.current = true;
    interruptedRef.current = false;
    micSessionRef.current = true;
    setNotice(null);
    setListenPhase("connecting");
    setStatus("listening");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      await abortRealtime();
      if (!USE_UNIFIED_REALTIME) {
        await activateVoiceSessionAudio();
      }
      await voiceCapture.startCapture();
      // Legacy split path: prewarm stream audio after capture. Path B uses
      // atlas-realtime-playback started on first audio delta.
      if (!USE_UNIFIED_REALTIME) {
        await prewarmStreamingPlayback();
      }
    } catch (error) {
      dwarn("voice", "begin listen failed", error);
      setStatus("idle");
      micSessionRef.current = false;
      setNotice(formatListenError(error));
    } finally {
      beginListenInFlightRef.current = false;
      pendingShortcutListenRef.current = false;
      setShortcutListenPending(false);
    }
  }, [connectToServer, loadChiefSession, voiceCapture, waitForServerOnline]);

  const startListeningFromWake = useCallback(async () => {
    await beginVoiceListen();
  }, [beginVoiceListen]);

  const { handleSpeechResult, handleSpeechEnd, handleSpeechError } = useWakeWord(
    settingsLoaded &&
      wakeWordEnabled &&
      status === "idle" &&
      !voiceCapture.isActive() &&
      !shortcutListenPending,
    () => {
      void startListeningFromWake();
    },
  );

  useSpeechRecognitionEvent("result", (event) => {
    if (handleSpeechResult(event)) return;
    voiceCapture.onSpeechResult(event);
  });
  useSpeechRecognitionEvent("end", () => {
    if (handleSpeechEnd()) return;
    voiceCapture.onSpeechEnd();
  });
  useSpeechRecognitionEvent("error", (event) => {
    if (handleSpeechError(event)) return;
    // Suppress Apple STT errors during a Grok STT session
    if (
      (CAN_USE_XAI_STT || USE_UNIFIED_REALTIME) &&
      (micSessionRef.current || voiceCaptureRef.current?.isListenActive())
    ) {
      return;
    }
    voiceCapture.onSpeechError(event);
  });

  useEffect(() => {
    if (listenPhase === "hearing" && micSessionRef.current) {
      setNotice(null);
    }
  }, [listenPhase]);

  useEffect(() => {
    // Path B (Voice v2) owns AVAudioSession for connecting→turn lifecycle.
    if (USE_UNIFIED_REALTIME) return;

    const needsVoiceAudio =
      status === "thinking" ||
      status === "speaking" ||
      (status === "listening" &&
        (listenPhase === "hearing" || listenPhase === "transcribing"));
    if (needsVoiceAudio) {
      void activateVoiceSessionAudio();
    } else if (status === "idle" && !micSessionRef.current) {
      void deactivateVoiceSessionAudio();
    }
  }, [status, listenPhase]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      setAppInBackground(next === "background" || next === "inactive");

      const voiceBusy =
        statusRef.current === "listening" ||
        statusRef.current === "thinking" ||
        statusRef.current === "speaking" ||
        micSessionRef.current;

      if ((next === "background" || next === "inactive") && voiceBusy) {
        // Release mic when leaving Atlas so YouTube / other media aren't interrupted.
        if (
          statusRef.current === "listening" &&
          !activeRequestRef.current &&
          listenPhaseRef.current !== "connecting"
        ) {
          dlog("bg", "background while listening — releasing mic for other apps");
          micSessionRef.current = false;
          setStatus("idle");
          setListenPhase("connecting");
          void voiceCaptureRef.current?.stopCapture(false).catch(() => {});
          void deactivateVoiceSessionAudio();
          return;
        }
        dlog("bg", "voice session — keeping background audio alive");
        if (!USE_UNIFIED_REALTIME) {
          void activateVoiceSessionAudio();
        }
      }

      if (next === "active" && /inactive|background/.test(prev)) {
        if (voiceBusy && micSessionRef.current && !USE_UNIFIED_REALTIME) {
          void reactivateVoiceSessionAudio();
        }
        connectToServer();
        return;
      }

      if (next === "active" && !voiceBusy) {
        connectToServer();
      }
    });
    return () => sub.remove();
  }, [connectToServer]);

  const handleDeepLink = useCallback(
    async (url: string) => {
      const link = parseAtlasDeepLink(url);
      if (!link) return;

      if (link.action === "listen") {
        pendingShortcutListenRef.current = true;
        setShortcutListenPending(true);
        return;
      }

      micSessionRef.current = false;
      setNotice(null);
      setPartial("");
      setStatus("thinking");
      await sendToAtlas(link.text, false);
    },
    [sendToAtlas],
  );

  useEffect(() => {
    if (!settingsLoaded || !pendingShortcutListenRef.current) return;
    void beginVoiceListen();
  }, [settingsLoaded, shortcutListenPending, beginVoiceListen]);

  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      void handleDeepLink(url);
    };
    const sub = Linking.addEventListener("url", onUrl);
    void Linking.getInitialURL().then((url) => {
      if (url) void handleDeepLink(url);
    });
    return () => sub.remove();
  }, [handleDeepLink]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const last = messages[messages.length - 1];
    syncWidgetSnapshot({
      connection,
      status,
      lastLine: last?.text ?? "Tap mic to speak with Atlas",
      wakeOn: wakeWordEnabled,
    });
    syncLiveActivity(
      status,
      partial.trim() || last?.text || "Voice session active",
      micSessionRef.current,
    );
  }, [settingsLoaded, connection, status, messages, wakeWordEnabled, partial]);

  const handleMicToggle = useCallback(async () => {
    const pendingText =
      partialRef.current.trim() || voiceCapture.getTranscript().trim();

    if (statusRef.current === "listening" && !voiceCapture.isListenActive()) {
      if (pendingText) {
        const last = messagesRef.current[messagesRef.current.length - 1];
        if (!(last?.role === "user" && last.text.trim() === pendingText)) {
          setNotice(null);
          await sendToAtlas(pendingText, false);
        }
        return;
      }
      if (beginListenInFlightRef.current) {
        return;
      }
      setNotice(null);
      await beginVoiceListen();
      return;
    }

    if (statusRef.current === "listening" && pendingText) {
      setNotice(null);
      await voiceCapture.forceSubmit(pendingText);
      return;
    }

    if (statusRef.current === "listening" && voiceCapture.isActive() && !pendingText) {
      micSessionRef.current = false;
      setNotice(null);
      await voiceCapture.stopCapture(false);
      await shutdownStreamingPlayback();
      setStatus("idle");
      return;
    }

    if (voiceCapture.isActive()) {
      return;
    }

    if (statusRef.current === "thinking" || statusRef.current === "speaking") {
      interruptedRef.current = true;
      micSessionRef.current = true;
      dlog("ui", "interrupt -> stopping playback, re-listening");
      cancelActiveRequest();
      await stopMomentSpeech();
      await abortRealtime();
      await stopStreamingPlayback();
      await stopPlayback();
      setNotice(null);
      setStatus("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      try {
        if (!USE_UNIFIED_REALTIME) {
          await activateVoiceSessionAudio();
        }
        if (USE_UNIFIED_REALTIME && voiceCapture.markInterrupted) {
          voiceCapture.markInterrupted();
        } else {
          await voiceCapture.resumeListen();
        }
      } catch {
        setStatus("idle");
        micSessionRef.current = false;
      }
      return;
    }

    interruptedRef.current = false;
    await beginVoiceListen();
  }, [beginVoiceListen]);

  const handleSendDraft = useCallback(async () => {
    const text = draft.trim();
    if (!text || voiceCapture.isActive()) return;
    setDraft("");
    interruptedRef.current = false;
    cancelActiveRequest();
    await abortRealtime();
    await stopPlayback();
    await sendToAtlas(text, false);
  }, [draft, cancelActiveRequest, sendToAtlas, voiceCapture]);

  useEffect(() => {
    return () => {
      cancelActiveRequest();
      abortRealtime();
    };
  }, [cancelActiveRequest]);

  const isListening = status === "listening" || voiceCapture.isActive();

  const renderMessage: ListRenderItem<Message> = useCallback(({ item: msg }) => (
    <View
      style={[
        styles.bubbleRow,
        msg.role === "user" ? styles.rowRight : styles.rowLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          msg.role === "user"
            ? styles.userBubble
            : msg.error
              ? styles.errorBubble
              : styles.atlasBubble,
        ]}
      >
        {msg.role === "atlas" && !msg.error && (
          <Text style={styles.bubbleLabel}>ATLAS</Text>
        )}
        <Text style={[styles.bubbleText, msg.role === "user" && styles.userText]}>
          {msg.text}
        </Text>
      </View>
    </View>
  ), []);

  const listFooter = useMemo(
    () => (
      <View style={styles.footer}>
        {(isListening || status === "thinking") && partial.length > 0 && (
          <View style={[styles.bubbleRow, styles.rowRight]}>
            <View style={[styles.bubble, styles.userBubble, styles.partialBubble]}>
              <Text style={[styles.bubbleText, styles.userText]}>{partial}</Text>
            </View>
          </View>
        )}

        {isListening && partial.length === 0 && (
          <View style={[styles.bubbleRow, styles.rowRight]}>
            <View style={[styles.bubble, styles.userBubble, styles.partialBubble]}>
              <Text style={[styles.bubbleText, styles.userText, styles.listeningHint]}>
                {listenPhase === "connecting"
                  ? "Connecting mic…"
                  : listenPhase === "hearing"
                    ? "Hearing you…"
                    : "Listening…"}
              </Text>
            </View>
          </View>
        )}

        {streamingAtlas.length > 0 && (
          <View style={[styles.bubbleRow, styles.rowLeft]}>
            <View style={[styles.bubble, styles.atlasBubble]}>
              <Text style={styles.bubbleLabel}>ATLAS</Text>
              <Text style={styles.bubbleText}>{streamingAtlas}</Text>
            </View>
          </View>
        )}

        {status === "thinking" && !streamingAtlas && partial.length === 0 && (
          <View style={[styles.bubbleRow, styles.rowLeft]}>
            <View style={[styles.bubble, styles.atlasBubble]}>
              <ActivityIndicator color="#8b95a5" />
            </View>
          </View>
        )}
      </View>
    ),
    [isListening, listenPhase, partial, streamingAtlas, status],
  );

  const listEmpty = useMemo(
    () =>
      !streamingAtlas ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Good day, sir.</Text>
          <Text style={styles.emptyBody}>
            Tap the mic once to start a voice session — speak, pause, and Atlas replies.
            The mic stays on so you can keep talking. Tap again while listening to stop.
          </Text>
        </View>
      ) : null,
    [streamingAtlas],
  );

  const headerMeta = useMemo(
    () =>
      buildStatusMeta({
        connection,
        sttMode: voiceCaptureModeLabel(),
        activeSpeaker,
        wakeOn: wakeWordEnabled,
        backgroundVoice: appInBackground && status !== "idle",
      }),
    [connection, activeSpeaker, wakeWordEnabled, appInBackground, status],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.titleRow}>
            <Pressable
              style={styles.historyBtn}
              onPress={() => {
                void refreshChatSessionList();
                setHistoryOpen(true);
              }}
              accessibilityLabel="Chat history"
            >
              <Text style={styles.historyIcon}>☰</Text>
            </Pressable>
            <Text style={styles.title}>Atlas</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={styles.gearBtn}
              onPress={() => setSettingsOpen(true)}
              accessibilityLabel="Settings"
            >
              <Text style={styles.gearIcon}>⚙</Text>
            </Pressable>
            <Pressable style={styles.statusPill} onPress={refreshHealth}>
              <View
                style={[
                  styles.statusDot,
                  connection === "online"
                    ? styles.dotOnline
                    : connection === "offline"
                      ? styles.dotOffline
                      : styles.dotUnknown,
                ]}
              />
              <Text style={styles.statusText}>
                {connection === "online" ? "OK" : connection === "offline" ? "Off" : "…"}
              </Text>
            </Pressable>
          </View>
        </View>
        {connection === "offline" && connectionError ? (
          <Text style={styles.headerError} numberOfLines={2}>
            {connectionError}
          </Text>
        ) : (
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="tail">
            {shortServerLabel(activeServer)} · {headerMeta}
          </Text>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 8}
      >
        <FlatList
          ref={listRef}
          style={styles.flex}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
          contentContainerStyle={[
            styles.transcript,
            messages.length === 0 && styles.transcriptEmpty,
          ]}
          onContentSizeChange={scrollToEnd}
          onLayout={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={false}
        />

        {audioDiag && <Text style={styles.audioDiag}>{audioDiag}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={[styles.dock, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.toggleRow}>
            <Pressable
              onPress={() => setDeepMode((v) => !v)}
              style={[styles.deepToggle, deepMode && styles.deepToggleOn]}
            >
              <Text style={[styles.deepToggleText, deepMode && styles.deepToggleTextOn]}>
                {deepMode ? "● Deep reasoning" : "○ Deep reasoning"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Or type a message…"
              placeholderTextColor="#5b6675"
              value={draft}
              onChangeText={setDraft}
              editable={!isListening}
              onSubmitEditing={handleSendDraft}
              returnKeyType="send"
            />
            <Pressable
              style={[styles.sendBtn, (!draft.trim() || isListening) && styles.sendBtnDisabled]}
              onPress={handleSendDraft}
              disabled={!draft.trim() || isListening}
            >
              <Text style={styles.sendBtnText}>Send</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleMicToggle}
            style={({ pressed }) => [
              styles.mic,
              isListening && styles.micActive,
              (status === "thinking" || status === "speaking") && styles.micInterrupt,
              pressed && styles.micPressed,
            ]}
          >
            {status === "thinking" && !isListening ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.micIcon}>{isListening ? "●" : "🎙"}</Text>
            )}
          </Pressable>
          <Text style={styles.hint}>
            {isListening && partial.trim()
              ? voiceCaptureModeLabel() === "Grok STT"
                ? "Keep talking — Smart Turn sends when you're done, or tap mic"
                : "Keep talking — ~3s pause sends, or tap mic"
              : isListening
                ? "Listening… tap mic when you're done"
                : STATUS_LABEL[status]}
          </Text>
        </View>
      </KeyboardAvoidingView>

      <ChatHistoryDrawer
        visible={historyOpen}
        sessions={chatSessions}
        activeSessionId={chatSessionId}
        onClose={() => setHistoryOpen(false)}
        onSelect={(id) => {
          setHistoryOpen(false);
          void loadChatSession(id);
        }}
        onNewChat={() => {
          void startNewChatSession();
        }}
        onDelete={(id) => {
          void removeChatSession(id);
        }}
      />

      <SpeakerSettingsModal
        visible={settingsOpen}
        sessionKey={voiceSessionKeyRef.current}
        wakeWordEnabled={wakeWordEnabled}
        wakeWordAvailable={isWakeWordAvailable()}
        wakeWordLabel={wakeWordLabel()}
        buildStamp={APP_BUILD_STAMP}
        shortcutListenUrl={SHORTCUT_LISTEN_URL}
        onClose={() => setSettingsOpen(false)}
        onToggleWakeWord={handleToggleWakeWord}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AtlasApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0f17" },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e2633",
    gap: 4,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  historyBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#151c28",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#2a3344",
  },
  historyIcon: {
    color: "#c5d0e0",
    fontSize: 18,
    fontWeight: "700",
  },
  title: {
    color: "#e6edf3",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  subtitle: { color: "#5b6675", fontSize: 12, flexShrink: 1, minWidth: 0 },
  headerError: { color: "#f87171", fontSize: 12, lineHeight: 16 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    marginLeft: 12,
  },
  gearBtn: {
    backgroundColor: "#141a24",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  gearIcon: { color: "#c5d0de", fontSize: 18 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141a24",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotOnline: { backgroundColor: "#22c55e" },
  dotOffline: { backgroundColor: "#ef4444" },
  dotUnknown: { backgroundColor: "#8b95a5" },
  statusText: { color: "#8b95a5", fontSize: 12 },
  transcript: { padding: 16, paddingBottom: 24, gap: 10 },
  transcriptEmpty: { flexGrow: 1 },
  footer: { gap: 10 },
  empty: { paddingTop: 64, paddingHorizontal: 12, alignItems: "center" },
  emptyTitle: { color: "#e6edf3", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  emptyBody: { color: "#8b95a5", fontSize: 15, textAlign: "center", lineHeight: 22 },
  bubbleRow: { flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  atlasBubble: { backgroundColor: "#161b26", borderTopLeftRadius: 4 },
  userBubble: { backgroundColor: "#1f6feb", borderTopRightRadius: 4 },
  errorBubble: { backgroundColor: "#3a1d1d", borderTopLeftRadius: 4 },
  partialBubble: { opacity: 0.9 },
  bubbleLabel: {
    color: "#5fb0ff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
  },
  bubbleText: { color: "#e6edf3", fontSize: 16, lineHeight: 22 },
  userText: { color: "#ffffff" },
  listeningHint: { fontStyle: "italic", opacity: 0.8 },
  notice: {
    color: "#f0a35e",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  audioDiag: {
    color: "#8b95a5",
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  dock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1e2633",
    backgroundColor: "#0d121b",
    alignItems: "center",
  },
  toggleRow: { flexDirection: "row", justifyContent: "flex-end", width: "100%", marginBottom: 8 },
  deepToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#141a24",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a3340",
  },
  deepToggleOn: { backgroundColor: "#3b2f12", borderColor: "#f59e0b" },
  deepToggleText: { color: "#8b95a5", fontSize: 12, fontWeight: "600" },
  deepToggleTextOn: { color: "#f5b342" },
  inputRow: { flexDirection: "row", alignItems: "center", width: "100%", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: "#141a24",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    color: "#e6edf3",
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: "#1f6feb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#ffffff", fontWeight: "600" },
  mic: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#1f6feb",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    shadowColor: "#1f6feb",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  micActive: { backgroundColor: "#ef4444", shadowColor: "#ef4444", transform: [{ scale: 1.06 }] },
  micInterrupt: { backgroundColor: "#f59e0b", shadowColor: "#f59e0b" },
  micPressed: { opacity: 0.9 },
  micIcon: { fontSize: 28, color: "#ffffff", fontWeight: "700" },
  hint: { color: "#8b95a5", fontSize: 13, marginTop: 10, textAlign: "center" },
});
