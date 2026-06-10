// xAI realtime: streaming text + native PCM audio (AVAudioEngine on iOS).
import type { ChatTurn } from "./api";
import { startStreamingPcmPlayback, stopStreamingPlayback } from "./stream-audio";
import { dlog, dwarn } from "./log";
import { createRealtimePcmHandle } from "./realtime-pcm";
import { decideTurnAudio, flushAppendChain, type TurnAudioRoute } from "./turn-audio-policy";
import { traceTurnAudio } from "./turn-audio-trace";

const REALTIME_MODEL = "grok-voice-think-fast-1.0";
const REALTIME_VOICE = "rex";
const SAMPLE_RATE = 24000;

export interface RealtimeTurnResult {
  text: string;
  route: TurnAudioRoute;
  audioPlayed: boolean;
  /** @deprecated Use allowTtsFallback — kept for compatibility */
  requiresTtsFallback: boolean;
  allowTtsFallback: boolean;
  sawAudioDeltas: boolean;
  pcmDelivered: boolean;
  firstAudioMs?: number;
  turnId: string;
}

export interface RealtimeTurnParams {
  clientSecret: string;
  wsUrl: string;
  instructions: string;
  history: ChatTurn[];
  userMessage: string;
  interrupted?: boolean;
  afterHoldPhrase?: boolean;
  voice?: string;
  voiceInputPrefix?: string;
  textOnly?: boolean;
  onFirstAudio?: () => void;
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

// Long replies must never be cut off mid-sentence. This bounds only a *stuck*
// player, not normal playback (which resolves as soon as buffers drain).
const FINISH_PLAYBACK_TIMEOUT_MS = 180_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeTurnId(): string {
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function runRealtimeTurn(params: RealtimeTurnParams): Promise<RealtimeTurnResult> {
  const textOnly = params.textOnly === true;
  const turnId = makeTurnId();
  const conversationMessages = params.history.slice(-10);
  const voicePrefix =
    params.voiceInputPrefix ??
    "[Voice input — user spoke aloud via Atlas; STT transcribed. You can hear them. Respond in voice.] ";
  const holdHint = params.afterHoldPhrase
    ? "[Camron already heard a brief hold phrase. Do NOT open with Yes sir or any acknowledgment. Say sir at most ONCE in the entire reply. Begin directly with the answer.] "
    : "";
  const userContent = params.interrupted
    ? `${voicePrefix}${holdHint}[User interrupted while you were speaking. Continue naturally and address this:] ${params.userMessage}`
    : `${voicePrefix}${holdHint}${params.userMessage}`;

  const startedAt = Date.now();
  let firstAudioMs: number | undefined;

  const pcm = textOnly
    ? null
    : createRealtimePcmHandle(
        (onFirst) =>
          startStreamingPcmPlayback(SAMPLE_RATE, () => {
            firstAudioMs = Date.now() - startedAt;
            dlog("rt", `first audio (${firstAudioMs}ms)`);
            onFirst?.();
          }),
        () => {
          params.onFirstAudio?.();
        },
      );

  void traceTurnAudio({ turnId, event: "turn-start", detail: textOnly ? "textOnly" : "native" });

  return new Promise<RealtimeTurnResult>((resolve, reject) => {
    const socket = new WebSocket(params.wsUrl, [`xai-client-secret.${params.clientSecret}`]);
    let configured = false;
    let responseRequested = false;
    let responseDone = false;
    let settledOut = false;
    let finalText = "";
    let sawTextDelta = false;

    // Bounds generation time only — cleared on response.done before playback drains.
    const timeout = setTimeout(() => fail(new Error("Realtime request timed out.")), 120000);

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
      void traceTurnAudio({ turnId, event: "turn-fail", detail: error.message });
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

      const text = finalText.trim();

      if (pcm) {
        await flushAppendChain(pcm.appendChain);
        if (pcm.sawAudioDeltas) {
          try {
            await withTimeout(pcm.finishPlayback(), FINISH_PLAYBACK_TIMEOUT_MS, "native finish");
            dlog("rt", `native playback done (${Date.now() - startedAt}ms)`);
          } catch (e) {
            dwarn("rt", "native finish error/timeout — stopping stream", e);
            await stopStreamingPlayback();
          }
        }
      }

      closeSocket();

      settledOut = true;

      const decision = decideTurnAudio({
        textOnly,
        text,
        sawAudioDeltas: pcm?.sawAudioDeltas ?? false,
        pcmDelivered: pcm?.pcmDelivered ?? false,
      });

      void traceTurnAudio({
        turnId,
        event: "turn-complete",
        route: decision.route,
        sawAudioDeltas: decision.sawAudioDeltas,
        pcmDelivered: decision.pcmDelivered,
        allowTtsFallback: decision.allowTtsFallback,
        ms: Date.now() - startedAt,
        detail: decision.allowTtsFallback
          ? "TTS-eligible"
          : decision.sawAudioDeltas
            ? "native-only"
            : "text-only",
      });

      if (!text && !decision.sawAudioDeltas) {
        reject(new Error("Realtime returned no text."));
        return;
      }

      if (decision.sawAudioDeltas && !decision.pcmDelivered) {
        dwarn("rt", "audio deltas arrived but no PCM reached AVAudioEngine — no TTS (anti-double)");
      }

      resolve({
        text,
        route: decision.route,
        audioPlayed: decision.sawAudioDeltas || decision.pcmDelivered,
        requiresTtsFallback: decision.allowTtsFallback,
        allowTtsFallback: decision.allowTtsFallback,
        sawAudioDeltas: decision.sawAudioDeltas,
        pcmDelivered: decision.pcmDelivered,
        firstAudioMs,
        turnId,
      });
    };

    const maybeComplete = () => {
      if (!responseDone || settledOut) return;
      void complete();
    };

    socket.onopen = () => dlog("rt", "ws open");

    socket.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const type = String(payload.type ?? "");

      switch (type) {
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
                ...(textOnly
                  ? {}
                  : {
                      audio: {
                        input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
                        output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
                      },
                    }),
              },
            }),
          );
          return;
        case "session.updated":
          if (responseRequested) return;
          responseRequested = true;
          if (pcm) void pcm.prewarm();
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
              response: { modalities: textOnly ? ["text"] : ["text", "audio"] },
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
          if (textOnly || !pcm) return;
          if (typeof payload.delta === "string" && payload.delta.length > 0) {
            if (!pcm.sawAudioDeltas) {
              dlog("rt", `first audio delta (${Date.now() - startedAt}ms)`);
            }
            pcm.appendDelta(payload.delta);
          }
          return;
        case "response.audio.done":
        case "response.output_audio.done":
          dlog("rt", `audio stream done (${Date.now() - startedAt}ms)`);
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
          responseDone = true;
          dlog("rt", `response.done (${Date.now() - startedAt}ms)`);
          maybeComplete();
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

    socket.onerror = () => {
      fail(new Error("Realtime websocket error (check xAI credits and network)."));
    };
    socket.onclose = (ev) => {
      if (!responseDone && !settledOut) {
        const code = "code" in ev ? (ev as CloseEvent).code : 0;
        fail(new Error(`Realtime closed before completion (code ${code}).`));
      }
    };
  });
}

export async function abortRealtime(): Promise<void> {
  await stopStreamingPlayback();
}
