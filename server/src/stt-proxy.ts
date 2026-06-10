import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  buildXaiSttWebSocketUrl,
  getSttSessionConfig,
  getXaiApiKey,
  isSttEnabled,
} from "./xai/stt.js";

const debug = process.env.ATLAS_DEBUG === "1";
const slog = (...args: unknown[]): void => {
  if (debug) console.log("[atlas:stt-proxy]", ...args);
};

type RelayState = "awaiting_upstream_ready" | "streaming" | "closing";

const UPSTREAM_RETRY_DELAYS_MS = [0, 2_000, 4_000, 8_000, 16_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429");
}

function openUpstreamSocket(upstreamUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${getXaiApiKey()}` },
    });

    upstream.once("open", () => resolve(upstream));
    upstream.once("error", (error) => {
      try {
        upstream.close();
      } catch {}
      reject(error);
    });
  });
}

async function connectUpstreamWithRetry(upstreamUrl: string): Promise<WebSocket> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPSTREAM_RETRY_DELAYS_MS.length; attempt++) {
    const delay = UPSTREAM_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) {
      slog(`upstream 429 — retry ${attempt + 1}/${UPSTREAM_RETRY_DELAYS_MS.length} in ${delay}ms`);
      await sleep(delay);
    }
    try {
      const upstream = await openUpstreamSocket(upstreamUrl);
      if (attempt > 0) slog("upstream connected after retry");
      return upstream;
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === UPSTREAM_RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upstream STT connection failed");
}

/**
 * Bidirectional WebSocket proxy: mobile client ↔ xAI STT.
 * API key stays on the server (xAI docs requirement).
 */
export function attachSttProxy(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/stt/stream") {
      return;
    }

    if (!isSttEnabled()) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, request);
    });
  });

  wss.on("connection", (clientWs: WebSocket, request: IncomingMessage) => {
    void handleSttClient(clientWs, request);
  });
}

async function handleSttClient(clientWs: WebSocket, request: IncomingMessage): Promise<void> {
  const config = getSttSessionConfig();
  const upstreamUrl = buildXaiSttWebSocketUrl(config);
  let state: RelayState = "awaiting_upstream_ready";
  let upstreamReady = false;
  const audioQueue: Buffer[] = [];

  slog("client connected", request.socket.remoteAddress);

  let upstream: WebSocket;
  try {
    upstream = await connectUpstreamWithRetry(upstreamUrl);
  } catch (error) {
    slog("upstream connect failed", error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "upstream STT error",
        }),
      );
    }
    try {
      clientWs.close(1011, "upstream error");
    } catch {}
    return;
  }

  slog("upstream open");

  const closeBoth = (code = 1000, reason = ""): void => {
    state = "closing";
    try {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
    } catch {}
    try {
      if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
    } catch {}
  };

  const flushAudioQueue = (): void => {
    if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) return;
    while (audioQueue.length) {
      const chunk = audioQueue.shift();
      if (chunk) upstream.send(chunk);
    }
  };

  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      clientWs.send(data, { binary: true });
      return;
    }

    const text = data.toString();
    try {
      const event = JSON.parse(text) as { type?: string };
      if (event.type === "transcript.created") {
        upstreamReady = true;
        state = "streaming";
        flushAudioQueue();
        slog("upstream ready — forwarding transcript.created");
      }
    } catch {
      // forward as-is
    }

    clientWs.send(text);
  });

  upstream.on("error", (error) => {
    slog("upstream error", error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "upstream STT error",
        }),
      );
    }
    closeBoth(1011, "upstream error");
  });

  upstream.on("close", () => {
    slog("upstream closed");
    if (state !== "closing") closeBoth();
  });

  clientWs.on("message", (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) {
      if (isBinary && state === "awaiting_upstream_ready") {
        audioQueue.push(Buffer.from(data as Buffer));
      }
      return;
    }

    if (isBinary) {
      if (!upstreamReady) {
        audioQueue.push(Buffer.from(data as Buffer));
        return;
      }
      upstream.send(data, { binary: true });
      return;
    }

    const text = data.toString();
    upstream.send(text);

    try {
      const msg = JSON.parse(text) as { type?: string };
      if (msg.type === "audio.done") {
        slog("client signaled audio.done");
      }
    } catch {
      // ignore
    }
  });

  clientWs.on("error", (error) => {
    slog("client error", error);
    closeBoth(1011, "client error");
  });

  clientWs.on("close", () => {
    slog("client closed");
    if (state !== "closing") {
      try {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ type: "audio.done" }));
        }
      } catch {}
      closeBoth();
    }
  });
}
