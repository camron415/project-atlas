/**
 * Reliable fast-turn speech — Rex TTS via /tts + expo-av.
 *
 * Release builds proved native AVAudioEngine PCM unreliable (silent playback,
 * session conflicts after STT). Fast turns use realtime for TEXT only, then
 * always speak once through this module.
 */
import { fetchTtsAudio } from "./api";
import { playBase64Mp3, stopPlayback } from "./audio";
import { dlog, dwarn } from "./log";
import { stopStreamingPlayback } from "./stream-audio";
import { resetAudioForPlayback } from "./speech";
import { traceTurnAudio } from "./turn-audio-trace";

export type SpeakOutcome = "spoken" | "no-audio" | "tts-error" | "aborted";

export async function speakAtlasReply(
  text: string,
  turnId: string,
  signal?: AbortSignal,
): Promise<SpeakOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return "no-audio";
  if (signal?.aborted) return "aborted";

  try {
    await stopStreamingPlayback();
    await stopPlayback();
    await resetAudioForPlayback();

    dlog("speak", `fetching TTS turnId=${turnId} chars=${trimmed.length}`);
    const tts = await fetchTtsAudio(trimmed);
    if (signal?.aborted) return "aborted";

    if (!tts.audio) {
      const err = tts.audioError ?? "empty audio";
      dwarn("speak", `TTS returned no audio: ${err}`);
      void traceTurnAudio({ turnId, event: "tts-empty", detail: err });
      return "tts-error";
    }

    void traceTurnAudio({ turnId, event: "tts-play-start", detail: `${tts.audio.length}b64` });
    await playBase64Mp3(tts.audio);
    void traceTurnAudio({ turnId, event: "tts-play-done" });
    dlog("speak", `TTS done turnId=${turnId}`);
    return "spoken";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dwarn("speak", `TTS failed turnId=${turnId}:`, msg);
    void traceTurnAudio({ turnId, event: "tts-fail", detail: msg });
    return "tts-error";
  }
}
