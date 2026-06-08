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
    const config = getSttSessionConfig();
    const upstreamUrl = buildXaiSttWebSocketUrl(config);
    let state: RelayState = "awaiting_upstream_ready";
    let upstreamReady = false;
    const audioQueue: Buffer[] = [];

    slog("client connected", request.socket.remoteAddress);

    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${getXaiApiKey()}` },
    });

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

    upstream.on("open", () => {
      slog("upstream open");
    });

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
  });
}
