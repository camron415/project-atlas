import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import { searchContext } from "../context/search.js";
import { buildContextManifest } from "../reports/store.js";
import { responsesCompletion } from "../xai/responses.js";
import { AtlasModels } from "../models/router.js";
import { enqueueAnalystJob, type AnalystRunDeps } from "../analyst/run.js";
import { simplifyAnalystBrief } from "../analyst/focus.js";
import { getAnalystJob } from "../analyst/store.js";
import { waitForAnalystJob } from "../analyst/wait.js";
import { listChatMessages } from "../sessions/store.js";
import { writeInboxArtifact } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import type { ToolDefinition } from "../xai/client.js";

export const VOICE_CHIEF_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_context",
      description:
        "Search cached project reports, inbox markdown, and key docs (README, roadmap). Call before answering repo or project questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms — project name, feature, file, topic" },
          limit: { type: "number", description: "Max hits (default 8)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_lookup",
      description:
        "Live web search for weather, news, current events, or facts not in cached context. 10 second timeout.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look up online" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_analyst",
      description:
        "Enqueue a read-only analyst codebase review. ONLY call with confirmed=true after Camron explicitly says yes/proceed/go ahead.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", enum: ["atlas", "vocallearn", "career"] },
          focus: { type: "string", description: "Precise technical focus for the review" },
          user_intent_summary: { type: "string", description: "Plain English restatement of the request" },
          deep: { type: "boolean", description: "Fresh deep scan (slower)" },
          confirmed: { type: "boolean", description: "Must be true after explicit confirmation" },
        },
        required: ["project", "focus", "user_intent_summary", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_inbox",
      description:
        "Save session summary to project inbox markdown. ONLY call with confirmed=true after Camron explicitly confirms.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", enum: ["atlas", "vocallearn", "career"] },
          title: { type: "string" },
          summary: { type: "string", description: "Chief narrative of the conversation" },
          action_items: { type: "array", items: { type: "string" } },
          session_id: { type: "string" },
          analyst_job_id: { type: "string" },
          confirmed: { type: "boolean", description: "Must be true after explicit confirmation" },
        },
        required: ["project", "title", "summary", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_email",
      description: "Check email inbox for new messages (FT3 stub — not wired yet).",
      parameters: {
        type: "object",
        properties: {
          account: { type: "string", description: "Optional account label" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dispatch_worker",
      description: "Dispatch a background project worker (FT3 stub — not wired yet).",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          worker_id: { type: "string" },
          task: { type: "string" },
        },
        required: ["project", "worker_id"],
      },
    },
  },
];

export interface VoiceToolContext {
  db: Database.Database;
  registry: ProjectRegistry;
  dataDir: string;
  chatSessionId?: string;
  onAnalyst?: (payload: Record<string, unknown>) => void;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function inboxProject(value: unknown): InboxProjectSlug | null {
  if (value === "atlas" || value === "vocallearn" || value === "career") return value;
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function runWebLookupQuery(query: string): Promise<string> {
  return responsesCompletion(
    [
      {
        role: "system",
        content:
          "You are a web research assistant. Search and return concise factual bullets Camron can hear in voice. Name the specific event, teams, and date when answering sports questions.",
      },
      { role: "user", content: query },
    ],
    {
      model: AtlasModels.fast(),
      maxOutputTokens: 600,
      tools: [{ type: "web_search" }],
      task: "web_lookup",
    },
  );
}

async function webLookup(query: string): Promise<string> {
  const attempts = 2;
  let lastError: string | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await withTimeout(
        runWebLookupQuery(query),
        18_000,
        "web_lookup",
      );
      return JSON.stringify({ ok: true, query, result: text });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "web_lookup failed";
      if (i + 1 < attempts) continue;
    }
  }
  return JSON.stringify({ ok: false, error: lastError ?? "web_lookup failed" });
}

export async function executeVoiceTool(
  name: string,
  argsJson: string,
  ctx: VoiceToolContext,
): Promise<string> {
  const args = parseArgs(argsJson);
  const deps: AnalystRunDeps = {
    db: ctx.db,
    registry: ctx.registry,
    dataDir: ctx.dataDir,
  };

  if (name === "search_context") {
    const query = String(args.query ?? "").trim();
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 12) : 8;
    const hits = searchContext(ctx.db, ctx.registry, query, limit);
    const manifest = buildContextManifest(ctx.db)
      .map(
        (m) =>
          `${m.name} (${m.projectSlug}): docs=${m.docsFound.length}; deepScan=${m.deepScan}; files=${m.totalFiles ?? "?"}`,
      )
      .join("\n");
    return JSON.stringify({
      ok: true,
      query,
      manifest,
      hits: hits.map((h) => ({
        source: h.source,
        path: h.path,
        snippet: h.snippet,
      })),
      instruction: hits.length
        ? "Answer from these snippets; cite source paths when helpful."
        : "No cached hits. If this is not purely about repo code, call web_lookup next with a specific query before answering.",
    });
  }

  if (name === "web_lookup") {
    const query = String(args.query ?? "").trim();
    if (!query) return JSON.stringify({ ok: false, error: "query required" });
    return webLookup(query);
  }

  if (name === "dispatch_analyst") {
    if (args.confirmed !== true) {
      return JSON.stringify({
        ok: false,
        error: "confirmation_required",
        message:
          "Ask Camron to confirm first — e.g. 'Shall I dispatch the analyst to review Atlas, sir?'",
      });
    }

    const project = String(args.project ?? "");
    const focus = String(args.focus ?? "").trim();
    const userIntent = String(args.user_intent_summary ?? focus).trim();
    const deep = args.deep !== false;

    const { jobId, project: resolved } = enqueueAnalystJob(deps, {
      project,
      focus,
      userIntent,
      deep,
    });

    ctx.onAnalyst?.({
      type: "voice.analyst",
      status: "running",
      jobId,
      project: resolved,
    });

    const job = await waitForAnalystJob(ctx.db, jobId);
    if (!job) {
      return JSON.stringify({ ok: false, error: "job_not_found", job_id: jobId });
    }
    if (job.status === "error") {
      ctx.onAnalyst?.({ type: "voice.analyst", status: "error", jobId, error: job.error });
      return JSON.stringify({ ok: false, job_id: jobId, error: job.error });
    }

    const voiceBrief = await simplifyAnalystBrief(job.summaryMarkdown ?? "");
    ctx.onAnalyst?.({ type: "voice.analyst", status: "done", jobId, project: resolved });

    return JSON.stringify({
      ok: true,
      job_id: jobId,
      project: resolved,
      voice_brief: voiceBrief,
      instruction: "Present voice_brief in plain English. Keep ~4-6 sentences unless asked to go deeper.",
    });
  }

  if (name === "write_inbox") {
    if (args.confirmed !== true) {
      return JSON.stringify({
        ok: false,
        error: "confirmation_required",
        message: "Ask Camron to confirm before saving to inbox.",
      });
    }

    const project = inboxProject(args.project);
    if (!project) return JSON.stringify({ ok: false, error: "invalid_project" });

    const title = String(args.title ?? "Atlas planning session").trim();
    const summary = String(args.summary ?? "").trim();
    const actionItems = Array.isArray(args.action_items)
      ? args.action_items.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const sessionId =
      typeof args.session_id === "string"
        ? args.session_id.trim()
        : ctx.chatSessionId?.trim();
    const analystJobId =
      typeof args.analyst_job_id === "string" ? args.analyst_job_id.trim() : undefined;

    let analystSection = "_No analyst review this session._";
    if (analystJobId) {
      const job = getAnalystJob(ctx.db, analystJobId);
      if (job?.summaryMarkdown) analystSection = job.summaryMarkdown;
    }

    let conversationSection = "";
    if (sessionId) {
      const messages = listChatMessages(ctx.db, sessionId);
      if (messages.length) {
        conversationSection = messages
          .map((m) => `**${m.role === "user" ? "You" : "Atlas"}:** ${m.text.trim()}`)
          .join("\n\n");
      }
    }

    const body = [
      "## Summary",
      summary,
      "",
      "## Analyst findings",
      analystSection,
      "",
      "## Agreed next steps",
      actionItems.length
        ? actionItems.map((item) => `- [ ] ${item}`).join("\n")
        : "- [ ] _None recorded_",
      "",
      conversationSection ? `## Conversation\n${conversationSection}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = writeInboxArtifact(ctx.registry, {
      project,
      title,
      body,
      sessionId,
      analystJobId,
    }, ctx.db);

    return JSON.stringify({
      ok: true,
      path: result.path,
      message: `Inbox saved at ${result.path}. Tell Camron briefly.`,
    });
  }

  if (name === "check_email") {
    return JSON.stringify({
      ok: false,
      wired: false,
      ft3: true,
      message:
        "Email check is not wired for field test 3. Tell Camron honestly — no inbox polling yet.",
    });
  }

  if (name === "dispatch_worker") {
    return JSON.stringify({
      ok: false,
      wired: false,
      ft3: true,
      project: args.project ?? null,
      worker_id: args.worker_id ?? null,
      message:
        "Background workers are not wired for field test 3. Offer analyst review or inbox save instead.",
    });
  }

  return JSON.stringify({ ok: false, error: `unknown_tool:${name}` });
}
