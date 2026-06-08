import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
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
  type ChatTurn,
} from "./src/api";
import { playBase64Mp3, stopPlayback } from "./src/audio";
import { stopStreamingPlayback } from "./src/stream-audio";
import { ATLAS_SERVER_URL, getResolvedServerUrl } from "./src/config";
import { getLastResolveError } from "./src/api";
import { dlog, dwarn } from "./src/log";
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
} from "./src/useAdaptiveVoiceCapture";

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
const APP_BUILD_STAMP = "2026-06-08-xai-stt";

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "Tap mic to speak",
  listening: "Listening… take your time",
  thinking: "Tap to interrupt",
  speaking: "Tap to interrupt",
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

  const listRef = useRef<FlatList<Message>>(null);
  const messagesRef = useRef<Message[]>([]);
  const statusRef = useRef<Status>("idle");
  const activeRequestRef = useRef<AbortController | null>(null);
  const interruptedRef = useRef(false);
  const instructionsRef = useRef("");
  const voiceRef = useRef("rex");
  const partialRef = useRef("");
  const deepModeRef = useRef(false);
  /** True while user wants continuous voice mode (tap once, keep talking). */
  const micSessionRef = useRef(false);

  statusRef.current = status;
  partialRef.current = partial;
  deepModeRef.current = deepMode;

  const pushMessage = useCallback((msg: Message) => {
    let next = [...messagesRef.current, msg];
    if (next.length > MAX_UI_MESSAGES) {
      next = next.slice(-MAX_UI_MESSAGES);
    }
    messagesRef.current = next;
    setMessages(next);
    if (!msg.error) {
      void recordTranscript(msg.role, msg.text);
    }
  }, []);

  const connectToServer = useCallback(async () => {
    setConnectionError(null);
    try {
      const health = await checkHealth(true);
      setActiveServer(getResolvedServerUrl() ?? health.url ?? ATLAS_SERVER_URL);
      setConnection("online");

      try {
        const session = await fetchChiefSession();
        instructionsRef.current = session.instructions;
        voiceRef.current = session.voice || "rex";
      } catch (error) {
        dwarn("session", "chief instructions failed after health ok", error);
      }
      void getLocationContext().catch(() => {});
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
  }, []);

  const refreshHealth = useCallback(() => connectToServer(), [connectToServer]);

  const loadChiefSession = useCallback(async () => {
    const session = await fetchChiefSession();
    instructionsRef.current = session.instructions;
    voiceRef.current = session.voice || "rex";
  }, []);

  useEffect(() => {
    void initAudibleAudioMode();
    connectToServer();
  }, [connectToServer]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // Don't re-probe the server mid-turn — it can disrupt the audio session.
      if (state !== "active") return;
      const busy = statusRef.current !== "idle";
      if (busy) return;
      connectToServer();
    });
    return () => sub.remove();
  }, [connectToServer]);

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
    ) => {
      const secret = await fetchRealtimeClientSecret();
      setStatus("thinking");
      setAudioDiag(null);
      await stopStreamingPlayback();
      await stopPlayback();
      await prepareForNativeStream();

      const result = await runRealtimeTurn({
        clientSecret: secret.value,
        wsUrl: secret.wsUrl,
        instructions: instructionsRef.current,
        history,
        userMessage: clean,
        interrupted,
        afterHoldPhrase,
        voice: voiceRef.current,
        textOnly: false,
        signal: controller.signal,
        onFirstAudio: () => {
          if (!controller.signal.aborted) setStatus("speaking");
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
    async (text: string, interrupted: boolean) => {
      const clean = text.trim();
      if (!clean) {
        setStatus("idle");
        return;
      }

      const deep = deepModeRef.current || looksDeep(clean);
      const needsRefresh = looksRefresh(clean);
      const needsResearch = looksResearch(clean);
      const needsMoment = deep || needsRefresh;
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

      const controller = new AbortController();
      activeRequestRef.current = controller;

      let messageForAtlas = clean;
      if (needsResearch) {
        const loc = await getLocationContext();
        if (loc) {
          messageForAtlas = `[User location: ${loc}. Use this for weather, local news, and nearby queries.] ${clean}`;
        }
      }

      try {
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
          await runFastTurn(messageForAtlas, history, interrupted, controller, needsMoment);
        }
      } catch (error) {
        if (
          (error as Error)?.name === "AbortError" ||
          (error as Error)?.message === "Aborted"
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : "Something went wrong.";
        pushMessage({ id: makeId(), role: "atlas", text: message, error: true });
        setConnection("offline");
        scrollToEnd();
      } finally {
        setStreamingAtlas("");
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
        if (controller.signal.aborted) {
          if (!voiceCapture.isActive() && !micSessionRef.current) {
            setStatus("idle");
          }
          return;
        }
        if (micSessionRef.current) {
          setStatus("listening");
          try {
            await voiceCapture.startCapture();
          } catch {
            micSessionRef.current = false;
            setStatus("idle");
          }
        } else {
          setStatus("idle");
        }
      }
    },
    [loadChiefSession, pushMessage, runDeepTurn, runFastTurn, scrollToEnd],
  );

  const voiceCapture = useAdaptiveVoiceCapture({
    onPartial: (text) => {
      partialRef.current = text;
      setPartial(text);
    },
    onError: (message) => setNotice(message),
    onCaptureEnd: () => {
      if (statusRef.current === "listening") {
        setStatus("idle");
      }
    },
    onSubmit: async (text) => {
      const interrupted = interruptedRef.current;
      interruptedRef.current = false;
      setPartial("");
      setStatus("thinking");
      await sendToAtlas(text, interrupted);
    },
  });

  useSpeechRecognitionEvent("result", voiceCapture.onSpeechResult);
  useSpeechRecognitionEvent("end", voiceCapture.onSpeechEnd);
  useSpeechRecognitionEvent("error", voiceCapture.onSpeechError);

  const handleMicToggle = useCallback(async () => {
    const pendingText =
      partialRef.current.trim() || voiceCapture.getTranscript().trim();

    if (statusRef.current === "listening" && pendingText) {
      setNotice(null);
      await voiceCapture.forceSubmit(pendingText);
      return;
    }

    if (statusRef.current === "listening" && voiceCapture.isActive() && !pendingText) {
      micSessionRef.current = false;
      setNotice(null);
      await voiceCapture.stopCapture(false);
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
        await voiceCapture.startCapture();
      } catch {
        setStatus("idle");
      }
      return;
    }

    interruptedRef.current = false;
    micSessionRef.current = true;
    setNotice(null);
    setStatus("listening");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await abortRealtime();
      await stopPlayback();
      await voiceCapture.startCapture();
    } catch {
      setStatus("idle");
    }
  }, [cancelActiveRequest, voiceCapture]);

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
        {isListening && partial.length > 0 && (
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
                Listening…
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

        {status === "thinking" && !streamingAtlas && (
          <View style={[styles.bubbleRow, styles.rowLeft]}>
            <View style={[styles.bubble, styles.atlasBubble]}>
              <ActivityIndicator color="#8b95a5" />
            </View>
          </View>
        )}
      </View>
    ),
    [isListening, partial, streamingAtlas, status],
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Atlas</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {connection === "offline" && connectionError
              ? connectionError
              : `${activeServer.replace(/^https?:\/\//, "")} · ${APP_BUILD_STAMP} · ${voiceCaptureModeLabel()}`}
          </Text>
        </View>
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
            {connection === "online" ? "Connected" : connection === "offline" ? "Offline" : "…"}
          </Text>
        </Pressable>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e2633",
  },
  title: { color: "#e6edf3", fontSize: 22, fontWeight: "700", letterSpacing: 0.5 },
  subtitle: { color: "#5b6675", fontSize: 12, marginTop: 2 },
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
