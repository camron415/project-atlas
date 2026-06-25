import { fetchSttConfig, type SttConfig } from "./api";
import { resolveAtlasServerUrl } from "./config";
import { dlog, dwarn } from "./log";

export interface SttWord {
  text: string;
  speaker?: number;
}

export interface SttTranscriptEvent {
  type: string;
  text?: string;
  words?: SttWord[];
  is_final?: boolean;
  speech_final?: boolean;
  end_of_turn_confidence?: number;
  message?: string;
}

export function dominantSttSpeaker(words?: SttWord[]): number | null {
  if (!words?.length) return null;
  const counts = new Map<number, number>();
  for (const word of words) {
    if (typeof word.speaker !== "number") continue;
    counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
  }
  if (!counts.size) return null;
  let bestId = 0;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId;
}

export interface XaiSttSession {
  sendPcmBase64: (base64: string) => void;
  close: () => void;
  ready: Promise<void>;
}

export function httpBaseToWs(base: string, path: string): string {
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = path;
  url.search = "";
  return url.toString();
}

function decodeBase64Pcm(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function openXaiSttSession(
  onEvent: (event: SttTranscriptEvent) => void,
  config?: SttConfig,
): Promise<XaiSttSession> {
  const sttConfig = config ?? (await fetchSttConfig());
  if (!sttConfig.enabled) {
    throw new Error("xAI STT is not enabled on the Atlas server");
  }

  const base = await resolveAtlasServerUrl();
  const wsUrl = httpBaseToWs(base, sttConfig.wsPath);
  dlog("stt", `connecting ${wsUrl}`);

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  let upstreamReady = false;
  const audioQueue: ArrayBuffer[] = [];
  let closed = false;

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("STT session timed out waiting for server ready"));
      try {
        ws.close();
      } catch {}
    }, 15_000);

    ws.onopen = () => {
      dlog("stt", "websocket open");
    };

    ws.onmessage = (message) => {
      if (typeof message.data !== "string") return;

      try {
        const event = JSON.parse(message.data) as SttTranscriptEvent;
        if (event.type === "transcript.created") {
          upstreamReady = true;
          clearTimeout(timeout);
          dlog("stt", "upstream ready");
          while (audioQueue.length) {
            const chunk = audioQueue.shift();
            if (chunk) ws.send(chunk);
          }
          resolve();
        }
        if (event.type === "error" && !upstreamReady) {
          clearTimeout(timeout);
          reject(new Error(event.message ?? "STT upstream error"));
          return;
        }
        onEvent(event);
      } catch (error) {
        dwarn("stt", "bad message", error);
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      if (!upstreamReady) {
        reject(new Error("STT WebSocket error"));
      } else {
        onEvent({ type: "error", message: "STT WebSocket error" });
      }
    };

    ws.onclose = () => {
      closed = true;
      clearTimeout(timeout);
      if (!upstreamReady) {
        reject(new Error("STT WebSocket closed before ready"));
      } else {
        onEvent({ type: "error", message: "STT session closed — reconnecting" });
      }
    };
  });

  return {
    ready,
    sendPcmBase64: (base64: string) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      const buffer = decodeBase64Pcm(base64);
      if (!upstreamReady) {
        audioQueue.push(buffer);
        return;
      }
      ws.send(buffer);
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "audio.done" }));
        }
      } catch {}
      try {
        ws.close();
      } catch {}
    },
  };
}
