/** Compact header labels — full build/server details live in Settings. */
export function shortServerLabel(url: string): string {
  const host = url.replace(/^https?:\/\//, "").split(":")[0] ?? url;
  if (host.includes(".ts.net")) {
    return host.split(".")[0] ?? host;
  }
  if (host.length > 20) {
    return `${host.slice(0, 18)}…`;
  }
  return host;
}

export function buildStatusMeta(parts: {
  connection: "unknown" | "online" | "offline";
  sttMode: string;
  activeSpeaker: string | null;
  wakeOn: boolean;
  backgroundVoice?: boolean;
}): string {
  const tokens: string[] = [];
  if (parts.connection === "online") tokens.push("Online");
  else if (parts.connection === "offline") tokens.push("Offline");
  tokens.push(parts.sttMode);
  if (parts.activeSpeaker) tokens.push(parts.activeSpeaker);
  if (parts.wakeOn) tokens.push("Wake");
  if (parts.backgroundVoice) tokens.push("Background");
  return tokens.join(" · ");
}
