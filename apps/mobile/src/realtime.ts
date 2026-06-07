// xAI realtime: streaming text + native PCM audio (AVAudioEngine on iOS).
import type { ChatTurn } from "./api";
import {
  startStreamingPcmPlayback,
  stopStreamingPlayback,
  type StreamingPcmPlayback,
} from "./stream-audio";
import { resetAudioForPlayback } from "./speech";
import { dlog, dwarn } from "./log";

const REALTIME_MODEL = "grok-voice-think-fast-1.0";
const REALTIME_VOICE = "rex";
const SAMPLE_RATE = 24000;

export interface RealtimeTurnResult {
  text: string;
  route: "realtime-text" | "realtime-text-audio";
  audioPlayed: boolean;
  firstAudioMs?: number;
}

export interface RealtimeTurnParams {
  clientSecret: string;
  wsUrl: string;
  instructions: string;
  history: ChatTurn[];
  userMessage: string;
  interrupted?: boolean;
  voice?: string;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function toConversationItem(turn: ChatTurn) {
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
}

function extractText(payload: Record<string, unknown>): string | null {
  const part = payload.part as Record<string, unknown> | undefined;
  if (part?.text) return String(part.text);
  if (part?.transcript) return String(part.transcript);
  const item = payload.item as Record<string, unknown> | undefined;
  const content = item?.content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .map((p) => (p as Record<string, unknown>)?.text ?? (p as Record<string, unknown>)?.transcript)
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length ? parts.join(" ") : null;
}

export async function runRealtimeTurn(params: RealtimeTurnParams): Promise<RealtimeTurnResult> {
  await resetAudioForPlayback();

  const conversationMessages = params.history.slice(-10);
  const voicePrefix =
    "[Voice input — Camron spoke aloud via Atlas; STT transcribed. You can hear him. Respond in voice.] ";
  const userContent = params.interrupted
    ? `${voicePrefix}[User interrupted while you were speaking. Continue naturally and address this:] ${params.userMessage}`
    : `${voicePrefix}${params.userMessage}`;

  const startedAt = Date.now();

  return new Promise<RealtimeTurnResult>((resolve, reject) => {
    const socket = new WebSocket(params.wsUrl, [`xai-client-secret.${params.clientSecret}`]);
    let configured = false;
    let responseRequested = false;
    let responded = false;
    let settledOut = false;
    let finalText = "";
    let sawTextDelta = false;
    let sawAudio = false;
    let firstAudioMs: number | undefined;

    let playerPromise: Promise<StreamingPcmPlayback> | null = null;
    const ensurePlayer = (): Promise<StreamingPcmPlayback> => {
      if (!playerPromise) {
        playerPromise = startStreamingPcmPlayback(SAMPLE_RATE, () => {
          firstAudioMs = Date.now() - startedAt;
          dlog("rt", `first audio (${firstAudioMs}ms)`);
        });
      }
      return playerPromise;
    };

    const timeout = setTimeout(() => fail(new Error("Realtime request timed out.")), 45000);

    const closeSocket = () => {
      try {
        socket.close();
      } catch {}
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    };

    const fail = (error: Error) => {
      if (settledOut) return;
      settledOut = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", onAbort);
      void stopStreamingPlayback();
      closeSocket();
      dwarn("rt", "turn failed:", error.message);
      reject(error);
    };

    const onAbort = () => {
      dlog("rt", "aborted");
      void stopStreamingPlayback();
      fail(new DOMException("Aborted", "AbortError"));
    };

    params.signal?.addEventListener("abort", onAbort);

    const complete = async () => {
      if (settledOut) return;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", onAbort);
      closeSocket();

      const text = finalText.trim();
      let audioPlayed = false;

      if (sawAudio && playerPromise) {
        try {
          const player = await playerPromise;
          await player.finish();
          audioPlayed = true;
          dlog("rt", `playback done (${Date.now() - startedAt}ms)`);
        } catch (e) {
          dwarn("rt", "native stream playback failed", e);
        }
      }

      if (settledOut) return;
      settledOut = true;

      if (!text && !audioPlayed) {
        reject(new Error("Realtime returned no text."));
        return;
      }

      resolve({
        text,
        route: sawAudio ? "realtime-text-audio" : "realtime-text",
        audioPlayed,
        firstAudioMs,
      });
    };

    socket.onopen = () => dlog("rt", "ws open");

    socket.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      switch (payload.type) {
        case "session.created":
        case "conversation.created":
          if (configured) return;
          configured = true;
          socket.send(
            JSON.stringify({
              type: "session.update",
              session: {
                model: REALTIME_MODEL,
                instructions: params.instructions,
                voice: params.voice ?? REALTIME_VOICE,
                turn_detection: { type: null },
                tools: [{ type: "web_search" }],
                audio: {
                  input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
                  output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
                },
              },
            }),
          );
          return;
        case "session.updated":
          if (responseRequested) return;
          responseRequested = true;
          for (const turn of conversationMessages) {
            socket.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: toConversationItem(turn),
              }),
            );
          }
          socket.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: toConversationItem({ role: "user", content: userContent }),
            }),
          );
          socket.send(
            JSON.stringify({
              type: "response.create",
              response: { modalities: ["text", "audio"] },
            }),
          );
          return;
        case "response.text.delta":
          if (typeof payload.delta === "string") {
            sawTextDelta = true;
            finalText += payload.delta;
            params.onTextDelta?.(finalText);
          }
          return;
        case "response.output_audio_transcript.delta":
          if (typeof payload.delta === "string" && !sawTextDelta) {
            finalText += payload.delta;
            params.onTextDelta?.(finalText);
          }
          return;
        case "response.output_audio_transcript.done":
          if (typeof payload.transcript === "string" && !finalText.trim()) {
            finalText = payload.transcript;
            params.onTextDelta?.(finalText);
          }
          return;
        case "response.audio.delta":
        case "response.output_audio.delta":
          if (typeof payload.delta === "string" && payload.delta.length > 0) {
            if (!sawAudio) dlog("rt", `first audio delta (${Date.now() - startedAt}ms)`);
            sawAudio = true;
            void ensurePlayer().then((p) => p.appendBase64Chunk(payload.delta as string));
          }
          return;
        case "response.content_part.done":
        case "response.output_item.done": {
          const t = extractText(payload);
          if (t && !finalText.trim()) {
            finalText = t;
            params.onTextDelta?.(finalText);
          }
          return;
        }
        case "response.done":
          responded = true;
          dlog("rt", `response.done (${Date.now() - startedAt}ms)`);
          void complete();
          return;
        case "error":
          fail(
            new Error(
              `Realtime error: ${(payload.error as Record<string, unknown>)?.message ?? "unknown"}`,
            ),
          );
          return;
        default:
          return;
      }
    };

    socket.onerror = () => fail(new Error("Realtime websocket error."));
    socket.onclose = () => {
      if (!responded && !settledOut) fail(new Error("Realtime closed before completion."));
    };
  });
}

export async function abortRealtime(): Promise<void> {
  await stopStreamingPlayback();
}
