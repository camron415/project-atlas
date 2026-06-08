// On-device speech-to-text — toggle mic stays open until user taps again.
import { Audio, InterruptionModeIOS } from "expo-av";
import { Platform } from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { dlog } from "./log";

export interface ListenOptions {
  continuous?: boolean;
}

let audibleModeReady = false;

/** Call once at app launch so silent-mode playback is allowed globally. */
export async function initAudibleAudioMode(): Promise<void> {
  if (audibleModeReady) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
  audibleModeReady = true;
}

/** Prepare session immediately before TTS / MP3 playback (silent switch ON). */
export async function prepareAudiblePlayback(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));

  if (Platform.OS === "ios") {
    try {
      ExpoSpeechRecognitionModule.setCategoryIOS({
        category: "playback",
        categoryOptions: [],
        mode: "spokenAudio",
      });
    } catch (e) {
      dlog("audio", "setCategoryIOS playback skipped:", e);
    }
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
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
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
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

/** After STT — hand off to AVAudioEngine (no expo-av playback prep / delay). */
export async function prepareForNativeStream(): Promise<void> {
  if (Platform.OS === "ios") {
    try {
      ExpoSpeechRecognitionModule.setCategoryIOS({
        category: "playAndRecord",
        categoryOptions: ["defaultToSpeaker", "allowBluetooth"],
        mode: "spokenAudio",
      });
    } catch (e) {
      dlog("audio", "prepareForNativeStream setCategoryIOS skipped:", e);
    }
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

export async function resetAudioForPlayback(): Promise<void> {
  await prepareAudiblePlayback();
}

export function softStopRecognition(): void {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {}
}

export async function stopListening(): Promise<void> {
  softStopRecognition();
  await prepareForNativeStream();
}

export function abortListening(): void {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {}
}

export { useSpeechRecognitionEvent };
