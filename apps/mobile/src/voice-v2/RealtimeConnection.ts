/**
 * Thin Realtime WS client — Mac proxy, PCM append with pre-configure buffer.
 */
import type { ChatTurn } from "../api";
import { dlog, dwarn } from "../log";
import {
  getUnifiedMetrics,
  recordUnifiedMetric,
  resetUnifiedMetrics,
} from "../unified-realtime-metrics";
import type { RealtimeConfigure, RealtimeEvent } from "./types";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CONNECT_TIMEOUT_MS = 12_000;
const SESSION_ABORTED = "SESSION_ABORTED";

export interface RealtimeConnection {
  configure(config: RealtimeConfigure): void;
  appendMicPcmBase64(base64: string): void;
  requestResponse(): void;
  cancelResponse(): void;
  close(): void;
  isOpen(): boolean;
  isReady(): boolean;
  waitReady(timeoutMs?: number): Promise<void>;
  metrics(): ReturnType<typeof getUnifiedMetrics>;
}

function buildProxyWsUrl(baseUrl: string, clientSecret: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("secret", clientSecret);
  return url.toString();
}

export function historyToConversationItems(history: ChatTurn[]): Record<string, unknown>[] {
  return history.slice(-10).map((turn) => {
    if (turn.role === "assistant") {
      return {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: turn.content }],
      };
    }
    return {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: turn.content }],
    };
  });
}

export function connectRealtime(
  wsUrl: string,
  clientSecret: string,
  onEvent: (event: RealtimeEvent) => void,
): RealtimeConnection {
  resetUnifiedMetrics();
  const connectStarted = Date.now();
  let readyAt: number | null = null;
  let ready = false;
  let sawFirstAudio = false;
  let userTranscript = "";
  let atlasText = "";
  let sawTextDelta = false;
  const pendingAudio: string[] = [];
  let intentionalClose = false;
  let readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  const resolvedUrl = buildProxyWsUrl(wsUrl, clientSecret);
  const socket = new WebSocket(resolvedUrl, [`xai-client-secret.${clientSecret}`]);

  const settleReadyWaiters = (error?: Error) => {
    const waiters = readyWaiters;
    readyWaiters = [];
    if (error) {
      for (const w of waiters) w.reject(error);
      return;
    }
    for (const w of waiters) w.resolve();
  };

  const emit = (event: RealtimeEvent) => {
    onEvent(event);
  };

  const flushAppend = (base64: string) => {
    if (socket.readyState !== WebSocket.OPEN || !base64) return;
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
  };

  const connectTimer = setTimeout(() => {
    if (ready) return;
    dwarn("voice-v2", "realtime connect timeout");
    const message = "Realtime connection timed out — check Mac server and Tailscale.";
    settleReadyWaiters(new Error(message));
    emit({ type: "error", message });
    intentionalClose = true;
    try {
      socket.close();
    } catch {}
  }, CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    const ms = Date.now() - connectStarted;
    recordUnifiedMetric("realtimeConnectMs", ms);
    dlog("voice-v2", `ws open (${ms}ms)`);
  };

  socket.onmessage = (event) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }

    const type = String(payload.type ?? "");

    switch (type) {
      case "proxy.configured":
        clearTimeout(connectTimer);
        ready = true;
        readyAt = Date.now();
        while (pendingAudio.length) {
          const chunk = pendingAudio.shift();
          if (chunk) flushAppend(chunk);
        }
        settleReadyWaiters();
        emit({ type: "configured", sessionId: String(payload.sessionId ?? "") });
        return;
      case "input_audio_buffer.speech_started":
        userTranscript = "";
        emit({ type: "speech_started" });
        return;
      case "input_audio_buffer.speech_stopped":
        emit({ type: "speech_stopped" });
        return;
      case "conversation.item.input_audio_transcription.updated":
      case "conversation.item.input_audio_transcription.delta": {
        const text = String(
          (payload.transcript as string | undefined) ??
            (typeof payload.delta === "string" ? userTranscript + payload.delta : userTranscript),
        ).trim();
        if (text) {
          userTranscript = text;
          emit({ type: "user_transcript", text, isFinal: false });
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(
          (payload.transcript as string | undefined) ??
            ((payload.item as Record<string, unknown> | undefined)?.transcript as string | undefined) ??
            userTranscript,
        ).trim();
        if (text) {
          userTranscript = text;
          emit({ type: "user_transcript", text, isFinal: true });
        }
        return;
      }
      case "response.text.delta":
        if (typeof payload.delta === "string") {
          sawTextDelta = true;
          atlasText += payload.delta;
          emit({ type: "atlas_text_delta", text: atlasText });
        }
        return;
      case "response.output_audio_transcript.delta":
        if (typeof payload.delta === "string" && !sawTextDelta) {
          atlasText += payload.delta;
          emit({ type: "atlas_text_delta", text: atlasText });
        }
        return;
      case "response.output_audio_transcript.done":
        if (typeof payload.transcript === "string" && !atlasText.trim()) {
          atlasText = payload.transcript;
          emit({ type: "atlas_text_delta", text: atlasText });
        }
        return;
      case "response.audio.delta":
      case "response.output_audio.delta":
        if (typeof payload.delta === "string" && payload.delta.length > 0) {
          if (!sawFirstAudio && readyAt) {
            sawFirstAudio = true;
            recordUnifiedMetric("firstAudioDeltaMs", Date.now() - readyAt);
            dlog("voice-v2", `first audio delta (${Date.now() - readyAt}ms)`);
          }
          emit({ type: "audio_delta", base64: payload.delta });
        }
        return;
      case "response.done":
        if (readyAt) {
          recordUnifiedMetric("turnCompleteMs", Date.now() - readyAt);
        }
        sawTextDelta = false;
        emit({ type: "response_done" });
        atlasText = "";
        return;
      case "error": {
        const message = String(
          (payload.error as Record<string, unknown> | undefined)?.message ??
            payload.message ??
            "realtime error",
        );
        dwarn("voice-v2", message);
        emit({ type: "error", message });
        return;
      }
      default:
        return;
    }
  };

  socket.onerror = () => {
    emit({ type: "error", message: "Realtime websocket transport error" });
  };

  socket.onclose = () => {
    clearTimeout(connectTimer);
    const wasReady = ready;
    ready = false;
    dlog("voice-v2", intentionalClose ? "ws closed (intentional)" : "ws closed");
    if (!intentionalClose) {
      settleReadyWaiters(
        new Error(
          wasReady
            ? "Realtime connection lost — tap mic to reconnect."
            : "Realtime connection closed before mic was ready.",
        ),
      );
      emit({
        type: "error",
        message: wasReady
          ? "Realtime connection lost — tap mic to reconnect."
          : "Realtime connection closed before mic was ready.",
      });
    } else {
      settleReadyWaiters(new Error(SESSION_ABORTED));
    }
  };

  const sendConfigure = (config: RealtimeConfigure) => {
    socket.send(
      JSON.stringify({
        type: "proxy.configure",
        instructions: config.instructions,
        voice: config.voice,
        inputSampleRate: INPUT_SAMPLE_RATE,
        outputSampleRate: OUTPUT_SAMPLE_RATE,
        history: config.history?.slice(-10) ?? [],
      }),
    );
  };

  return {
    configure: (config) => {
      if (socket.readyState !== WebSocket.OPEN) {
        socket.addEventListener("open", () => sendConfigure(config), { once: true });
        return;
      }
      sendConfigure(config);
    },
    appendMicPcmBase64: (base64) => {
      if (!base64) return;
      if (!ready || socket.readyState !== WebSocket.OPEN) {
        pendingAudio.push(base64);
        if (pendingAudio.length > 200) pendingAudio.shift();
        return;
      }
      flushAppend(base64);
    },
    requestResponse: () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["text", "audio"] },
        }),
      );
    },
    cancelResponse: () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "response.cancel" }));
    },
    close: () => {
      intentionalClose = true;
      ready = false;
      try {
        socket.close();
      } catch {}
    },
    isOpen: () => socket.readyState === WebSocket.OPEN,
    isReady: () => ready,
    waitReady: (timeoutMs = CONNECT_TIMEOUT_MS) =>
      new Promise<void>((resolve, reject) => {
        if (ready) {
          resolve();
          return;
        }
        const waiter = {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error: Error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          readyWaiters = readyWaiters.filter((w) => w !== waiter);
          reject(new Error("Realtime connection timed out — check Mac server and Tailscale."));
        }, timeoutMs);
        readyWaiters.push(waiter);
      }),
    metrics: getUnifiedMetrics,
  };
}
