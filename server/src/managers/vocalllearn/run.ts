import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { enqueueAnalystJob } from "../../analyst/run.js";
import { waitForAnalystJob } from "../../analyst/wait.js";
import { writeInboxArtifact } from "../../inbox/store.js";
import { getGitRecentContext } from "../../projects/git-context.js";
import type { ManagerRunDeps, ManagerRunResult } from "../types.js";
import {
  findRegistryProject,
  readRoadmapExcerpt,
  standupPrepExistsForToday,
} from "../projects.js";

const SLOANE = "Sloane";
const VOCALLEARN_MANAGER_FOCUS =
  "VocalLearn standup prep for Sloane (department lead): roadmap IDs vs HANDOFF, overnight git, concerns, top 3 priorities today with P0-P3 and S0-S3 tags, decisions needed with 1-day default approval window, auto-queue for S0/S1. Professional and concise.";

const STANDUP_PREP_TITLE = "Standup prep";

function tryRunTests(projectPath: string): string {
  if (process.env.ATLAS_MANAGER_RUN_TESTS !== "1") {
    return "_Tests not run (set ATLAS_MANAGER_RUN_TESTS=1 to enable)._";
  }
  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return "_No package.json — tests skipped._";
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.test) {
      return "_No npm test script — skipped._";
    }
    execSync("npm test -- --passWithNoTests 2>&1", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90_000,
      maxBuffer: 8_000,
    });
    return "npm test: **passed** (or passWithNoTests)";
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `npm test: **failed or timed out**\n\n\`\`\`\n${msg.slice(0, 2000)}\n\`\`\``;
  }
}

function detectSkip(gitBlock: string, analystMd: string): boolean {
  const noGit = /HEAD: unavailable/i.test(gitBlock) && !/Recent commits/i.test(gitBlock);
  const quiet = /no material|nothing to report|no changes/i.test(analystMd);
  return noGit && quiet;
}

export async function runVocalLearnManager(
  deps: ManagerRunDeps,
  options?: { force?: boolean },
): Promise<ManagerRunResult> {
  const project = "vocallearn" as const;
  const entry = findRegistryProject(deps.registry, project);
  if (!entry?.path) {
    return {
      project,
      ok: false,
      error: "VocalLearn path missing in projects.registry.json",
    };
  }

  if (!options?.force && standupPrepExistsForToday(deps.registry, project)) {
    return { project, ok: true, skipped: true };
  }

  try {
    const gitBlock = getGitRecentContext(entry.path);
    const roadmapBlock = readRoadmapExcerpt(entry);
    const testBlock = tryRunTests(entry.path);

    const { jobId } = enqueueAnalystJob(deps, {
      project,
      focus: VOCALLEARN_MANAGER_FOCUS,
      userIntent: VOCALLEARN_MANAGER_FOCUS,
      deep: true,
    });

    const job = await waitForAnalystJob(deps.db, jobId, 240_000);
    if (!job || job.status !== "done" || !job.summaryMarkdown?.trim()) {
      return {
        project,
        ok: false,
        analystJobId: jobId,
        error: job?.error ?? "analyst job did not complete",
      };
    }

    const analystMd = job.summaryMarkdown.trim();
    const standupMode = detectSkip(gitBlock, analystMd) ? "skip" : "active";

    const body = [
      `# Standup prep — VocalLearn`,
      `**Date:** ${new Date().toISOString()} · **Manager:** ${SLOANE}`,
      "",
      `standup: ${standupMode}`,
      "",
      "## Since yesterday",
      "_See git snapshot and analyst findings._",
      "",
      "## Git snapshot",
      gitBlock,
      "",
      "## Roadmap excerpt",
      roadmapBlock,
      "",
      "## Test status",
      testBlock,
      "",
      "## Analyst findings",
      analystMd,
      "",
      "## Proposed today (P / S)",
      "1. _(Manager: list max 3 with P1–P3 and S0–S3 from analyst context)_",
      "",
      "## Decisions for Camron",
      "1. _(If none: write \"None today\" — default approval window 1 day when listed)_",
      "",
      "## Auto queue (S0/S1)",
      "- _(Tasks that need no standup approval)_",
    ].join("\n");

    const written = writeInboxArtifact(deps.registry, {
      project,
      title: STANDUP_PREP_TITLE,
      body,
      analystJobId: jobId,
    }, deps.db);

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
      error: error instanceof Error ? error.message : "manager run failed",
    };
  }
}
