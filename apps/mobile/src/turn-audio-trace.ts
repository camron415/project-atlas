/**
 * Structured audio-route diagnostics — appended to transcript log for post-mortems.
 */
import { Paths } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import type { TurnAudioRoute } from "./turn-audio-policy";
import { dlog } from "./log";

const TRACE_URI = `${Paths.document.uri}atlas-audio-trace.jsonl`;

export interface TurnAudioTraceEntry {
  ts: string;
  turnId: string;
  event: string;
  route?: TurnAudioRoute;
  sawAudioDeltas?: boolean;
  pcmDelivered?: boolean;
  allowTtsFallback?: boolean;
  ms?: number;
  detail?: string;
}

export async function traceTurnAudio(entry: Omit<TurnAudioTraceEntry, "ts">): Promise<void> {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  dlog("audio-trace", entry.event, entry.detail ?? entry.route ?? "");
  try {
    let existing = "";
    const info = await LegacyFS.getInfoAsync(TRACE_URI);
    if (info.exists) {
      existing = await LegacyFS.readAsStringAsync(TRACE_URI);
    }
    await LegacyFS.writeAsStringAsync(TRACE_URI, existing + line, {
      encoding: LegacyFS.EncodingType.UTF8,
    });
  } catch {
    // Non-fatal.
  }
}

export function getAudioTraceUri(): string {
  return TRACE_URI;
}
