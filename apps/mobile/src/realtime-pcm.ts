/**
 * Serializes PCM delta appends and pre-warms AVAudioEngine before first audio arrives.
 */
import type { StreamingPcmPlayback } from "./stream-audio";
import { dlog, dwarn } from "./log";

export interface RealtimePcmHandle {
  readonly sawAudioDeltas: boolean;
  readonly pcmDelivered: boolean;
  readonly appendChain: Promise<void>;
  prewarm(): Promise<void>;
  appendDelta(base64Delta: string): void;
  finishPlayback(): Promise<void>;
}

export function createRealtimePcmHandle(
  startPlayer: (onFirstAudio?: () => void) => Promise<StreamingPcmPlayback>,
  onFirstAudio?: () => void,
): RealtimePcmHandle {
  let sawAudioDeltas = false;
  let pcmDelivered = false;
  let chain: Promise<void> = Promise.resolve();
  let playerPromise: Promise<StreamingPcmPlayback> | null = null;

  const ensurePlayer = (): Promise<StreamingPcmPlayback> => {
    if (!playerPromise) {
      playerPromise = startPlayer(onFirstAudio);
    }
    return playerPromise;
  };

  return {
    get sawAudioDeltas() {
      return sawAudioDeltas;
    },
    get pcmDelivered() {
      return pcmDelivered;
    },
    get appendChain() {
      return chain;
    },
    prewarm: async () => {
      try {
        await ensurePlayer();
        dlog("rt-pcm", "AVAudioEngine pre-warmed");
      } catch (e) {
        dwarn("rt-pcm", "prewarm failed", e);
      }
    },
    appendDelta: (base64Delta: string) => {
      if (!base64Delta) return;
      sawAudioDeltas = true;
      chain = chain.then(async () => {
        const player = await ensurePlayer();
        await player.appendBase64Chunk(base64Delta);
        pcmDelivered = true;
      });
    },
    finishPlayback: async () => {
      await chain;
      if (!playerPromise) return;
      const player = await playerPromise;
      await player.finish();
    },
  };
}
