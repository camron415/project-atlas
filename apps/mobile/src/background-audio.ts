import { Audio, InterruptionModeIOS } from "expo-av";
import { Platform } from "react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { dlog } from "./log";

let wakeHold = false;
let voiceHold = false;
let sessionActive = false;

async function applyBackgroundSession(force = false): Promise<void> {
  if (Platform.OS !== "ios") return;
  if (sessionActive && !force) return;

  try {
    // spokenAudio (not voiceChat) keeps output on the speaker. Native capture uses
    // the same spokenAudio profile via applyRecordingSession().
    ExpoSpeechRecognitionModule.setCategoryIOS({
      category: "playAndRecord",
      categoryOptions: ["allowBluetooth", "allowBluetoothA2DP"],
      mode: "spokenAudio",
    });
  } catch (error) {
    dlog("bg-audio", "setCategoryIOS skipped", error);
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });

  sessionActive = true;
  dlog("bg-audio", `background audio session active${force ? " (forced)" : ""}`);
}

async function releaseBackgroundSession(): Promise<void> {
  if (Platform.OS !== "ios" || !sessionActive) return;
  if (wakeHold || voiceHold) return;

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: 1,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });

  sessionActive = false;
  dlog("bg-audio", "background audio session released");
}

/** Porcupine / phrase wake — low-power listen while idle. */
export async function activateBackgroundWakeAudio(): Promise<void> {
  wakeHold = true;
  await applyBackgroundSession();
}

export async function deactivateBackgroundWakeAudio(): Promise<void> {
  wakeHold = false;
  await releaseBackgroundSession();
}

/** Active voice turn — keep mic + playback alive when the screen locks. */
export async function activateVoiceSessionAudio(): Promise<void> {
  voiceHold = true;
  // Always re-apply: a prior wake/idle session may have skipped recording options.
  await applyBackgroundSession(true);
}

/** Force re-activate after a screen unlock / app foreground event. */
export async function reactivateVoiceSessionAudio(): Promise<void> {
  if (!voiceHold) return;
  await applyBackgroundSession(true);
}

export async function deactivateVoiceSessionAudio(): Promise<void> {
  voiceHold = false;
  await releaseBackgroundSession();
}

export function isBackgroundAudioActive(): boolean {
  return sessionActive;
}
