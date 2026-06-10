/**
 * Wake word — Porcupine-iOS when a Picovoice key is baked in, otherwise Apple
 * phrase detection ("Hey Atlas") with no third-party account required.
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  isNativeWakeWordAvailable,
  startNativeWakeWord,
  stopNativeWakeWord,
  type WakeKeyword,
} from "atlas-wake-word";
import {
  activateBackgroundWakeAudio,
  deactivateBackgroundWakeAudio,
} from "./background-audio";
import { dlog, dwarn } from "./log";
import { softStopRecognition, startListening } from "./speech";
import { matchesWakePhrase } from "./wake-phrases";
import { registerWakePauseHandler } from "./voice-gates";

export const WAKE_WORD_REQUESTED = (process.env.EXPO_PUBLIC_WAKE_WORD ?? "0") === "1";

const PICOVOICE_KEY = process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY?.trim() ?? "";
const CUSTOM_KEYWORD_PATH = process.env.EXPO_PUBLIC_WAKE_KEYWORD_PATH?.trim() ?? "";
const USE_JARVIS_FALLBACK = (process.env.EXPO_PUBLIC_WAKE_USE_JARVIS ?? "1") === "1";
const PHRASE_WAKE_ENABLED = (process.env.EXPO_PUBLIC_WAKE_PHRASE ?? "1") === "1";

export type WakeBackend = "porcupine" | "phrase" | "none";

export function isPorcupineWakeAvailable(): boolean {
  return (
    WAKE_WORD_REQUESTED &&
    Platform.OS === "ios" &&
    PICOVOICE_KEY.length > 0 &&
    isNativeWakeWordAvailable()
  );
}

export function isPhraseWakeAvailable(): boolean {
  return WAKE_WORD_REQUESTED && Platform.OS === "ios" && PHRASE_WAKE_ENABLED;
}

export function wakeWordBackend(): WakeBackend {
  if (isPorcupineWakeAvailable()) return "porcupine";
  if (isPhraseWakeAvailable()) return "phrase";
  return "none";
}

export function isWakeWordAvailable(): boolean {
  return wakeWordBackend() !== "none";
}

export function wakeWordLabel(): string {
  if (wakeWordBackend() === "phrase") return 'Hey Atlas (say "Hey Atlas")';
  if (CUSTOM_KEYWORD_PATH) return "Hey Atlas";
  if (USE_JARVIS_FALLBACK) return 'Jarvis (say "Jarvis")';
  return "porcupine (test)";
}

function resolveKeyword(): { keyword: WakeKeyword; customPath?: string } {
  if (CUSTOM_KEYWORD_PATH) {
    return { keyword: "custom", customPath: CUSTOM_KEYWORD_PATH };
  }
  if (USE_JARVIS_FALLBACK) {
    return { keyword: "jarvis" };
  }
  return { keyword: "porcupine" };
}

type SpeechResultEvent = {
  isFinal: boolean;
  results?: { transcript?: string }[];
};

type SpeechErrorEvent = { error?: string };

export function useWakeWord(enabled: boolean, onWake: () => void) {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const phraseActiveRef = useRef(false);
  const phraseStartInFlightRef = useRef(false);
  const lastWakeRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const stopPhraseWake = useCallback(async () => {
    phraseActiveRef.current = false;
    clearRestartTimer();
    softStopRecognition();
    await deactivateBackgroundWakeAudio();
  }, []);

  useEffect(() => {
    registerWakePauseHandler(stopPhraseWake);
    return () => {
      registerWakePauseHandler(null);
    };
  }, [stopPhraseWake]);

  const startPhraseWake = useCallback(async () => {
    if (phraseStartInFlightRef.current || phraseActiveRef.current) return;
    if (wakeWordBackend() !== "phrase" || !enabledRef.current) return;

    phraseStartInFlightRef.current = true;
    try {
      await activateBackgroundWakeAudio();
      await startListening({ continuous: true });
      phraseActiveRef.current = true;
      dlog("wake", "phrase listening (Hey Atlas)");
    } catch (error) {
      phraseActiveRef.current = false;
      dwarn("wake", "phrase wake failed to start", error);
      await deactivateBackgroundWakeAudio();
    } finally {
      phraseStartInFlightRef.current = false;
    }
  }, []);

  const schedulePhraseRestart = useCallback(() => {
    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      if (enabledRef.current && wakeWordBackend() === "phrase" && !phraseActiveRef.current) {
        void startPhraseWake();
      }
    }, 450);
  }, [startPhraseWake]);

  const handleSpeechResult = useCallback((event: SpeechResultEvent): boolean => {
    if (wakeWordBackend() !== "phrase" || !phraseActiveRef.current) return false;

    const text = event.results?.[0]?.transcript ?? "";
    if (!matchesWakePhrase(text)) return false;

    const now = Date.now();
    if (now - lastWakeRef.current < 2500) return true;
    lastWakeRef.current = now;

    phraseActiveRef.current = false;
    clearRestartTimer();
    softStopRecognition();
    dlog("wake", "phrase detected:", text.trim());
    onWakeRef.current();
    return true;
  }, [clearRestartTimer]);

  const handleSpeechEnd = useCallback((): boolean => {
    if (wakeWordBackend() !== "phrase" || !enabledRef.current) return false;
    if (phraseActiveRef.current) {
      phraseActiveRef.current = false;
    }
    schedulePhraseRestart();
    return true;
  }, [schedulePhraseRestart]);

  const handleSpeechError = useCallback((event: SpeechErrorEvent): boolean => {
    if (wakeWordBackend() !== "phrase" || !enabledRef.current) return false;

    const code = String(event.error ?? "unknown");
    if (code === "aborted" || code === "cancelled" || code === "interrupted") {
      return true;
    }

    phraseActiveRef.current = false;
    schedulePhraseRestart();
    return true;
  }, [schedulePhraseRestart]);

  useEffect(() => {
    if (!enabled || wakeWordBackend() !== "porcupine") {
      void deactivateBackgroundWakeAudio();
      if (stopRef.current) {
        const stop = stopRef.current;
        stopRef.current = null;
        void stop();
      } else {
        void stopNativeWakeWord();
      }
      return;
    }

    let cancelled = false;
    const { keyword, customPath } = resolveKeyword();

    const start = async () => {
      try {
        await activateBackgroundWakeAudio();
        const stop = await startNativeWakeWord(
          PICOVOICE_KEY,
          keyword,
          () => {
            dlog("wake", "keyword detected");
            onWakeRef.current();
          },
          customPath ?? null,
        );
        if (cancelled) {
          await stop();
          return;
        }
        stopRef.current = stop;
        dlog("wake", `listening (${wakeWordLabel()})`);
      } catch (error) {
        dwarn("wake", "native wake failed to start", error);
        await deactivateBackgroundWakeAudio();
      }
    };

    void start();

    const onAppState = (state: AppStateStatus) => {
      if (cancelled || !enabled) return;
      if (state === "active" && !stopRef.current) {
        void start();
      }
    };

    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      cancelled = true;
      sub.remove();
      if (stopRef.current) {
        const stop = stopRef.current;
        stopRef.current = null;
        void stop();
      } else {
        void stopNativeWakeWord();
      }
      void deactivateBackgroundWakeAudio();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || wakeWordBackend() !== "phrase") {
      void stopPhraseWake();
      return;
    }

    void startPhraseWake();

    const onAppState = (state: AppStateStatus) => {
      if (!enabledRef.current || wakeWordBackend() !== "phrase") return;
      if (state === "active" && !phraseActiveRef.current) {
        void startPhraseWake();
      }
    };

    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      sub.remove();
      void stopPhraseWake();
    };
  }, [enabled, startPhraseWake, stopPhraseWake]);

  return { handleSpeechResult, handleSpeechEnd, handleSpeechError };
}
