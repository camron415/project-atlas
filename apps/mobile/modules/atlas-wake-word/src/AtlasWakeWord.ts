import { requireNativeModule } from "expo-modules-core";

export type WakeKeyword = "jarvis" | "porcupine" | "computer" | "custom";

type AtlasWakeWordNative = {
  start(accessKey: string, keyword: string, customPath: string | null): Promise<void>;
  stop(): Promise<void>;
  isAvailable(): boolean;
  addListener<EventName extends "onWake">(
    eventName: EventName,
    listener: (event: { keywordIndex: number }) => void,
  ): { remove: () => void };
};

let nativeModule: AtlasWakeWordNative | null = null;

try {
  nativeModule = requireNativeModule<AtlasWakeWordNative>("AtlasWakeWord");
} catch {
  nativeModule = null;
}

export function isNativeWakeWordAvailable(): boolean {
  return nativeModule?.isAvailable?.() ?? false;
}

export async function startNativeWakeWord(
  accessKey: string,
  keyword: WakeKeyword,
  onWake: () => void,
  customPath?: string | null,
): Promise<() => Promise<void>> {
  if (!nativeModule) {
    throw new Error("AtlasWakeWord native module is not available");
  }

  const subscription = nativeModule.addListener("onWake", () => onWake());
  await nativeModule.start(accessKey, keyword, customPath ?? null);

  return async () => {
    subscription.remove();
    await nativeModule!.stop();
  };
}

export async function stopNativeWakeWord(): Promise<void> {
  if (nativeModule) {
    await nativeModule.stop();
  }
}
