/**
 * Economy voice output — server TTS only (single MP3 play per turn).
 * Avoids per-turn Realtime speak (duplicate audio + double Realtime billing).
 */
import { fetchTtsAudio } from "./api";
import { playBase64Mp3, stopPlayback } from "./audio";
import { dlog, dwarn } from "./log";
import { stopStreamingPlayback } from "./stream-audio";

let speakGeneration = 0;

export interface SpeakEconomyOptions {
  voiceSession?: boolean;
  signal?: AbortSignal;
  onStart?: () => void;
}

export interface SpeakEconomyResult {
  spoken: boolean;
  error?: string;
}

export async function speakEconomyReply(
  text: string,
  options: SpeakEconomyOptions = {},
): Promise<SpeakEconomyResult> {
  const trimmed = text.trim();
  if (!trimmed) return { spoken: false, error: "empty text" };
  if (options.signal?.aborted) return { spoken: false, error: "aborted" };

  const gen = ++speakGeneration;

  await stopStreamingPlayback();
  await stopPlayback();

  if (options.signal?.aborted || gen !== speakGeneration) {
    return { spoken: false, error: "aborted" };
  }

  try {
    const tts = await fetchTtsAudio(trimmed);
    if (gen !== speakGeneration || options.signal?.aborted) {
      return { spoken: false, error: "superseded" };
    }
    if (!tts.audio) {
      return { spoken: false, error: tts.audioError ?? "no audio" };
    }

    dlog("economy", "speak via server TTS (single play)");
    await playBase64Mp3(tts.audio, options.onStart, {
      voiceSession: options.voiceSession,
    });

    if (gen !== speakGeneration) {
      return { spoken: true };
    }
    return { spoken: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    dwarn("economy", "TTS speak failed", error);
    return { spoken: false, error: msg };
  }
}

/** Cancel any in-flight economy speak (new turn started). */
export function cancelEconomySpeak(): void {
  speakGeneration += 1;
  void stopStreamingPlayback();
  void stopPlayback();
}
