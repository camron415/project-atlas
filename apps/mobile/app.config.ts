import type { ConfigContext, ExpoConfig } from "expo/config";

import withAtlasAts from "./plugins/withAtlasAts";

const TS_IP = process.env.ATLAS_TAILSCALE_IP ?? "100.127.118.18";
const LAN_IP = process.env.ATLAS_LAN_IP ?? "10.0.0.84";
const TAILNET = process.env.ATLAS_TAILNET ?? "tail5f7dec.ts.net";
const TS_HOST =
  process.env.ATLAS_TAILSCALE_HOST ?? "macbook-air-de-camron.tail5f7dec.ts.net";

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
          "Atlas needs microphone access so you can speak to it using push-to-talk.",
        NSSpeechRecognitionUsageDescription:
          "Atlas uses speech recognition to understand your spoken questions.",
        NSLocationWhenInUseUsageDescription:
          "Atlas uses your location for weather and local search when you ask.",
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
        withAtlasAts as unknown as string,
        { tsIp: TS_IP, lanIp: LAN_IP, tailnet: TAILNET, tsHost: TS_HOST },
      ],
    ],
  };

  return expoConfig;
};
