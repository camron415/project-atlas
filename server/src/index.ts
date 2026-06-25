import "dotenv/config";
import express from "express";
import http from "node:http";
import fs from "node:fs";
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
import { formatXaiApiError, xaiErrorStatus } from "./xai/errors.js";
import { getSttSessionConfig } from "./xai/stt.js";
import { attachSttProxy } from "./stt-proxy.js";
import {
  attachRealtimeProxy,
  getRealtimeMetrics,
  getRealtimeProxyPath,
  realtimeProxyEnabled,
} from "./realtime-proxy.js";
import {
  clearSessionMaps,
  listSpeakerProfiles,
  remapSpeaker,
  resolveSpeaker,
  seedSpeakerProfiles,
  upsertSpeakerProfile,
} from "./speakers/store.js";
import {
  appendChatMessage,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatMessages,
  listChatSessions,
} from "./sessions/store.js";
import { listInboxArtifacts, writeInboxArtifact } from "./inbox/store.js";
import type { InboxProjectSlug } from "./inbox/types.js";
import { enqueueAnalystJob } from "./analyst/run.js";
import { getAnalystJob } from "./analyst/store.js";
import { startMorningBriefScheduler, getMorningBriefSchedulerStatus } from "./morning-brief/schedule.js";
import { startManagerScheduler, getManagerSchedulerStatus } from "./managers/schedule.js";
import { resolveLanIp } from "./network/lan-ip.js";
import { initCostLedger, getCostMtdSnapshot, getCostMonthSummary } from "./cost/ledger.js";
import { getStandupStatus } from "./standup/status.js";
import { activateStandup, deactivateStandup } from "./standup/session-state.js";
import { writeStandupDecisions } from "./standup/decisions.js";
import { refreshStandupContextIndex } from "./standup/fts-refresh.js";
import { listStandupPreps } from "./standup/context.js";
import { standupAgendaFilenameForToday } from "./standup/filenames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.ATLAS_DATA_DIR ??
  path.resolve(__dirname, "../data");
const port = Number(process.env.ATLAS_PORT ?? 8787);
const host = process.env.ATLAS_HOST ?? "0.0.0.0";
const lanIp = resolveLanIp();
const publicUrl =
  process.env.ATLAS_PUBLIC_URL ??
  (lanIp ? `http://${lanIp}:${port}` : `http://127.0.0.1:${port}`);

const db = getDb(dataDir);
initCostLedger(db);
const registry = loadRegistry();
const analystDeps = { db, registry, dataDir };

void import("./context/search.js").then(({ rebuildContextIndex }) => {
  try {
    const n = rebuildContextIndex(db, registry);
    slog(`FTS context index: ${n} documents`);
  } catch (error) {
    console.warn("[atlas] FTS index build failed:", error);
  }
});
const transcriptPath = path.join(dataDir, "transcripts.jsonl");

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
  const cost = getCostMtdSnapshot(db);
  res.json({
    ok: true,
    service: "atlas",
    version: "0.1.0",
    url: publicUrl,
    lanIp,
    realtimeProxy: realtimeProxyEnabled(),
    realtimeProxyPath: getRealtimeProxyPath(),
    schedulers: {
      morningBrief: getMorningBriefSchedulerStatus(dataDir),
      managers: getManagerSchedulerStatus(dataDir),
    },
    cost,
  });
});

app.get("/metrics/cost", (_req, res) => {
  res.json({ summary: getCostMonthSummary(db) });
});

app.get("/standup/status", (req, res) => {
  const chatSessionId =
    typeof req.query.chatSessionId === "string" ? req.query.chatSessionId : undefined;
  res.json(getStandupStatus(db, registry, chatSessionId));
});

app.post("/standup/begin", async (req, res) => {
  try {
    const chatSessionId =
      typeof req.body?.chatSessionId === "string" ? req.body.chatSessionId.trim() : undefined;
    activateStandup(chatSessionId);
    await refreshStandupContextIndex(db, registry);

    const preps = listStandupPreps(registry);
    const reporting = preps.filter((p) => p.path && !p.skip);
    const agendaBody = [
      `# Standup agenda`,
      `**Date:** ${new Date().toISOString()}`,
      "",
      "## Reporting",
      ...reporting.map((p) => `- ${p.managerName} (${p.project})`),
      "",
      "## Skipped",
      ...preps.filter((p) => p.skip).map((p) => `- ${p.managerName} (${p.project})`),
      "",
      "## Flow",
      "Per department: manager → chief challenge → follow-up → synthesis → Camron decisions.",
    ].join("\n");

    writeInboxArtifact(
      registry,
      { project: "atlas", title: "Standup agenda", body: agendaBody },
      db,
    );

    const status = getStandupStatus(db, registry, chatSessionId);
    res.json({
      ok: true,
      standupActive: true,
      opening: status.openingHint,
      agendaFile: standupAgendaFilenameForToday(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "standup begin failed",
    });
  }
});

app.post("/standup/end", async (req, res) => {
  try {
    const summary = String(req.body?.summary ?? "Standup closed.").trim();
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
    const parsed = decisions
      .filter((d: unknown) => d && typeof d === "object")
      .map((d: { project?: string; text?: string; approvalDays?: number }) => ({
        project: String(d.project ?? "atlas"),
        text: String(d.text ?? "").trim(),
        approvalDays: Number(d.approvalDays) || 1,
      }))
      .filter((d: { text: string }) => d.text);

    const written = writeStandupDecisions(registry, summary, parsed, db);
    deactivateStandup();
    await refreshStandupContextIndex(db, registry);
    res.json({ ok: true, path: written.path });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "standup end failed",
    });
  }
});

app.get("/realtime/metrics", (_req, res) => {
  res.json({ metrics: getRealtimeMetrics() });
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

app.get("/chief/instructions", (req, res) => {
  const sessionKey = String(req.query.sessionKey ?? "").trim();
  const sttSpeakerIdRaw = req.query.sttSpeakerId;
  const sttSpeakerId =
    sttSpeakerIdRaw !== undefined && sttSpeakerIdRaw !== ""
      ? Number(sttSpeakerIdRaw)
      : null;

  let speaker = null;
  if (sessionKey && Number.isFinite(sttSpeakerId)) {
    try {
      speaker = resolveSpeaker(db, sessionKey, sttSpeakerId!).profile;
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "speaker resolve failed",
      });
      return;
    }
  }

  res.json({
    instructions: buildChiefInstructions(db, speaker, registry),
    model: getRealtimeModel(),
    voice: process.env.XAI_TTS_VOICE ?? "rex",
    speaker: speaker
      ? { slug: speaker.slug, displayName: speaker.displayName, role: speaker.role }
      : null,
  });
});

app.get("/speakers", (_req, res) => {
  res.json({ speakers: listSpeakerProfiles(db) });
});

app.post("/speakers", (req, res) => {
  try {
    const slug = String(req.body?.slug ?? "").trim().toLowerCase();
    const displayName = String(req.body?.displayName ?? "").trim();
    if (!slug || !displayName) {
      res.status(400).json({ error: "slug and displayName are required" });
      return;
    }
    const role = req.body?.role === "owner" ? "owner" : "guest";
    const profile = upsertSpeakerProfile(db, {
      slug,
      displayName,
      role,
      memorySummary:
        typeof req.body?.memorySummary === "string" ? req.body.memorySummary : undefined,
      greetingStyle:
        typeof req.body?.greetingStyle === "string" ? req.body.greetingStyle : undefined,
    });
    res.json({ speaker: profile });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "speaker update failed",
    });
  }
});

app.post("/speakers/resolve", (req, res) => {
  try {
    const sessionKey = String(req.body?.sessionKey ?? "").trim();
    const sttSpeakerId = Number(req.body?.sttSpeakerId);
    if (!sessionKey || !Number.isFinite(sttSpeakerId)) {
      res.status(400).json({ error: "sessionKey and sttSpeakerId are required" });
      return;
    }
    res.json(resolveSpeaker(db, sessionKey, sttSpeakerId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "speaker resolve failed",
    });
  }
});

app.post("/speakers/map", (req, res) => {
  try {
    const sessionKey = String(req.body?.sessionKey ?? "").trim();
    const sttSpeakerId = Number(req.body?.sttSpeakerId);
    const profileSlug = String(req.body?.profileSlug ?? "").trim();
    if (!sessionKey || !Number.isFinite(sttSpeakerId) || !profileSlug) {
      res.status(400).json({
        error: "sessionKey, sttSpeakerId, and profileSlug are required",
      });
      return;
    }
    res.json(remapSpeaker(db, sessionKey, sttSpeakerId, profileSlug));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "speaker map failed",
    });
  }
});

app.post("/speakers/reset-session", (req, res) => {
  const sessionKey = String(req.body?.sessionKey ?? "").trim();
  if (!sessionKey) {
    res.status(400).json({ error: "sessionKey is required" });
    return;
  }
  const cleared = clearSessionMaps(db, sessionKey);
  res.json({ ok: true, cleared });
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

app.get("/stt/config", (_req, res) => {
  const config = getSttSessionConfig();
  res.json(config);
});

app.post("/realtime/client-secret", async (_req, res) => {
  try {
    if (!process.env.XAI_API_KEY) {
      res.status(503).json({ error: "XAI_API_KEY not configured" });
      return;
    }
    const secret = await createRealtimeClientSecret();
    const base = publicUrl.replace(/^http/i, "ws");
    res.json({
      ...secret,
      wsUrl: `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(secret.model)}`,
      proxyWsUrl: `${base}${getRealtimeProxyPath()}?model=${encodeURIComponent(secret.model)}`,
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "client secret failed";
    res.status(xaiErrorStatus(raw)).json({ error: formatXaiApiError(raw) });
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

app.post("/transcript", (req, res) => {
  const role = req.body?.role;
  const text = String(req.body?.text ?? "").trim();
  if (!text || (role !== "user" && role !== "atlas")) {
    res.status(400).json({ error: "role (user|atlas) and text are required" });
    return;
  }

  const line =
    JSON.stringify({
      ts: typeof req.body?.ts === "string" ? req.body.ts : new Date().toISOString(),
      role,
      text,
      source: "mobile",
    }) + "\n";

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(transcriptPath, line, "utf8");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "transcript write failed",
    });
  }
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
      research: Boolean(req.body?.research),
    });
    slog(
      `/chat deep=${reply.deep} research=${reply.research} model=${reply.model} chars=${reply.filtered.length}`,
    );
    res.json(reply);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "chat failed",
    });
  }
});

app.post("/voice/plan-turn", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const { handlePlanVoiceTurn } = await import("./voice/plan-turn.js");
    const reply = await handlePlanVoiceTurn(analystDeps, {
      message,
      chatSessionId:
        typeof req.body?.chatSessionId === "string" ? req.body.chatSessionId.trim() : undefined,
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      interrupted: Boolean(req.body?.interrupted),
      deep: Boolean(req.body?.deep),
      research: Boolean(req.body?.research),
      skipTts: Boolean(req.body?.skipTts),
      standupMode: Boolean(req.body?.standupMode),
    });
    res.json(reply);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "plan voice turn failed",
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

function newSessionId(): string {
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

app.get("/sessions", (_req, res) => {
  res.json({ sessions: listChatSessions(db) });
});

app.post("/sessions", (req, res) => {
  const id = typeof req.body?.id === "string" && req.body.id.trim() ? req.body.id.trim() : newSessionId();
  const title = String(req.body?.title ?? "New chat").trim() || "New chat";
  try {
    const existing = getChatSession(db, id);
    if (existing) {
      res.json({ session: existing });
      return;
    }
    const session = createChatSession(db, id, title);
    res.json({ session });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "create session failed",
    });
  }
});

app.get("/sessions/:id", (req, res) => {
  const session = getChatSession(db, String(req.params.id));
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({
    session,
    messages: listChatMessages(db, session.id),
  });
});

app.post("/sessions/:id/messages", (req, res) => {
  const sessionId = String(req.params.id);
  const role = req.body?.role;
  const text = String(req.body?.text ?? "").trim();
  if (!text || (role !== "user" && role !== "atlas")) {
    res.status(400).json({ error: "role (user|atlas) and text are required" });
    return;
  }
  try {
    let session = getChatSession(db, sessionId);
    if (!session) {
      session = createChatSession(db, sessionId);
    }
    const message = appendChatMessage(db, sessionId, {
      clientId: typeof req.body?.clientId === "string" ? req.body.clientId : undefined,
      role,
      text,
      error: Boolean(req.body?.error),
    });
    res.json({ session: getChatSession(db, sessionId), message });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "append message failed",
    });
  }
});

app.delete("/sessions/:id", (req, res) => {
  const ok = deleteChatSession(db, String(req.params.id));
  if (!ok) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({ ok: true });
});

const INBOX_PROJECTS = new Set<InboxProjectSlug>(["atlas", "vocallearn", "career"]);

app.get("/inbox/list", (req, res) => {
  const project = (req.query.project as InboxProjectSlug | undefined) ?? "atlas";
  if (!INBOX_PROJECTS.has(project)) {
    res.status(400).json({ error: "project must be atlas, vocallearn, or career" });
    return;
  }
  try {
    const files = listInboxArtifacts(registry, project);
    res.json({ project, files });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "inbox list failed",
    });
  }
});

app.post("/inbox", (req, res) => {
  const project = req.body?.project as InboxProjectSlug | undefined;
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();

  if (!project || !INBOX_PROJECTS.has(project)) {
    res.status(400).json({ error: "project must be atlas, vocallearn, or career" });
    return;
  }
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }

  try {
    const result = writeInboxArtifact(registry, {
      project,
      title,
      body,
      sessionId:
        typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : undefined,
      analystJobId:
        typeof req.body?.analystJobId === "string" ? req.body.analystJobId.trim() : undefined,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "inbox write failed",
    });
  }
});

/** Build inbox markdown from a saved chat session (Phase 1.75 handoff). */
app.post("/inbox/from-session", (req, res) => {
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const project = req.body?.project as InboxProjectSlug | undefined;
  const title = String(req.body?.title ?? "").trim();
  const extraBody = String(req.body?.extraBody ?? "").trim();

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  if (!project || !INBOX_PROJECTS.has(project)) {
    res.status(400).json({ error: "project must be atlas, vocallearn, or career" });
    return;
  }

  const session = getChatSession(db, sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const messages = listChatMessages(db, sessionId);
  const transcript = messages
    .map((m) => `**${m.role === "user" ? "You" : "Atlas"}:** ${m.text.trim()}`)
    .join("\n\n");

  const body = [
    "## Summary",
    title || session.title,
    "",
    "## Conversation",
    transcript,
    extraBody ? `\n## Notes\n${extraBody}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = writeInboxArtifact(registry, {
      project,
      title: title || session.title || "Atlas session",
      body,
      sessionId,
    });
    res.json({ ...result, messageCount: messages.length });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "inbox write failed",
    });
  }
});

app.post("/analyst/run", (req, res) => {
  const project = String(req.body?.project ?? "").trim();
  const focus = String(req.body?.focus ?? req.body?.userIntent ?? "").trim();
  const userIntent = String(req.body?.userIntent ?? focus).trim();
  const deep = Boolean(req.body?.deep);

  if (!project || !focus) {
    res.status(400).json({ error: "project and focus are required" });
    return;
  }

  try {
    const { jobId, project: resolved } = enqueueAnalystJob(analystDeps, {
      project,
      focus,
      userIntent,
      deep,
    });
    res.json({ jobId, project: resolved, status: "queued" });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "analyst enqueue failed",
    });
  }
});

app.get("/analyst/jobs/:id", (req, res) => {
  const job = getAnalystJob(db, String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  res.json({ job });
});

const httpServer = http.createServer(app);
attachSttProxy(httpServer);
attachRealtimeProxy(httpServer, analystDeps);

httpServer.listen(port, host, () => {
  const stt = getSttSessionConfig();
  console.log(`Atlas server listening on ${publicUrl} (bind ${host}:${port})`);
  console.log(
    stt.enabled
      ? `STT proxy enabled at ws://${host}:${port}${stt.wsPath}`
      : "STT proxy disabled (set XAI_API_KEY to enable)",
  );
  console.log(
    realtimeProxyEnabled()
      ? `Realtime proxy enabled at ws://${host}:${port}${getRealtimeProxyPath()}`
      : "Realtime proxy disabled (set XAI_API_KEY to enable)",
  );

  seedSpeakerProfiles(db);

  // Boot-time scan — refresh cache when git HEAD changes or no reports yet
  const active = getActiveProjects(registry);
  const snapshots = syncProjectsToDb(db, active, { deep: false });
  const stale = projectsNeedingRefresh(db, snapshots);
  const toStore = getLatestReports(db).length ? stale : snapshots;
  if (toStore.length) {
    for (const snap of toStore) {
      storeProjectReport(db, snap, stale.length ? "boot-refresh" : "boot");
    }
    console.log(`Cached ${toStore.length} project report(s) (git HEAD refresh)`);
  }

  startMorningBriefScheduler(analystDeps);
  startManagerScheduler(analystDeps);
});
