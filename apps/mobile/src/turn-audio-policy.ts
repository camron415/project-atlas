/**
 * Single source of truth for fast-turn spoken output.
 * AVAudioEngine (realtime PCM) is the only path when the API sends audio deltas.
 * Rex TTS is allowed ONLY when the API sent zero audio deltas (native never had a chance).
 */

export type TurnAudioRoute = "native-stream" | "tts-fallback" | "text-only";

export interface TurnAudioDecision {
  route: TurnAudioRoute;
  /** True when realtime API emitted at least one audio delta. */
  sawAudioDeltas: boolean;
  /** True when a PCM chunk was appended to AVAudioEngine. */
  pcmDelivered: boolean;
  /** Caller may invoke Rex TTS — mutually exclusive with native playback. */
  allowTtsFallback: boolean;
}

export interface TurnAudioPolicyInput {
  textOnly: boolean;
  text: string;
  sawAudioDeltas: boolean;
  pcmDelivered: boolean;
}

/**
 * Hard rule: if the API sent audio deltas, NEVER allow TTS (prevents double playback).
 */
export function decideTurnAudio(input: TurnAudioPolicyInput): TurnAudioDecision {
  const hasText = !!input.text.trim();

  if (input.textOnly || !hasText) {
    return {
      route: "text-only",
      sawAudioDeltas: input.sawAudioDeltas,
      pcmDelivered: input.pcmDelivered,
      allowTtsFallback: false,
    };
  }

  if (input.sawAudioDeltas) {
    return {
      route: "native-stream",
      sawAudioDeltas: true,
      pcmDelivered: input.pcmDelivered,
      allowTtsFallback: false,
    };
  }

  return {
    route: "tts-fallback",
    sawAudioDeltas: false,
    pcmDelivered: false,
    allowTtsFallback: true,
  };
}

/** Append-chain race: complete() must await this before calling decideTurnAudio. */
export async function flushAppendChain(chain: Promise<void>): Promise<void> {
  await chain;
}
