import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { chatCompletion } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";
import type { ProjectRegistry } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";
import { syncProjectsToDb } from "../projects/scanner.js";
import {
  getLatestReportForProject,
  storeProjectReport,
} from "../reports/store.js";
import { synthesizeProjectReport } from "../reports/synthesize.js";
import { registrySlugForAnalyst, resolveAnalystProject } from "./registry-slugs.js";
import { refineAnalystFocus } from "./focus.js";
import { createAnalystJob, getAnalystJob, updateAnalystJob } from "./store.js";
import type { InboxProjectSlug } from "../inbox/types.js";

export interface AnalystRunInput {
  project: string;
  focus?: string;
  userIntent?: string;
  deep?: boolean;
}

export interface AnalystRunDeps {
  db: Database.Database;
  registry: ProjectRegistry;
  dataDir: string;
}

function projectDisplayName(registry: ProjectRegistry, registrySlug: string): string {
  return (
    registry.projects.find((p) => p.slug === registrySlug)?.name ?? registrySlug
  );
}

async function ensureReport(
  deps: AnalystRunDeps,
  registrySlug: string,
  deep: boolean,
): Promise<string> {
  const { db, registry } = deps;
  let report = getLatestReportForProject(db, registrySlug);

  if (report && !deep) {
    return report.summary;
  }

  const active = getActiveProjects(registry).filter((p) => p.slug === registrySlug);
  if (!active.length) {
    throw new Error(`Project not found in registry: ${registrySlug}`);
  }

  const snapshots = syncProjectsToDb(db, active, { deep });
  for (const snap of snapshots) {
    let enriched = snap;
    if (deep && enriched.codeInventory && process.env.XAI_API_KEY) {
      const llmSummary = await synthesizeProjectReport(enriched);
      if (llmSummary) enriched = { ...enriched, llmSummary };
    }
    storeProjectReport(db, enriched, deep ? "deep-scan" : "analyst-refresh");
  }

  report = getLatestReportForProject(db, registrySlug);
  if (!report) {
    throw new Error(`No report available for ${registrySlug}`);
  }
  return report.summary;
}

async function synthesizeAnalystBrief(
  projectName: string,
  focus: string,
  reportContext: string,
): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    return `## ${projectName} — ${focus}\n\n_Report synthesis unavailable (no API key)._`;
  }

  const prompt = `You are a read-only technical analyst. Produce a structured briefing for a chief-of-staff voice discussion.

Project: ${projectName}
Focus: ${focus}

Output markdown with these sections only:
## Headline (one sentence)
## Key findings (3-5 bullets, grounded in context)
## Risks or gaps
## Suggested next steps (3-5 actionable items)

Rules:
- Read-only analysis only — no code changes proposed as commands
- Only state facts supported by the context below
- If context is shallow, say what a deeper scan would need

## Cached project context
${reportContext.slice(0, 24_000)}`;

  return chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a concise technical analyst. Be specific. No fluff. Markdown only.",
      },
      { role: "user", content: prompt },
    ],
    { model: AtlasModels.analyst(), temperature: 0.3, maxTokens: 1200 },
  );
}

export async function runAnalystJob(
  deps: AnalystRunDeps,
  jobId: string,
): Promise<void> {
  const job = getAnalystJob(deps.db, jobId);
  if (!job) return;

  try {
    updateAnalystJob(deps.db, jobId, {
      status: "running",
      progress: "Loading project context",
    });

    const analystProject = resolveAnalystProject(job.projectSlug);
    if (!analystProject) {
      throw new Error(`Unknown project: ${job.projectSlug}`);
    }

    const registrySlug = registrySlugForAnalyst(analystProject);
    const projectName = projectDisplayName(deps.registry, registrySlug);

    const focus = await refineAnalystFocus(
      job.focus || job.userIntent || "General review",
      projectName,
    );

    updateAnalystJob(deps.db, jobId, {
      progress: job.deep ? "Running deep scan" : "Reading cached report",
    });

    const reportContext = await ensureReport(deps, registrySlug, Boolean(job.deep));

    updateAnalystJob(deps.db, jobId, { progress: "Synthesizing analyst brief" });

    const summaryMarkdown = await synthesizeAnalystBrief(
      projectName,
      focus,
      reportContext,
    );

    const analystDir = path.join(deps.dataDir, "analyst");
    fs.mkdirSync(analystDir, { recursive: true });
    fs.writeFileSync(path.join(analystDir, `${jobId}.md`), summaryMarkdown, "utf8");

    updateAnalystJob(deps.db, jobId, {
      status: "done",
      progress: "Complete",
      summaryMarkdown,
    });
  } catch (error) {
    updateAnalystJob(deps.db, jobId, {
      status: "error",
      progress: "Failed",
      error: error instanceof Error ? error.message : "analyst job failed",
    });
  }
}

export function enqueueAnalystJob(
  deps: AnalystRunDeps,
  input: AnalystRunInput,
): { jobId: string; project: InboxProjectSlug } {
  const project = resolveAnalystProject(input.project);
  if (!project) {
    throw new Error(`Unknown project "${input.project}" — use atlas, vocallearn, or career`);
  }

  const registrySlug = registrySlugForAnalyst(project);
  const focus = input.focus?.trim() || input.userIntent?.trim() || "General project review";

  const job = createAnalystJob(deps.db, {
    projectSlug: project,
    focus,
    userIntent: input.userIntent,
    deep: input.deep,
  });

  void runAnalystJob(deps, job.id);

  return { jobId: job.id, project };
}
