/**
 * Jarvis-style brief acknowledgment before slow work — uses xAI Rex TTS (same
 * voice as Atlas replies) instead of the iOS built-in speech engine.
 */
import { fetchTtsAudio } from "./api";
import { playBase64Mp3, stopPlayback } from "./audio";

const MOMENT_PHRASES = [
  "One moment, sir.",
  "Just a moment, sir.",
  "One moment while I look into that, sir.",
  "Allow me a moment, sir.",
  "One moment, sir. I shall check.",
];

export function speakMomentSir(): Promise<void> {
  const phrase = MOMENT_PHRASES[Math.floor(Math.random() * MOMENT_PHRASES.length)];

  return (async () => {
    try {
      await stopPlayback();
      const tts = await fetchTtsAudio(phrase);
      if (tts.audio) {
        await playBase64Mp3(tts.audio);
      }
    } catch {
      // Continue silently if TTS fails — processing still runs.
    }
  })();
}

export async function stopMomentSpeech(): Promise<void> {
  await stopPlayback();
}
