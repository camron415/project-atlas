import type { Server as HttpServer, IncomingMessage } from "node:http";
import type Database from "better-sqlite3";
import { WebSocket, WebSocketServer } from "ws";
import {
  executeAnalystTool,
  sendFunctionOutput,
} from "./analyst/execute-tool.js";
import { ANALYST_REALTIME_TOOLS } from "./analyst/tools.js";
import type { ProjectRegistry } from "./projects/registry.js";
import {
  buildRealtimeWebSocketUrl,
  getRealtimeModel,
} from "./xai/realtime.js";
import {
  getRealtimeMetrics,
  recordRealtimeMetric,
  resetRealtimeMetrics,
} from "./realtime-metrics.js";

export interface RealtimeProxyDeps {
  db: Database.Database;
  registry: ProjectRegistry;
  dataDir: string;
}

const debug = process.env.ATLAS_DEBUG === "1";
const slog = (...args: unknown[]): void => {
  if (debug) console.log("[atlas:rt-proxy]", ...args);
};

const WS_PATH = "/realtime/stream";

export interface RealtimeHistoryTurn {
  role: string;
  content: string;
}

export interface RealtimeProxyConfigure {
  type: "proxy.configure";
  instructions?: string;
  voice?: string;
  inputSampleRate?: number;
  outputSampleRate?: number;
  history?: RealtimeHistoryTurn[];
  chatSessionId?: string;
}

function buildConversationItem(turn: RealtimeHistoryTurn): Record<string, unknown> {
  const text = String(turn.content ?? "").trim();
  const role = String(turn.role ?? "user");
  if (role === "assistant" || role === "atlas") {
    return {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
    };
  }
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

function seedConversationHistory(
  upstream: WebSocket,
  history: RealtimeHistoryTurn[] | undefined,
): number {
  if (!history?.length) return 0;
  let seeded = 0;
  for (const turn of history.slice(-10)) {
    const text = String(turn.content ?? "").trim();
    if (!text) continue;
    upstream.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: buildConversationItem(turn),
      }),
    );
    seeded += 1;
  }
  return seeded;
}

function parseSubprotocolSecret(request: IncomingMessage): string | null {
  const header = request.headers["sec-websocket-protocol"];
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith("xai-client-secret.")) {
      return part.slice("xai-client-secret.".length);
    }
  }
  return null;
}

/** React Native WebSocket often omits Sec-WebSocket-Protocol — accept query fallback. */
function parseClientSecret(request: IncomingMessage): string | null {
  const fromProto = parseSubprotocolSecret(request);
  if (fromProto) return fromProto;
  const url = new URL(request.url ?? "/", "http://localhost");
  const fromQuery =
    url.searchParams.get("secret") ?? url.searchParams.get("client_secret");
  return fromQuery?.trim() || null;
}

function buildSessionUpdate(config: RealtimeProxyConfigure): Record<string, unknown> {
  const inputRate = config.inputSampleRate ?? 16000;
  const outputRate = config.outputSampleRate ?? 24000;
  let instructions = config.instructions ?? "";
  if (config.chatSessionId?.trim()) {
    instructions += `\n\n## Current chat session\nSession id for write_inbox_summary: ${config.chatSessionId.trim()}`;
  }
  return {
    type: "session.update",
    session: {
      model: getRealtimeModel(),
      instructions,
      voice: config.voice ?? process.env.XAI_TTS_VOICE ?? "rex",
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 1200,
        create_response: false,
        interrupt_response: true,
      },
      tools: [{ type: "web_search" }, ...ANALYST_REALTIME_TOOLS],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: inputRate },
          transcription: { model: "grok-transcribe" },
        },
        output: { format: { type: "audio/pcm", rate: outputRate } },
      },
    },
  };
}

function isConfigureMessage(raw: string): RealtimeProxyConfigure | null {
  try {
    const msg = JSON.parse(raw) as { type?: string };
    if (msg.type === "proxy.configure") return msg as RealtimeProxyConfigure;
  } catch {
    // ignore
  }
  return null;
}

function openUpstreamSocket(upstreamUrl: string, secret: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const upstream = new WebSocket(upstreamUrl, [`xai-client-secret.${secret}`]);
    const timer = setTimeout(() => {
      try {
        upstream.terminate();
      } catch {}
      reject(new Error("xAI Realtime upstream connect timed out"));
    }, 15_000);

    upstream.once("open", () => {
      clearTimeout(timer);
      resolve(upstream);
    });
    upstream.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Bidirectional Realtime proxy: mobile ↔ xAI with server-side session injection.
 */
export function attachRealtimeProxy(
  httpServer: HttpServer,
  deps: RealtimeProxyDeps,
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) return;

    if (!process.env.XAI_API_KEY) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, request);
    });
  });

  wss.on("connection", (clientWs: WebSocket, request: IncomingMessage) => {
    void handleRealtimeClient(clientWs, request, deps);
  });
}

async function handleRealtimeClient(
  clientWs: WebSocket,
  request: IncomingMessage,
  deps: RealtimeProxyDeps,
): Promise<void> {
  const secret = parseClientSecret(request);
  if (!secret) {
    slog("reject — missing client secret");
    try {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: "error",
            error: { message: "missing client secret (subprotocol or ?secret=)" },
          }),
        );
      }
      clientWs.close(1008, "missing client secret");
    } catch {}
    return;
  }

  const sessionId = `rt-${Date.now()}`;
  const connectStarted = Date.now();
  resetRealtimeMetrics(sessionId);

  let upstream: WebSocket;
  try {
    upstream = await openUpstreamSocket(buildRealtimeWebSocketUrl(), secret);
    recordRealtimeMetric("connectMs", Date.now() - connectStarted);
    slog("upstream open", sessionId);
  } catch (error) {
    slog("upstream connect failed", error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: {
            message: error instanceof Error ? error.message : "upstream connect failed",
          },
        }),
      );
      clientWs.close(1011, "upstream error");
    }
    return;
  }

  let pendingConfigure: RealtimeProxyConfigure | null = null;
  let configureSentAt: number | null = null;
  let clientReady = false;
  let sawFirstAudioDelta = false;
  const clientQueue: string[] = [];

  const closeBoth = (code = 1000, reason = ""): void => {
    try {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
    } catch {}
    try {
      if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
    } catch {}
  };

  const flushClientQueue = (): void => {
    if (!clientReady || upstream.readyState !== WebSocket.OPEN) return;
    while (clientQueue.length) {
      const msg = clientQueue.shift();
      if (msg) upstream.send(msg);
    }
  };

  const notifyClientReady = (): void => {
    if (clientReady || clientWs.readyState !== WebSocket.OPEN) return;
    clientReady = true;
    clientWs.send(JSON.stringify({ type: "proxy.configured", sessionId }));
    flushClientQueue();
    slog("client ready — proxy.configured sent", sessionId);
  };

  const handleFunctionCall = (event: {
    name?: string;
    call_id?: string;
    arguments?: string;
  }): void => {
    const name = event.name;
    const callId = event.call_id;
    const args = event.arguments ?? "{}";
    if (!name || !callId || upstream.readyState !== WebSocket.OPEN) return;

    slog("function call", name, callId);
    void executeAnalystTool(name, args, {
      db: deps.db,
      registry: deps.registry,
      dataDir: deps.dataDir,
      clientWs,
      notifyAnalyst: (payload) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify(payload));
        }
      },
    }).then((output) => {
      if (upstream.readyState === WebSocket.OPEN) {
        sendFunctionOutput(upstream, callId, output);
      }
    });
  };

  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      clientWs.send(data, { binary: true });
      return;
    }

    const text = data.toString();
    try {
      const event = JSON.parse(text) as {
        type?: string;
        name?: string;
        call_id?: string;
        arguments?: string;
      };

      if (event.type === "response.function_call_arguments.done") {
        handleFunctionCall(event);
      }
      if (
        (event.type === "session.created" || event.type === "conversation.created") &&
        pendingConfigure
      ) {
        configureSentAt = Date.now();
        upstream.send(JSON.stringify(buildSessionUpdate(pendingConfigure)));
        slog("session.update injected");
      }
      if (event.type === "session.updated") {
        if (configureSentAt) {
          recordRealtimeMetric("configuredMs", Date.now() - configureSentAt);
        }
        const seeded = seedConversationHistory(upstream, pendingConfigure?.history);
        if (seeded > 0) {
          slog("seeded conversation history", sessionId, `${seeded} items`);
        }
        notifyClientReady();
      }
      if (
        !sawFirstAudioDelta &&
        (event.type === "response.audio.delta" ||
          event.type === "response.output_audio.delta")
      ) {
        sawFirstAudioDelta = true;
        if (configureSentAt) {
          recordRealtimeMetric("firstAudioDeltaMs", Date.now() - configureSentAt);
        }
      }
      if (event.type === "response.done" && configureSentAt) {
        recordRealtimeMetric("lastTurnCompleteMs", Date.now() - configureSentAt);
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
          error: { message: error instanceof Error ? error.message : "upstream error" },
        }),
      );
    }
    closeBoth(1011, "upstream error");
  });

  upstream.on("close", () => {
    slog("upstream closed", sessionId);
    closeBoth();
  });

  clientWs.on("message", (data, isBinary) => {
    if (isBinary) {
      if (!clientReady) return;
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: true });
      return;
    }

    const text = data.toString();
    const configure = isConfigureMessage(text);
    if (configure) {
      pendingConfigure = configure;
      slog("configure received");
      if (
        pendingConfigure &&
        upstream.readyState === WebSocket.OPEN &&
        !configureSentAt
      ) {
        // session.created may have already fired — inject immediately if we missed it
        upstream.send(JSON.stringify(buildSessionUpdate(pendingConfigure)));
        configureSentAt = Date.now();
        slog("session.update injected (immediate)");
      }
      return;
    }

    if (!clientReady) {
      clientQueue.push(text);
      return;
    }

    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
  });

  clientWs.on("error", (error) => {
    slog("client error", error);
    closeBoth(1011, "client error");
  });

  clientWs.on("close", () => {
    slog("client closed", sessionId);
    closeBoth();
  });
}

export function realtimeProxyEnabled(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

export function getRealtimeProxyPath(): string {
  return WS_PATH;
}

export { getRealtimeMetrics };
