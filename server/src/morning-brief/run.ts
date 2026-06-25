import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { enqueueAnalystJob, type AnalystRunDeps } from "../analyst/run.js";
import { waitForAnalystJob } from "../analyst/wait.js";
import { resolveAnalystProject } from "../analyst/registry-slugs.js";
import { writeInboxArtifact, resolveInboxDir } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";

const MORNING_TITLE = "Morning";
const MORNING_FOCUS =
  "Morning briefing: overnight git activity, open risks, blockers, and the top 3 priorities for today.";

export function parseMorningBriefProjects(
  raw = process.env.ATLAS_MORNING_BRIEF_PROJECTS ?? "atlas",
): InboxProjectSlug[] {
  const projects: InboxProjectSlug[] = [];
  for (const token of raw.split(",")) {
    const project = resolveAnalystProject(token.trim());
    if (project && !projects.includes(project)) projects.push(project);
  }
  return projects.length ? projects : ["atlas"];
}

export function morningBriefFilenameForToday(): string {
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `${datePrefix}-morning.md`;
}

export function morningBriefExistsForToday(
  deps: AnalystRunDeps,
  project: InboxProjectSlug,
): boolean {
  const inboxDir = resolveInboxDir(project, deps.registry);
  return fs.existsSync(path.join(inboxDir, morningBriefFilenameForToday()));
}

export interface MorningBriefResult {
  project: InboxProjectSlug;
  ok: boolean;
  path?: string;
  skipped?: boolean;
  error?: string;
  analystJobId?: string;
}

export async function runMorningBriefForProject(
  deps: AnalystRunDeps,
  project: InboxProjectSlug,
  options?: { force?: boolean },
): Promise<MorningBriefResult> {
  if (!options?.force && morningBriefExistsForToday(deps, project)) {
    return { project, ok: true, skipped: true };
  }

  try {
    const { jobId } = enqueueAnalystJob(deps, {
      project,
      focus: MORNING_FOCUS,
      userIntent: MORNING_FOCUS,
      deep: true,
    });

    const job = await waitForAnalystJob(deps.db, jobId, 180_000);
    if (!job || job.status !== "done" || !job.summaryMarkdown?.trim()) {
      return {
        project,
        ok: false,
        analystJobId: jobId,
        error: job?.error ?? "analyst job did not complete",
      };
    }

    const body = [
      "## Summary",
      `Automated morning scan for **${project}** (${new Date().toLocaleString()}).`,
      "",
      "## Analyst findings",
      job.summaryMarkdown.trim(),
      "",
      "## Agreed next steps",
      "- [ ] Review this brief in a morning voice session",
    ].join("\n");

    const written = writeInboxArtifact(deps.registry, {
      project,
      title: MORNING_TITLE,
      body,
      analystJobId: jobId,
    });

    return {
      project,
      ok: true,
      path: written.path,
      analystJobId: jobId,
    };
  } catch (error) {
    return {
      project,
      ok: false,
      error: error instanceof Error ? error.message : "morning brief failed",
    };
  }
}

export async function runMorningBrief(
  deps: AnalystRunDeps,
  projects = parseMorningBriefProjects(),
  options?: { force?: boolean },
): Promise<MorningBriefResult[]> {
  const results: MorningBriefResult[] = [];
  for (const project of projects) {
    results.push(await runMorningBriefForProject(deps, project, options));
  }
  return results;
}
