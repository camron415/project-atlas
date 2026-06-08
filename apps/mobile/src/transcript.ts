/**
 * Persistent conversation transcript — local file + server copy for training/debug.
 */
import { Paths } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import { postTranscriptLine } from "./api";

const TRANSCRIPT_URI = `${Paths.document.uri}atlas-transcript.jsonl`;

export async function recordTranscript(
  role: "user" | "atlas",
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const entry = {
    ts: new Date().toISOString(),
    role,
    text: trimmed,
  };
  const line = `${JSON.stringify(entry)}\n`;

  try {
    let existing = "";
    const info = await LegacyFS.getInfoAsync(TRANSCRIPT_URI);
    if (info.exists) {
      existing = await LegacyFS.readAsStringAsync(TRANSCRIPT_URI);
    }
    await LegacyFS.writeAsStringAsync(TRANSCRIPT_URI, existing + line, {
      encoding: LegacyFS.EncodingType.UTF8,
    });
  } catch {
    // Non-fatal — server copy may still succeed.
  }

  void postTranscriptLine(entry).catch(() => {});
}

export function getTranscriptFileUri(): string {
  return TRANSCRIPT_URI;
}
