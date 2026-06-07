import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { ATLAS_SERVER_URL } from "./src/config";
import { dlog } from "./src/log";
import { abortRealtime, runRealtimeTurn } from "./src/realtime";
import { useSpeechRecognitionEvent } from "./src/speech";
import { useVoiceCapture } from "./src/useVoiceCapture";

// Phrase triggers that opt a single turn into the slower reasoning model.
const DEEP_INTENT = /\b(think (deeply|hard|carefully)|deep dive|deep[- ]?think|take your time|really think|think it through)\b/i;
// Phrases that should force a fresh project rescan before answering.
const REFRESH_INTENT = /\b(latest|refresh|re-?scan|up to date|most recent|current status|what's new|whats new|review (the )?code|scan (my )?projects|what context|what do you know|deep scan|read (my )?repos)\b/i;

function looksDeep(text: string): boolean {
  return DEEP_INTENT.test(text);
}

function looksRefresh(text: string): boolean {
  return REFRESH_INTENT.test(text);
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

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "Tap mic to speak",
  listening: "Listening… pause when done",
  thinking: "Tap to interrupt",
  speaking: "Tap to interrupt",
};

function AtlasApp() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [partial, setPartial] = useState("");
  const [streamingAtlas, setStreamingAtlas] = useState("");
  const [connection, setConnection] = useState<Connection>("unknown");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [deepMode, setDeepMode] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
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

  messagesRef.current = messages;
  statusRef.current = status;
  partialRef.current = partial;
  deepModeRef.current = deepMode;

  const refreshHealth = useCallback(async () => {
    try {
      const health = await checkHealth();
      setConnection(health.ok ? "online" : "offline");
    } catch {
      setConnection("offline");
    }
  }, []);

  const loadChiefSession = useCallback(async () => {
    try {
      const session = await fetchChiefSession();
      instructionsRef.current = session.instructions;
      voiceRef.current = session.voice || "rex";
      setConnection("online");
    } catch {
      setConnection("offline");
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    loadChiefSession();
  }, [refreshHealth, loadChiefSession]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const cancelActiveRequest = useCallback(() => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  // Fast path: realtime text + native PCM stream (AVAudioEngine on iOS).
  const runFastTurn = useCallback(
    async (
      clean: string,
      history: ChatTurn[],
      interrupted: boolean,
      controller: AbortController,
    ) => {
      const secret = await fetchRealtimeClientSecret();
      setStatus("speaking");

      const result = await runRealtimeTurn({
        clientSecret: secret.value,
        wsUrl: secret.wsUrl,
        instructions: instructionsRef.current,
        history,
        userMessage: clean,
        interrupted,
        voice: voiceRef.current,
        signal: controller.signal,
        onTextDelta: (delta) => {
          setStreamingAtlas(delta);
          scrollToEnd();
        },
      });

      if (controller.signal.aborted) return;

      // TTS fallback only if native/realtime audio did not play.
      if (!result.audioPlayed && result.text) {
        try {
          const tts = await fetchTtsAudio(result.text);
          if (tts.audio && !controller.signal.aborted) {
            setStatus("speaking");
            await playBase64Mp3(tts.audio);
          }
        } catch {
          // Text still shown.
        }
      }

      if (controller.signal.aborted) return;
      setConnection("online");
      setStreamingAtlas("");
      setMessages((prev) => [...prev, { id: makeId(), role: "atlas", text: result.text }]);
      scrollToEnd();
    },
    [scrollToEnd],
  );

  // Deep path: server reasoning model, then spoken via TTS. Used on explicit
  // permission ("think deeply") or the Deep toggle. Slower but more capable.
  const runDeepTurn = useCallback(
    async (
      clean: string,
      history: ChatTurn[],
      interrupted: boolean,
      controller: AbortController,
    ) => {
      const reply = await askChiefDeep(clean, history, interrupted, controller.signal);
      if (controller.signal.aborted) return;

      setConnection("online");
      setMessages((prev) => [...prev, { id: makeId(), role: "atlas", text: reply.filtered }]);
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
    [scrollToEnd],
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
      const needsMoment = deep || needsRefresh;
      dlog("turn", `send deep=${deep} refresh=${needsRefresh} text="${clean.slice(0, 60)}"`);

      const history: ChatTurn[] = messagesRef.current.map((msg) => ({
        role: msg.role === "atlas" ? "assistant" : "user",
        content: msg.text,
      }));

      setMessages((prev) => [...prev, { id: makeId(), role: "user", text: clean }]);
      setStatus("thinking");
      setStreamingAtlas("");
      setPartial("");
      scrollToEnd();

      const controller = new AbortController();
      activeRequestRef.current = controller;

      try {
        if (needsMoment) {
          await speakMomentSir();
          if (controller.signal.aborted) return;
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

        await loadChiefSession();

        if (deep) {
          await runDeepTurn(clean, history, interrupted, controller);
        } else {
          await runFastTurn(clean, history, interrupted, controller);
        }
      } catch (error) {
        if (
          (error as Error)?.name === "AbortError" ||
          (error as Error)?.message === "Aborted"
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "atlas", text: message, error: true },
        ]);
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
    [loadChiefSession, runDeepTurn, runFastTurn, scrollToEnd],
  );

  const voiceCapture = useVoiceCapture({
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Atlas</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {ATLAS_SERVER_URL.replace(/^https?:\/\//, "")} · native stream
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
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.transcript}
          onContentSizeChange={scrollToEnd}
        >
          {messages.length === 0 && !streamingAtlas && (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Good day, sir.</Text>
              <Text style={styles.emptyBody}>
                Tap the mic once to start a voice session — speak, pause, and Atlas replies.
                The mic stays on so you can keep talking. Tap again while listening to stop.
              </Text>
            </View>
          )}

          {messages.map((msg) => (
            <View
              key={msg.id}
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
                <Text
                  style={[styles.bubbleText, msg.role === "user" && styles.userText]}
                >
                  {msg.text}
                </Text>
              </View>
            </View>
          ))}

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
        </ScrollView>

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
              ? "Pause to send, or tap mic again"
              : isListening
                ? "Listening… tap mic to stop"
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
