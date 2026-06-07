// Streaming + buffered PCM16 playback for xAI realtime audio.
//
// Streaming uses a preload pipeline: while segment N plays, segment N+1 is
// decoded/written/loaded in parallel so expo-av gaps stay minimal. We never
// wait for the full response — only a small first chunk (~0.3s) before start.
import { Audio } from "expo-av";
import { File, Paths } from "expo-file-system";
import { resetAudioForPlayback } from "./speech";
import { dlog, dwarn } from "./log";

/** First chunk — start playback quickly after deltas begin arriving. */
const FIRST_SEGMENT_SECONDS = 0.3;
/** Later chunks — larger = fewer seams; preload hides load time between them. */
const REST_SEGMENT_SECONDS = 0.9;
/** How many segments to prepare ahead while one is playing. */
const PRELOAD_AHEAD = 2;

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
    if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) throw new Error("Invalid base64 audio");
    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (byteIndex < outputLength) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < outputLength) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < outputLength) bytes[byteIndex++] = triple & 0xff;
  }
  return bytes;
}

function createWavFromPcm16(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const header = 44;
  const wav = new Uint8Array(header + pcmBytes.length);
  const view = new DataView(wav.buffer);
  const write = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) wav[o + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, header);
  return wav;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

interface PreparedClip {
  sound: Audio.Sound;
  dispose: () => void;
}

// --- shared playback state ---
let activeSound: Audio.Sound | null = null;
let activeFile: File | null = null;
let abortCurrentStream: (() => void) | null = null;

function cleanupActiveFile(): void {
  if (activeFile) {
    try {
      activeFile.delete();
    } catch {}
    activeFile = null;
  }
}

/** Stop and tear down any playback in progress (streaming or buffered). */
export async function stopStreamingPlayback(): Promise<void> {
  if (abortCurrentStream) {
    dlog("audio", "stopStreamingPlayback -> aborting stream");
    abortCurrentStream();
    abortCurrentStream = null;
  }
  if (activeSound) {
    try {
      await activeSound.stopAsync();
      await activeSound.unloadAsync();
    } catch {}
    activeSound = null;
  }
  cleanupActiveFile();
}

async function prepareClip(
  pcmSegment: Uint8Array,
  sampleRate: number,
  index: number,
): Promise<PreparedClip> {
  const wav = createWavFromPcm16(pcmSegment, sampleRate);
  const file = new File(Paths.cache, `atlas_seg_${Date.now()}_${index}.wav`);
  file.create({ overwrite: true });
  file.write(wav);
  const { sound } = await Audio.Sound.createAsync(
    { uri: file.uri },
    { shouldPlay: false, volume: 1.0 },
  );
  return {
    sound,
    dispose: () => {
      sound.unloadAsync().catch(() => {});
      try {
        file.delete();
      } catch {}
    },
  };
}

function playClip(clip: PreparedClip, onStart?: () => void): Promise<void> {
  activeSound = clip.sound;
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clip.dispose();
      if (activeSound === clip.sound) activeSound = null;
      resolve();
    };
    clip.sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) done();
      if (!status.isLoaded && status.error) done();
    });
    onStart?.();
    clip.sound.playAsync().catch(() => done());
  });
}

export interface StreamingPcmPlayback {
  appendBase64Chunk: (base64Chunk: string) => void;
  finish: () => Promise<void>;
  completion: Promise<void>;
  abort: () => void;
}

/**
 * Stream PCM16 with preload-ahead: segment N+1 is loaded while N plays so gaps
 * between expo-av clips stay near-zero without buffering the full response.
 */
export async function startStreamingPcmPlayback(
  sampleRate = 24000,
  onFirstAudio?: () => void,
): Promise<StreamingPcmPlayback> {
  await stopStreamingPlayback();
  await resetAudioForPlayback();

  const firstSegmentBytes = Math.max(
    4096,
    Math.floor(sampleRate * 2 * FIRST_SEGMENT_SECONDS),
  );
  const restSegmentBytes = Math.max(
    8192,
    Math.floor(sampleRate * 2 * REST_SEGMENT_SECONDS),
  );

  let buffered: Uint8Array = new Uint8Array(0);
  const pcmQueue: Uint8Array[] = [];
  let finished = false;
  let aborted = false;
  let started = false;
  let segmentIndex = 0;
  let segmentsPlayed = 0;
  let wake: (() => void) | null = null;

  // Preload pipeline: promises for clips being prepared ahead of playback.
  const preloadPromises: Promise<PreparedClip | null>[] = [];

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const signal = () => {
    wake?.();
    wake = null;
  };

  const waitForData = () => new Promise<void>((r) => (wake = r));

  const segmentByteSize = () =>
    segmentsPlayed === 0 ? firstSegmentBytes : restSegmentBytes;

  const sliceSegmentsFromBuffer = () => {
    const size = segmentByteSize();
    while (buffered.length >= size) {
      pcmQueue.push(buffered.slice(0, size));
      buffered = buffered.slice(size);
    }
  };

  const ensurePreload = () => {
    while (
      !aborted &&
      preloadPromises.length < PRELOAD_AHEAD &&
      preloadPromises.length < pcmQueue.length
    ) {
      const queueIdx = preloadPromises.length;
      const pcm = pcmQueue[queueIdx];
      if (!pcm) break;
      const idx = segmentIndex + queueIdx;
      preloadPromises.push(
        prepareClip(pcm, sampleRate, idx).catch((e) => {
          dwarn("audio", "preload failed", e);
          return null;
        }),
      );
    }
  };

  const takeNextClip = async (): Promise<PreparedClip | null> => {
    if (pcmQueue.length === 0) return null;

    let clip: PreparedClip | null;
    if (preloadPromises.length > 0) {
      clip = await preloadPromises.shift()!;
      // Drop the pcm entry that was preloaded (always queue head).
      pcmQueue.shift();
    } else {
      const pcm = pcmQueue.shift()!;
      clip = await prepareClip(pcm, sampleRate, segmentIndex).catch((e) => {
        dwarn("audio", "prepare failed", e);
        return null;
      });
    }

    segmentIndex++;
    ensurePreload();
    return clip;
  };

  const drain = async () => {
    try {
      while (!aborted) {
        sliceSegmentsFromBuffer();
        ensurePreload();

        if (pcmQueue.length === 0) {
          if (finished) {
            if (buffered.length > 0) {
              pcmQueue.push(buffered);
              buffered = new Uint8Array(0);
              ensurePreload();
              continue;
            }
            break;
          }
          await waitForData();
          continue;
        }

        const clip = await takeNextClip();
        if (!clip) continue;

        await playClip(clip, () => {
          if (!started) {
            started = true;
            dlog("audio", "first segment playing (preload pipeline)");
            onFirstAudio?.();
          }
        });
        segmentsPlayed++;
        ensurePreload();
      }
    } finally {
      abortCurrentStream = null;
      resolveCompletion();
    }
  };

  abortCurrentStream = () => {
    aborted = true;
    pcmQueue.length = 0;
    preloadPromises.length = 0;
    buffered = new Uint8Array(0);
    signal();
  };

  void drain();

  return {
    appendBase64Chunk: (base64Chunk: string) => {
      if (aborted || !base64Chunk) return;
      try {
        buffered = concatBytes(buffered, decodeBase64ToBytes(base64Chunk));
      } catch (e) {
        dwarn("audio", "bad chunk", e);
        return;
      }
      sliceSegmentsFromBuffer();
      ensurePreload();
      signal();
    },
    finish: async () => {
      finished = true;
      signal();
      await completion;
    },
    completion,
    abort: () => abortCurrentStream?.(),
  };
}

/** Buffered fallback: one WAV for the entire payload (smooth, higher latency). */
export async function playPcmBase64(
  audioDataBase64: string,
  sampleRate = 24000,
): Promise<void> {
  if (!audioDataBase64.trim()) return;

  await stopStreamingPlayback();
  await resetAudioForPlayback();

  const pcmBytes = decodeBase64ToBytes(audioDataBase64);
  if (pcmBytes.length === 0) return;

  const clip = await prepareClip(pcmBytes, sampleRate, 0);
  await playClip(clip);
}
