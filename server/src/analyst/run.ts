import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { chatCompletion } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";
import type { ProjectRegistry } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";
import { storeProjectReport } from "../reports/store.js";
import { buildFreshAnalystContext } from "./context.js";
import { registrySlugForAnalyst, resolveAnalystProject } from "./registry-slugs.js";
import { refineAnalystFocus } from "./focus.js";
import { createAnalystJob, getAnalystJob, updateAnalystJob } from "./store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import { buildCodeInventory } from "../projects/code-inventory.js";
import { snapshotProject } from "../projects/scanner.js";
import { ANALYST_INVENTORY_OPTIONS } from "./context.js";

export interface AnalystRunInput {
  project: string;
  focus?: string;
  userIntent?: string;
  /** Analyst always deep-scans; set false only for debugging. */
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

function findRegistryProject(
  registry: ProjectRegistry,
  registrySlug: string,
): (typeof registry.projects)[number] | undefined {
  return registry.projects.find((p) => p.slug === registrySlug);
}

async function synthesizeAnalystBrief(
  projectName: string,
  focus: string,
  reportContext: string,
): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    return `## ${projectName} — ${focus}\n\n_Report synthesis unavailable (no API key)._`;
  }

  const prompt = `You are a read-only technical analyst with full codebase context below. Produce a structured briefing for a chief-of-staff voice discussion.

Project: ${projectName}
Focus: ${focus}

Output markdown with these sections only:
## Headline (one sentence)
## Key findings (3-5 bullets — cite specific files or recent git commits when possible)
## Risks or gaps (concrete, with file paths if known)
## Suggested next steps (3-5 actionable items for a planning session — no code execution)

Rules:
- Read-only analysis only
- Use "Git activity" and "Recent commits" to describe what changed lately
- Use "Canonical docs" and "Priority implementation files" for phase/status truth
- If PHASE_1_75.md shows implemented steps checked off, say Phase 1.75 is active — do not claim it is missing
- Cite real file paths and examples from source excerpts when recommending fixes
- If uncertain, say what file you would inspect next

## Full analyst context
${reportContext.slice(0, 88_000)}`;

  return chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a precise technical analyst. Ground every claim in the provided context. Markdown only.",
      },
      { role: "user", content: prompt },
    ],
    { model: AtlasModels.analyst(), temperature: 0.25, maxTokens: 1600, task: "analyst" },
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
    const project = findRegistryProject(deps.registry, registrySlug);
    if (!project?.path) {
      throw new Error(`Project not found in registry: ${registrySlug}`);
    }

    const projectName = projectDisplayName(deps.registry, registrySlug);

    const focus = await refineAnalystFocus(
      job.focus || job.userIntent || "General review",
      projectName,
    );

    updateAnalystJob(deps.db, jobId, {
      progress: "Deep scanning repo + git history",
    });

    const reportContext = await buildFreshAnalystContext(deps.db, project);

    // Refresh SQLite cache so chief path also benefits
    const snap = snapshotProject(project, { deep: false });
    if (snap) {
      storeProjectReport(
        deps.db,
        {
          ...snap,
          codeInventory: buildCodeInventory(project.path, ANALYST_INVENTORY_OPTIONS),
        },
        "analyst-deep",
      );
    }

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

  const focus = input.focus?.trim() || input.userIntent?.trim() || "General project review";

  const job = createAnalystJob(deps.db, {
    projectSlug: project,
    focus,
    userIntent: input.userIntent,
    deep: input.deep !== false,
  });

  void runAnalystJob(deps, job.id);

  return { jobId: job.id, project };
}
