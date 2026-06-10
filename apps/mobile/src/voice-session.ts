/** Hand off audio session from playback back to mic for continuous voice sessions. */
import { stopPlayback } from "./audio";
import { activateVoiceSessionAudio } from "./background-audio";
import { dlog } from "./log";
import { prepareForNativeStream } from "./speech";
import { stopStreamingPlayback } from "./stream-audio";

const HANDOFF_MS = 280;
const QUICK_HANDOFF_MS = 90;

export async function prepareMicHandoff(
  continuousVoice: boolean,
  quick = false,
): Promise<void> {
  await stopStreamingPlayback();
  await stopPlayback();
  await new Promise((resolve) =>
    setTimeout(resolve, quick ? QUICK_HANDOFF_MS : HANDOFF_MS),
  );
  if (continuousVoice) {
    await activateVoiceSessionAudio();
    await prepareForNativeStream({ continuousVoice: true });
  }
  dlog("voice", `mic handoff complete${quick ? " (quick)" : ""}`);
}
