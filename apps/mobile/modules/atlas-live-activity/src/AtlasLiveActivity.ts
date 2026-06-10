import { requireNativeModule } from "expo-modules-core";

type Native = {
  sync(status: string, detail: string, listening: boolean, active: boolean): Promise<void>;
};

let native: Native | null = null;
try {
  native = requireNativeModule<Native>("AtlasLiveActivity");
} catch {
  native = null;
}

export async function syncVoiceLiveActivity(input: {
  status: string;
  detail: string;
  listening: boolean;
  active: boolean;
}): Promise<void> {
  if (!native) return;
  await native.sync(input.status, input.detail, input.listening, input.active);
}
