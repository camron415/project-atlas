/**
 * Per-turn Realtime speak (VocalLearn pattern): text in, Rex PCM out, close WS each reply.
 * Used by voice economy when plan-turn returns text; TTS MP3 is the fallback.
 */
import {
  fetchRealtimeClientSecret,
  rewriteProxyWsUrl,
  type RealtimeClientSecret,
} from "./api";
import { resolveAtlasServerUrl } from "./config";
import { createRealtimePcmHandle } from "./realtime-pcm";
import { startStreamingPcmPlayback, stopStreamingPlayback } from "./stream-audio";
import { flushAppendChain } from "./turn-audio-policy";
import { dlog, dwarn } from "./log";

const REALTIME_MODEL = "grok-voice-think-fast-1.0";
const SAMPLE_RATE = 24000;
const SPEAK_TIMEOUT_MS = 45_000;
const FINISH_PLAYBACK_TIMEOUT_MS = 120_000;

const SPEAK_INSTRUCTIONS = `You are a verbatim text-to-speech reader for Atlas.
Speak ONLY the exact text provided — word for word, same order, nothing added or removed.
Do not improvise, answer questions, continue the conversation, or add commentary.`;

export interface PerTurnSpeakOptions {
  voice?: string;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  onFirstAudio?: () => void;
  onAudioStreamDone?: () => void;
  prefetchedClientSecret?: RealtimeClientSecret;
}

export interface PerTurnSpeakResult {
  spoken: boolean;
  pcmDelivered: boolean;
  sawAudioDeltas: boolean;
  text?: string;
  error?: string;
}

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

export async function speakPerTurnRealtime(
  text: string,
  options: PerTurnSpeakOptions = {},
): Promise<PerTurnSpeakResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { spoken: false, pcmDelivered: false, sawAudioDeltas: false, error: "empty text" };
  }
  if (options.signal?.aborted) {
    return { spoken: false, pcmDelivered: false, sawAudioDeltas: false, error: "aborted" };
  }

  try {
    const base = await resolveAtlasServerUrl();
    const secret =
      options.prefetchedClientSecret ?? (await fetchRealtimeClientSecret());
    const wsUrl = secret.proxyWsUrl
      ? rewriteProxyWsUrl(base, secret.proxyWsUrl)
      : secret.wsUrl;

    const voice = options.voice ?? "rex";
    const startedAt = Date.now();

    let firstAudioNotified = false;
    const notifyFirstAudio = () => {
      if (firstAudioNotified) return;
      firstAudioNotified = true;
      options.onFirstAudio?.();
    };

    let audioStreamDoneNotified = false;
    const notifyAudioStreamDone = () => {
      if (audioStreamDoneNotified) return;
      audioStreamDoneNotified = true;
      options.onAudioStreamDone?.();
    };

    let heardAnyAudio = false;

    const pcm = createRealtimePcmHandle(
      (onFirst) =>
        startStreamingPcmPlayback(SAMPLE_RATE, () => {
          heardAnyAudio = true;
          onFirst?.();
          notifyFirstAudio();
        }),
      () => {
        heardAnyAudio = true;
        notifyFirstAudio();
      },
    );

    const result = await new Promise<PerTurnSpeakResult>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, [`xai-client-secret.${secret.value}`]);
      let configured = false;
      let responseRequested = false;
      let responseDone = false;
      let settled = false;
      let finishing = false;
      let audioOutputComplete = false;
      let activeResponseId: string | null = null;
      let finalText = "";
      let sawTextDelta = false;

      const timeout = setTimeout(() => fail(new Error("Per-turn realtime speak timed out")), SPEAK_TIMEOUT_MS);

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
        if (settled || finishing) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        if (heardAnyAudio || pcm.sawAudioDeltas || pcm.pcmDelivered) {
          closeSocket();
          resolve({
            spoken: true,
            pcmDelivered: pcm.pcmDelivered,
            sawAudioDeltas: pcm.sawAudioDeltas || heardAnyAudio,
          });
          return;
        }
        void stopStreamingPlayback();
        closeSocket();
        reject(error);
      };

      const onAbort = () => fail(new DOMException("Aborted", "AbortError"));
      options.signal?.addEventListener("abort", onAbort);

      const finish = async () => {
        if (settled || finishing) return;
        finishing = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);

        notifyAudioStreamDone();

        if (pcm.sawAudioDeltas) {
          await flushAppendChain(pcm.appendChain);
          try {
            await withTimeout(
              pcm.finishPlayback(),
              FINISH_PLAYBACK_TIMEOUT_MS,
              "pcm finish",
            );
          } catch (e) {
            dwarn("economy-speak", "pcm finish error", e);
            await stopStreamingPlayback();
          }
        }

        closeSocket();
        settled = true;
        const spokenText = finalText.trim() || trimmed;
        const heard = pcm.sawAudioDeltas || pcm.pcmDelivered;
        dlog("economy-speak", `done (${Date.now() - startedAt}ms) pcm=${pcm.pcmDelivered} heard=${heard}`);
        resolve({
          spoken: heard,
          pcmDelivered: pcm.pcmDelivered,
          sawAudioDeltas: pcm.sawAudioDeltas,
          text: spokenText,
        });
      };

      socket.onopen = () => dlog("economy-speak", "ws open");

      socket.onmessage = (event) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }

        switch (String(payload.type ?? "")) {
          case "session.created":
          case "conversation.created":
            if (configured) return;
            configured = true;
            socket.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  model: REALTIME_MODEL,
                  instructions: SPEAK_INSTRUCTIONS,
                  voice,
                  turn_detection: { type: null },
                  audio: {
                    output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
                  },
                },
              }),
            );
            return;
          case "session.updated":
            if (responseRequested) return;
            responseRequested = true;
            void pcm.prewarm();
            socket.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: `Speak this text verbatim — no changes:\n\n${trimmed}`,
                    },
                  ],
                },
              }),
            );
            socket.send(
              JSON.stringify({
                type: "response.create",
                response: { modalities: ["audio"], max_output_tokens: 500 },
              }),
            );
            return;
          case "response.created": {
            const rid = (payload.response as Record<string, unknown> | undefined)?.id;
            if (typeof rid === "string") {
              if (activeResponseId && activeResponseId !== rid) {
                socket.send(JSON.stringify({ type: "response.cancel", response_id: rid }));
                return;
              }
              activeResponseId = rid;
            }
            return;
          }
          case "response.text.delta":
            if (typeof payload.delta === "string") {
              sawTextDelta = true;
              finalText += payload.delta;
              options.onTextDelta?.(finalText);
            }
            return;
          case "response.output_audio_transcript.delta":
            if (typeof payload.delta === "string" && !sawTextDelta) {
              finalText += payload.delta;
              options.onTextDelta?.(finalText);
            }
            return;
          case "response.output_audio_transcript.done":
            if (typeof payload.transcript === "string" && !finalText.trim()) {
              finalText = payload.transcript;
              options.onTextDelta?.(finalText);
            }
            return;
          case "response.audio.delta":
          case "response.output_audio.delta":
            if (audioOutputComplete) return;
            if (typeof payload.delta === "string" && payload.delta.length > 0) {
              heardAnyAudio = true;
              if (!pcm.sawAudioDeltas) {
                notifyFirstAudio();
              }
              pcm.appendDelta(payload.delta);
            }
            return;
          case "response.audio.done":
          case "response.output_audio.done":
            if (!audioOutputComplete) {
              audioOutputComplete = true;
              notifyAudioStreamDone();
            }
            return;
          case "response.done":
            if (responseDone) return;
            responseDone = true;
            void finish();
            return;
          case "error":
            fail(
              new Error(
                `Realtime speak error: ${(payload.error as Record<string, unknown>)?.message ?? "unknown"}`,
              ),
            );
            return;
          default:
            return;
        }
      };

      socket.onerror = () => fail(new Error("Realtime speak websocket error"));
      socket.onclose = () => {
        if (settled || finishing) return;
        // WS often closes before response.done even though PCM already played — don't TTS-fallback.
        if (pcm.sawAudioDeltas || pcm.pcmDelivered) {
          responseDone = true;
          void finish();
          return;
        }
        if (!responseDone) {
          fail(new Error("Realtime speak closed before response.done"));
        }
      };
    });

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    dwarn("economy-speak", "per-turn realtime failed:", msg);
    return { spoken: false, pcmDelivered: false, sawAudioDeltas: false, error: msg };
  }
}

/** True when economy speak already delivered audio — blocks TTS double-play. */
export function economySpeakAlreadyHeard(result: PerTurnSpeakResult): boolean {
  return result.spoken || result.pcmDelivered || result.sawAudioDeltas;
}
