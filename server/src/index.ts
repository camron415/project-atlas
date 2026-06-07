import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/schema.js";
import { answerChiefMessage } from "./chief/respond.js";
import { buildChiefInstructions } from "./chief/instructions.js";
import {
  createRealtimeClientSecret,
  getRealtimeModel,
} from "./xai/realtime.js";
import {
  getActiveProjects,
  loadRegistry,
} from "./projects/registry.js";
import {
  projectsNeedingRefresh,
  syncProjectsToDb,
} from "./projects/scanner.js";
import {
  storeProjectReport,
  getLatestReports,
  buildContextManifest,
} from "./reports/store.js";
import { synthesizeProjectReport } from "./reports/synthesize.js";
import { synthesizeSpeech } from "./xai/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.ATLAS_DATA_DIR ??
  path.resolve(__dirname, "../data");
const port = Number(process.env.ATLAS_PORT ?? 8787);
const host = process.env.ATLAS_HOST ?? "0.0.0.0";
const publicUrl =
  process.env.ATLAS_PUBLIC_URL ??
  (process.env.ATLAS_LAN_IP
    ? `http://${process.env.ATLAS_LAN_IP}:${port}`
    : `http://127.0.0.1:${port}`);

const db = getDb(dataDir);
const registry = loadRegistry();

const debug = process.env.ATLAS_DEBUG === "1";
const slog = (...args: unknown[]): void => {
  if (debug) console.log("[atlas]", ...args);
};

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options(/.*/, (_req, res) => {
  res.sendStatus(204);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "atlas",
    version: "0.1.0",
    url: publicUrl,
    lanIp: process.env.ATLAS_LAN_IP ?? null,
  });
});

app.get("/projects", (_req, res) => {
  const active = getActiveProjects(registry);
  res.json({ projects: active, registryVersion: registry.version });
});

app.get("/reports", (_req, res) => {
  res.json({ reports: getLatestReports(db) });
});

app.get("/reports/manifest", (_req, res) => {
  res.json({ manifest: buildContextManifest(db) });
});

app.get("/chief/instructions", (_req, res) => {
  res.json({
    instructions: buildChiefInstructions(db),
    model: getRealtimeModel(),
    voice: process.env.XAI_TTS_VOICE ?? "rex",
  });
});

app.post("/tts", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    if (!process.env.XAI_API_KEY) {
      res.status(503).json({ error: "XAI_API_KEY not configured" });
      return;
    }
    const audio = await synthesizeSpeech(text);
    res.json({
      audio: audio.toString("base64"),
      audioFormat: "mp3",
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "TTS failed",
    });
  }
});

app.post("/realtime/client-secret", async (_req, res) => {
  try {
    if (!process.env.XAI_API_KEY) {
      res.status(503).json({ error: "XAI_API_KEY not configured" });
      return;
    }
    const secret = await createRealtimeClientSecret();
    res.json({
      ...secret,
      wsUrl: `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(secret.model)}`,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "client secret failed",
    });
  }
});

app.post("/reports/refresh", async (req, res) => {
  const force = Boolean(req.body?.force);
  const deep = Boolean(req.body?.deep);
  const active = getActiveProjects(registry);
  const snapshots = syncProjectsToDb(db, active, { deep });
  const toRefresh = force ? snapshots : projectsNeedingRefresh(db, snapshots);

  for (const snap of toRefresh) {
    let enriched = snap;
    if (deep && enriched.codeInventory && process.env.XAI_API_KEY) {
      const llmSummary = await synthesizeProjectReport(enriched);
      if (llmSummary) {
        enriched = { ...enriched, llmSummary };
      }
    }
    storeProjectReport(db, enriched, deep ? "deep-scan" : force ? "force-refresh" : "refresh");
  }

  slog(
    `/reports/refresh force=${force} deep=${deep} scanned=${snapshots.length} refreshed=${toRefresh.length}`,
  );
  res.json({
    scanned: snapshots.length,
    refreshed: toRefresh.length,
    forced: force,
    deep,
    manifest: buildContextManifest(db),
    reports: getLatestReports(db),
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const reply = await answerChiefMessage(db, {
      message,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      interrupted: Boolean(req.body?.interrupted),
      deep: Boolean(req.body?.deep),
    });
    slog(`/chat deep=${reply.deep} model=${reply.model} chars=${reply.filtered.length}`);
    res.json(reply);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "chat failed",
    });
  }
});

app.post("/chat/voice", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const reply = await answerChiefMessage(db, {
      message,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      interrupted: Boolean(req.body?.interrupted),
      deep: Boolean(req.body?.deep),
    });

    if (!process.env.XAI_API_KEY) {
      res.json({ ...reply, audio: null, audioError: "XAI_API_KEY not configured" });
      return;
    }

    // TTS failure should not lose the answer — return the text with an
    // audioError so clients can still show (and read) the reply.
    try {
      const audio = await synthesizeSpeech(reply.filtered);
      res.json({
        ...reply,
        audio: audio.toString("base64"),
        audioFormat: "mp3",
      });
    } catch (ttsError) {
      res.json({
        ...reply,
        audio: null,
        audioError:
          ttsError instanceof Error ? ttsError.message : "TTS failed",
      });
    }
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "voice chat failed",
    });
  }
});

app.listen(port, host, () => {
  console.log(`Atlas server listening on ${publicUrl} (bind ${host}:${port})`);

  // Boot-time scan
  const active = getActiveProjects(registry);
  const snapshots = syncProjectsToDb(db, active, { deep: false });
  if (!getLatestReports(db).length) {
    for (const snap of snapshots) {
      storeProjectReport(db, snap, "boot");
    }
    console.log(`Seeded ${snapshots.length} project report(s)`);
  }
});
