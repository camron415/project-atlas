import { requireNativeModule } from "expo-modules-core";

export interface PcmChunkEvent {
  base64: string;
  bytes: number;
}

type AtlasAudioCaptureEvents = {
  onPcmChunk: (event: PcmChunkEvent) => void;
};

type AtlasAudioCaptureNative = {
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  startBackgroundHold(): Promise<void>;
  stopBackgroundHold(): Promise<void>;
  releaseAudioSession(): Promise<void>;
  isAvailable(): boolean;
  addListener<EventName extends keyof AtlasAudioCaptureEvents>(
    eventName: EventName,
    listener: AtlasAudioCaptureEvents[EventName],
  ): { remove: () => void };
};

let nativeModule: AtlasAudioCaptureNative | null = null;

try {
  nativeModule = requireNativeModule<AtlasAudioCaptureNative>("AtlasAudioCapture");
} catch {
  nativeModule = null;
}

export function isNativeAudioCaptureAvailable(): boolean {
  return nativeModule?.isAvailable?.() ?? false;
}

export async function startNativeAudioCapture(
  onChunk: (event: PcmChunkEvent) => void,
): Promise<() => Promise<void>> {
  if (!nativeModule) {
    throw new Error("AtlasAudioCapture native module is not available");
  }

  const subscription = nativeModule.addListener("onPcmChunk", onChunk);
  await nativeModule.startCapture();

  return async () => {
    subscription.remove();
    await nativeModule!.stopCapture();
  };
}

export async function stopNativeAudioCapture(): Promise<void> {
  if (nativeModule) {
    await nativeModule.stopCapture();
  }
}

export async function startNativeBackgroundHold(): Promise<void> {
  if (!nativeModule) {
    throw new Error("AtlasAudioCapture native module is not available");
  }
  await nativeModule.startBackgroundHold();
}

export async function stopNativeBackgroundHold(): Promise<void> {
  if (nativeModule) {
    await nativeModule.stopBackgroundHold();
  }
}

/** Release playAndRecord so other apps (YouTube, etc.) can resume uninterrupted. */
export async function releaseNativeAudioSession(): Promise<void> {
  if (nativeModule?.releaseAudioSession) {
    await nativeModule.releaseAudioSession();
  }
}
