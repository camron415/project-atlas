// On-device speech-to-text — toggle mic stays open until user taps again.
import { Audio } from "expo-av";
import { Platform } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { dlog } from "./log";

export interface ListenOptions {
  continuous?: boolean;
}

export async function ensureSpeechReady(): Promise<void> {
  const available = await ExpoSpeechRecognitionModule.isRecognitionAvailable();
  if (!available) {
    throw new Error("Speech recognition is not available on this device.");
  }

  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!result.granted) {
    throw new Error("Microphone permission is required for voice input.");
  }
}

export async function startListening(options: ListenOptions = {}): Promise<void> {
  await ensureSpeechReady();

  // Clear orphaned session — use stop only (abort fires a spurious "aborted" error on iOS).
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {}

  await new Promise((resolve) => setTimeout(resolve, 100));

  if (Platform.OS === "ios") {
    ExpoSpeechRecognitionModule.setCategoryIOS({
      category: "playAndRecord",
      categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
      mode: "voiceChat",
    });
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
  });

  dlog("stt", "start (playAndRecord)");
  ExpoSpeechRecognitionModule.start({
    lang: "en-US",
    interimResults: true,
    continuous: options.continuous ?? false,
    iosCategory: {
      category: "playAndRecord",
      categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
      mode: "voiceChat",
    },
  });
}

export async function resetAudioForPlayback(): Promise<void> {
  // Brief wait for native STT engine to finish its audio session cleanup.
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (Platform.OS === "ios") {
    try {
      // defaultToSpeaker is ONLY valid with playAndRecord — using it with
      // playback throws OSStatus -50 (paramErr) from setCategoryIOS.
      ExpoSpeechRecognitionModule.setCategoryIOS({
        category: "playback",
        categoryOptions: [],
        mode: "default",
      });
    } catch (e) {
      dlog("audio", "setCategoryIOS playback skipped:", e);
    }
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
  });
}

export function softStopRecognition(): void {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {}
}

export async function stopListening(): Promise<void> {
  softStopRecognition();
  await resetAudioForPlayback();
}

export function abortListening(): void {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {}
}

export { useSpeechRecognitionEvent };
