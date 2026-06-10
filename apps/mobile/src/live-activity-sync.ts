import { syncVoiceLiveActivity } from "atlas-live-activity";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function syncLiveActivity(
  status: "idle" | "listening" | "thinking" | "speaking",
  detail: string,
  micSession: boolean,
): void {
  const active = micSession && status !== "idle";
  void syncVoiceLiveActivity({
    status: STATUS_LABEL[status] ?? status,
    detail: detail.slice(0, 120),
    listening: status === "listening",
    active,
  });
}
