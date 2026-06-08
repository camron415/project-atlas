/**
 * Foreground wake word (Feature C1). Requires Picovoice AccessKey + native rebuild.
 * Uses built-in "porcupine" keyword until hey-atlas_ios.ppn is bundled — see docs/WAKE_WORD.md.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { dlog, dwarn } from "./log";

export const WAKE_WORD_REQUESTED = (process.env.EXPO_PUBLIC_WAKE_WORD ?? "0") === "1";

const PICOVOICE_KEY = process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY?.trim() ?? "";

export function isWakeWordAvailable(): boolean {
  return WAKE_WORD_REQUESTED && Platform.OS === "ios" && PICOVOICE_KEY.length > 0;
}

export function wakeWordLabel(): string {
  const custom = process.env.EXPO_PUBLIC_WAKE_KEYWORD_PATH?.trim();
  return custom ? "Hey Atlas" : "porcupine (test)";
}

type PorcupineManagerLike = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function useWakeWord(enabled: boolean, onWake: () => void): void {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const managerRef = useRef<PorcupineManagerLike | null>(null);

  useEffect(() => {
    if (!enabled || !isWakeWordAvailable()) return;

    let cancelled = false;

    const start = async () => {
      try {
        const { PorcupineManager, BuiltInKeywords } = await import(
          "@picovoice/porcupine-react-native"
        );

        const customPath = process.env.EXPO_PUBLIC_WAKE_KEYWORD_PATH?.trim();
        let manager: PorcupineManagerLike;

        if (customPath) {
          manager = await PorcupineManager.fromKeywordPaths(
            PICOVOICE_KEY,
            [customPath],
            () => {
              dlog("wake", "keyword detected (custom)");
              onWakeRef.current();
            },
          );
        } else {
          manager = await PorcupineManager.fromBuiltInKeywords(
            PICOVOICE_KEY,
            [BuiltInKeywords.PORCUPINE],
            () => {
              dlog("wake", "keyword detected (built-in test)");
              onWakeRef.current();
            },
          );
        }

        if (cancelled) {
          await manager.stop();
          return;
        }

        managerRef.current = manager;
        await manager.start();
        dlog("wake", "Porcupine listening");
      } catch (error) {
        dwarn("wake", "Porcupine failed to start", error);
      }
    };

    void start();

    return () => {
      cancelled = true;
      const manager = managerRef.current;
      managerRef.current = null;
      if (manager) {
        void manager.stop().catch(() => {});
      }
    };
  }, [enabled]);
}
