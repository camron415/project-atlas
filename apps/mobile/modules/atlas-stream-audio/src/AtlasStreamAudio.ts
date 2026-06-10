import { requireNativeModule } from "expo-modules-core";

export interface AtlasStreamAudioNative {
  prewarm(sampleRate: number): Promise<void>;
  startStreaming(sampleRate: number): Promise<void>;
  appendPcmBase64(base64: string): Promise<void>;
  finish(): Promise<void>;
  stop(): Promise<void>;
  shutdown(): Promise<void>;
  isAvailable(): boolean;
}

export interface StreamingPlayback {
  appendBase64Chunk: (base64Chunk: string) => Promise<void>;
  finish: () => Promise<void>;
  completion: Promise<void>;
  abort: () => void;
}

let nativeModule: AtlasStreamAudioNative | null = null;

try {
  nativeModule = requireNativeModule<AtlasStreamAudioNative>("AtlasStreamAudio");
} catch {
  nativeModule = null;
}

export function isNativeStreamAudioAvailable(): boolean {
  return nativeModule?.isAvailable?.() ?? false;
}

export async function startNativeStreamingPlayback(
  sampleRate = 24000,
  onFirstAudio?: () => void,
): Promise<StreamingPlayback> {
  if (!nativeModule) {
    throw new Error("AtlasStreamAudio native module is not available");
  }

  await nativeModule.startStreaming(sampleRate);

  let sawFirst = false;
  let aborted = false;
  let completionResolve!: () => void;
  const completion = new Promise<void>((resolve) => {
    completionResolve = resolve;
  });

  return {
    appendBase64Chunk: async (base64Chunk: string) => {
      if (aborted || !base64Chunk) return;
      if (!sawFirst) {
        sawFirst = true;
        onFirstAudio?.();
      }
      await nativeModule!.appendPcmBase64(base64Chunk);
    },
    finish: async () => {
      if (aborted) return;
      await nativeModule!.finish();
      completionResolve();
    },
    completion,
    abort: () => {
      aborted = true;
      void nativeModule!.stop();
      completionResolve();
    },
  };
}

export async function stopNativeStreaming(): Promise<void> {
  if (nativeModule) {
    await nativeModule.stop();
  }
}

/** Create the playback engine ahead of time (call while foreground). */
export async function prewarmNativeStreaming(sampleRate = 24000): Promise<void> {
  if (nativeModule?.prewarm) {
    await nativeModule.prewarm(sampleRate);
  }
}

/** Fully release the playback engine + audio session (call when session ends). */
export async function shutdownNativeStreaming(): Promise<void> {
  if (nativeModule?.shutdown) {
    await nativeModule.shutdown();
  }
}
