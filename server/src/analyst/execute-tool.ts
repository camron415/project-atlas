import type Database from "better-sqlite3";
import type { WebSocket } from "ws";
import type { ProjectRegistry } from "../projects/registry.js";
import { listChatMessages } from "../sessions/store.js";
import { writeInboxArtifact } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import { simplifyAnalystBrief } from "./focus.js";
import { enqueueAnalystJob, type AnalystRunDeps } from "./run.js";
import { getAnalystJob } from "./store.js";

export interface ToolExecuteContext {
  db: Database.Database;
  registry: ProjectRegistry;
  dataDir: string;
  clientWs: WebSocket;
  notifyAnalyst?: (payload: Record<string, unknown>) => void;
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

async function waitForAnalystDone(
  ctx: ToolExecuteContext,
  jobId: string,
  maxMs = 120_000,
): Promise<ReturnType<typeof getAnalystJob>> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const job = getAnalystJob(ctx.db, jobId);
    if (!job) return null;
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return getAnalystJob(ctx.db, jobId);
}

export async function executeAnalystTool(
  name: string,
  argsJson: string,
  ctx: ToolExecuteContext,
): Promise<string> {
  const args = parseArgs(argsJson);
  const deps: AnalystRunDeps = {
    db: ctx.db,
    registry: ctx.registry,
    dataDir: ctx.dataDir,
  };

  if (name === "request_analyst_review") {
    if (args.confirmed !== true) {
      return JSON.stringify({
        ok: false,
        error: "confirmation_required",
        message:
          "Ask Camron to confirm first — e.g. 'Shall I dispatch the analyst to review VocalLearn, sir?'",
      });
    }

    const project = String(args.project ?? "");
    const focus = String(args.focus ?? "").trim();
    const userIntent = String(args.user_intent_summary ?? focus).trim();
    const deep = Boolean(args.deep);

    const { jobId, project: resolved } = enqueueAnalystJob(deps, {
      project,
      focus,
      userIntent,
      deep,
    });

    ctx.notifyAnalyst?.({
      type: "proxy.analyst",
      status: "running",
      jobId,
      project: resolved,
      deep,
    });

    const job = await waitForAnalystDone(ctx, jobId);
    if (!job) {
      return JSON.stringify({ ok: false, error: "job_not_found", job_id: jobId });
    }

    if (job.status === "error") {
      ctx.notifyAnalyst?.({ type: "proxy.analyst", status: "error", jobId, error: job.error });
      return JSON.stringify({ ok: false, job_id: jobId, error: job.error });
    }

    const voiceBrief = await simplifyAnalystBrief(job.summaryMarkdown ?? "");
    ctx.notifyAnalyst?.({ type: "proxy.analyst", status: "done", jobId, project: resolved });

    return JSON.stringify({
      ok: true,
      job_id: jobId,
      project: resolved,
      focus: job.focus,
      status: job.status,
      voice_brief: voiceBrief,
      full_markdown: job.summaryMarkdown,
      instruction:
        "Present voice_brief to Camron in plain English. Offer to repeat simpler or go deeper. Keep Jarvis tone.",
    });
  }

  if (name === "get_analyst_status") {
    const jobId = String(args.job_id ?? "").trim();
    const job = getAnalystJob(ctx.db, jobId);
    if (!job) {
      return JSON.stringify({ ok: false, error: "job_not_found" });
    }
    const voiceBrief =
      job.status === "done" && job.summaryMarkdown
        ? await simplifyAnalystBrief(job.summaryMarkdown)
        : undefined;
    return JSON.stringify({
      ok: true,
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      voice_brief: voiceBrief,
      full_markdown: job.summaryMarkdown,
    });
  }

  if (name === "write_inbox_summary") {
    const project = inboxProject(args.project);
    if (!project) {
      return JSON.stringify({ ok: false, error: "invalid_project" });
    }

    const title = String(args.title ?? "Atlas planning session").trim();
    const summary = String(args.summary ?? "").trim();
    const actionItems = Array.isArray(args.action_items)
      ? args.action_items.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const sessionId =
      typeof args.session_id === "string" ? args.session_id.trim() : undefined;
    const analystJobId =
      typeof args.analyst_job_id === "string" ? args.analyst_job_id.trim() : undefined;

    let analystSection = "_No analyst review this session._";
    if (analystJobId) {
      const job = getAnalystJob(ctx.db, analystJobId);
      if (job?.summaryMarkdown) {
        analystSection = job.summaryMarkdown;
      }
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
    });

    return JSON.stringify({
      ok: true,
      path: result.path,
      project: result.project,
      written_at: result.writtenAt,
      message: `Inbox file written. Tell Camron it is saved at ${result.path}.`,
    });
  }

  return JSON.stringify({ ok: false, error: `unknown_tool:${name}` });
}

export function sendFunctionOutput(
  upstream: WebSocket,
  callId: string,
  output: string,
): void {
  upstream.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    }),
  );
  upstream.send(JSON.stringify({ type: "response.create" }));
}
