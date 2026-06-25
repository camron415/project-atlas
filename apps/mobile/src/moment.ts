/**
 * Brief acknowledgment before slow work — bundled Rex clips when available,
 * TTS API fallback otherwise.
 */
import { Audio } from "expo-av";
import { fetchTtsAudio } from "./api";
import { playBase64Mp3, stopPlayback } from "./audio";
import { prepareForNativeStream } from "./speech";

const MOMENT_CLIPS: Array<{ phrase: string; source: number }> = [
  { phrase: "One moment, sir.", source: require("../assets/audio/moments/one-moment-sir.mp3") },
  { phrase: "Just a moment, sir.", source: require("../assets/audio/moments/just-a-moment-sir.mp3") },
  {
    phrase: "One moment while I look into that, sir.",
    source: require("../assets/audio/moments/one-moment-look-sir.mp3"),
  },
  { phrase: "Allow me a moment, sir.", source: require("../assets/audio/moments/allow-me-moment-sir.mp3") },
  {
    phrase: "One moment, sir. I shall check.",
    source: require("../assets/audio/moments/one-moment-check-sir.mp3"),
  },
];

const ANALYST_MOMENT = {
  phrase: "One moment while I consult the analyst, sir.",
  source: require("../assets/audio/moments/one-moment-analyst-sir.mp3"),
};

let momentSound: Audio.Sound | null = null;

async function playBundledMoment(source: number): Promise<boolean> {
  try {
    await stopPlayback();
    await prepareForNativeStream({ continuousVoice: true });
    if (momentSound) {
      try {
        await momentSound.unloadAsync();
      } catch {}
      momentSound = null;
    }
    const { sound } = await Audio.Sound.createAsync(
      source,
      { shouldPlay: true, volume: 1.0 },
    );
    momentSound = sound;
    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          void sound.unloadAsync().catch(() => {});
          if (momentSound === sound) momentSound = null;
          resolve();
        }
      });
    });
    return true;
  } catch {
    return false;
  }
}

export function speakMomentAnalyst(): Promise<void> {
  return (async () => {
    const played = await playBundledMoment(ANALYST_MOMENT.source);
    if (played) return;
    try {
      await stopPlayback();
      const tts = await fetchTtsAudio(ANALYST_MOMENT.phrase);
      if (tts.audio) {
        await playBase64Mp3(tts.audio, undefined, { voiceSession: true });
      }
    } catch {
      // Continue silently if hold phrase fails.
    }
  })();
}

export function speakMomentSir(): Promise<void> {
  const clip = MOMENT_CLIPS[Math.floor(Math.random() * MOMENT_CLIPS.length)];

  return (async () => {
    const played = await playBundledMoment(clip.source);
    if (played) return;

    try {
      await stopPlayback();
      const tts = await fetchTtsAudio(clip.phrase);
      if (tts.audio) {
        await playBase64Mp3(tts.audio, undefined, { voiceSession: true });
      }
    } catch {
      // Continue silently if hold phrase fails — processing still runs.
    }
  })();
}

export async function stopMomentSpeech(): Promise<void> {
  if (momentSound) {
    try {
      await momentSound.stopAsync();
      await momentSound.unloadAsync();
    } catch {}
    momentSound = null;
  }
  await stopPlayback();
}
