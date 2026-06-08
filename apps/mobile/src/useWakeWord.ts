/**
 * Foreground wake word (Feature C1) — scaffold only.
 * Porcupine RN SDK currently conflicts with Expo 54 New Architecture pods (RCT-Folly).
 * Re-enable when Picovoice ships compatible build — see docs/WAKE_WORD.md.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { dwarn } from "./log";

export const WAKE_WORD_REQUESTED = (process.env.EXPO_PUBLIC_WAKE_WORD ?? "0") === "1";

const PICOVOICE_KEY = process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY?.trim() ?? "";

/** Native Porcupine not linked in this build — UI + docs ready for a follow-up install. */
export function isWakeWordAvailable(): boolean {
  return false;
}

export function wakeWordLabel(): string {
  return "Hey Atlas (pending native link)";
}

export function useWakeWord(_enabled: boolean, _onWake: () => void): void {
  useEffect(() => {
    if (!WAKE_WORD_REQUESTED || Platform.OS !== "ios" || !PICOVOICE_KEY) return;
    dwarn(
      "wake",
      "EXPO_PUBLIC_WAKE_WORD is set but Porcupine is not linked in this build (see docs/WAKE_WORD.md)",
    );
  }, []);
}
