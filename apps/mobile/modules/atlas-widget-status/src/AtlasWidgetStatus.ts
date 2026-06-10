import { requireNativeModule } from "expo-modules-core";

export interface WidgetSnapshot {
  connection: "online" | "offline" | "unknown";
  status: "idle" | "listening" | "thinking" | "speaking";
  lastLine: string;
  wakeOn: boolean;
}

type AtlasWidgetStatusNative = {
  updateSnapshot(
    connection: string,
    status: string,
    lastLine: string,
    wakeOn: boolean,
  ): Promise<void>;
};

let nativeModule: AtlasWidgetStatusNative | null = null;

try {
  nativeModule = requireNativeModule<AtlasWidgetStatusNative>("AtlasWidgetStatus");
} catch {
  nativeModule = null;
}

export async function updateWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.updateSnapshot(
    snapshot.connection,
    snapshot.status,
    snapshot.lastLine,
    snapshot.wakeOn,
  );
}
