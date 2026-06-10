/** Local app settings — survives force-quit and relaunch. */
import { Paths } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";

const SETTINGS_URI = `${Paths.document.uri}atlas-settings.json`;

export interface AppSettings {
  wakeWordEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  wakeWordEnabled: false,
};

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const info = await LegacyFS.getInfoAsync(SETTINGS_URI);
    if (!info.exists) return { ...DEFAULTS };
    const raw = await LegacyFS.readAsStringAsync(SETTINGS_URI);
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      wakeWordEnabled: parsed.wakeWordEnabled === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveWakeWordEnabled(enabled: boolean): Promise<void> {
  const current = await loadAppSettings();
  await LegacyFS.writeAsStringAsync(
    SETTINGS_URI,
    JSON.stringify({ ...current, wakeWordEnabled: enabled }),
    { encoding: LegacyFS.EncodingType.UTF8 },
  );
}
