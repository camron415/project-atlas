// Playback for the base64 MP3 that the Atlas server returns from /tts.
import { Audio } from "expo-av";
import { File, Paths } from "expo-file-system";
import { reapplyNativeVoiceRoute, stopNativeBackgroundHold } from "atlas-audio-capture";
import { prepareAudiblePlayback, prepareForNativeStream } from "./speech";

let currentSound: Audio.Sound | null = null;
let currentFile: File | null = null;

const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charCodeAt(i)] = i;
  }
  table["=".charCodeAt(0)] = 0;
  return table;
})();

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, "");
  if (!normalized) return new Uint8Array(0);

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const outputLength = Math.floor((normalized.length * 3) / 4) - padding;
  const bytes = new Uint8Array(outputLength);

  let byteIndex = 0;
  for (let i = 0; i < normalized.length; i += 4) {
    const c1 = BASE64_LOOKUP[normalized.charCodeAt(i)];
    const c2 = BASE64_LOOKUP[normalized.charCodeAt(i + 1)];
    const c3 = BASE64_LOOKUP[normalized.charCodeAt(i + 2)];
    const c4 = BASE64_LOOKUP[normalized.charCodeAt(i + 3)];

    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) {
      throw new Error("Invalid base64 audio payload");
    }

    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (byteIndex < outputLength) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < outputLength) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < outputLength) bytes[byteIndex++] = triple & 0xff;
  }

  return bytes;
}

function cleanupFile(): void {
  if (currentFile) {
    try {
      currentFile.delete();
    } catch {}
    currentFile = null;
  }
}

export async function stopPlayback(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {}
    currentSound = null;
  }
  cleanupFile();
}

export interface PlayMp3Options {
  /** Keep playAndRecord + speaker during an active voice session (economy TTS). */
  voiceSession?: boolean;
}

export async function playBase64Mp3(
  base64: string,
  onStart?: () => void,
  options?: PlayMp3Options,
): Promise<void> {
  await stopPlayback();
  if (options?.voiceSession) {
    // Stay on playAndRecord — flipping to playback ducks volume and hops system slider.
    await prepareForNativeStream({ continuousVoice: true });
    await reapplyNativeVoiceRoute().catch(() => {});
  } else {
    // Release native playAndRecord hold before expo-av playback — otherwise silent TTS.
    await stopNativeBackgroundHold().catch(() => {});
    await prepareAudiblePlayback();
  }

  const bytes = decodeBase64ToBytes(base64);
  const file = new File(Paths.cache, `atlas_${Date.now()}.mp3`);
  file.create({ overwrite: true });
  file.write(bytes);
  currentFile = file;

  const { sound } = await Audio.Sound.createAsync(
    { uri: file.uri },
    { shouldPlay: false, volume: 1.0, isMuted: false },
  );
  currentSound = sound;

  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      sound.unloadAsync().catch(() => {});
      if (currentSound === sound) currentSound = null;
      cleanupFile();
      resolve();
    };

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) done();
      if (!status.isLoaded && status.error) done();
    });

    onStart?.();
    sound.playAsync().catch(() => done());
  });
}
