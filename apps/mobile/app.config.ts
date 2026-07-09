import type { ConfigContext, ExpoConfig } from "expo/config";

import withAtlasAts from "./plugins/withAtlasAts";

const TS_IP = process.env.ATLAS_TAILSCALE_IP ?? "";
const LAN_IP = process.env.ATLAS_LAN_IP ?? "127.0.0.1";
const TAILNET = process.env.ATLAS_TAILNET ?? "";
const TS_HOST = process.env.ATLAS_TAILSCALE_HOST ?? "";

export default ({ config }: ConfigContext): ExpoConfig => {
  let expoConfig: ExpoConfig = {
    ...config,
    name: "Atlas",
    slug: "atlas",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    scheme: "atlas",
    splash: {
      resizeMode: "contain",
      backgroundColor: "#0b0f17",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.camrontrost.atlas",
      infoPlist: {
        NSMicrophoneUsageDescription:
          "Atlas uses the microphone for voice commands, optional wake word listening, and conversation with your chief assistant.",
        NSSpeechRecognitionUsageDescription:
          "Atlas uses speech recognition to understand your spoken questions.",
        NSLocationWhenInUseUsageDescription:
          "Atlas uses your location for weather and local search when you ask.",
        NSSupportsLiveActivities: true,
        UIBackgroundModes: ["audio"],
      },
    },
    android: {
      package: "com.camrontrost.atlas",
      edgeToEdgeEnabled: true,
      permissions: ["RECORD_AUDIO"],
    } as ExpoConfig["android"],
    plugins: [
      "expo-speech-recognition",
      [
        "expo-build-properties",
        {
          ios: { deploymentTarget: "16.4" },
        },
      ],
      [
        withAtlasAts as unknown as string,
        { tsIp: TS_IP, lanIp: LAN_IP, tailnet: TAILNET, tsHost: TS_HOST },
      ],
    ],
  };

  return expoConfig;
};
