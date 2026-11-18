import fs from "node:fs";
import path from "node:path";
import { writeInboxArtifact } from "../../inbox/store.js";
import { getGitRecentContext } from "../../projects/git-context.js";
import {
  formatAppliedBlock,
  formatClosedBlock,
  formatFocusBlock,
  appliedCompanySet,
} from "../../career/applied-roles.js";
import {
  readLatestApplyReport,
  runCareerNightlyPipeline,
} from "../../career/nightly-pipeline.js";
import type { ManagerRunDeps, ManagerRunResult } from "../types.js";
import {
  findRegistryProject,
  readRoadmapExcerpt,
  standupPrepExistsForToday,
} from "../projects.js";
import { synthesizeStandupPrepSections } from "../synthesize-prep.js";
import { chatCompletion } from "../../xai/client.js";
import { AtlasModels } from "../../models/router.js";

const ELLIS = "Ellis";
const STANDUP_PREP_TITLE = "Standup prep";

function readCareerHints(projectPath: string): string {
  const hints: string[] = [];
  const candidates = [
    "inbox/apply-report-latest.md",
    "docs/CAREER_PROJECT_SYNC.md",
    "docs/HAUL_AUG13.md",
    "docs/CATEGORY_A_LOCAL_BRIEF.md",
    "docs/APPLY_WEEK.md",
    "docs/APPLY_RESEARCH.md",
    "docs/OPPORTUNITY_RESEARCH.md",
    "docs/MY_STORY.md",
    "inbox/linkedin-haul.md",
  ];
  for (const rel of candidates) {
    const full = path.join(projectPath, rel);
    try {
      if (!fs.existsSync(full)) continue;
      hints.push(`### ${rel}\n\n${fs.readFileSync(full, "utf8").slice(0, 4500)}`);
    } catch {
      /* skip */
    }
  }
  return hints.join("\n\n") || "_No career docs found._";
}

async function proposeBoardPulse(input: {
  docs: string;
  appliedBlock: string;
  closedBlock: string;
  focusBlock: string;
  applyReport: string;
}): Promise<string> {
  return chatCompletion(
    [
      {
        role: "system",
        content: `You are Ellis, Camron's career manager. Write a SHORT "board pulse" for a morning phone / apply standup.
Prefer Camron's CURRENT APPLY QUEUE over the auto report when it is set.
Prefer the DAILY APPLY REPORT over older APPLY_WEEK docs when they conflict.

Output markdown with EXACTLY these headings:

## Board pulse (speak)
- Still prioritize (max 4 company+role) — NEVER include already-applied or closed listings:
- Likely gone / verify (max 3):
- New today from overnight ingest (max 4, from "New today" section if present):
- Already filed (one short line):

Rules:
- Speech-ready. No URLs aloud in this section (URLs live in the Mac report).
- If a current apply queue is set, "Still prioritize" MUST be those targets in order.
- Closed / not-accepting companies must go under "Likely gone", never "Still prioritize".
- Keep under ~130 words.`,
      },
      {
        role: "user",
        content: `### Camron's current apply queue (source of truth for "still prioritize")\n${input.focusBlock}\n\n### Already applied\n${input.appliedBlock}\n\n### Closed / not accepting\n${input.closedBlock}\n\n### Daily apply report\n${input.applyReport.slice(0, 8000)}\n\n### Other career docs\n${input.docs.slice(0, 6000)}`,
      },
    ],
    { model: AtlasModels.fast(), maxTokens: 550, task: "career-manager-board-pulse" },
  );
}

async function proposeNextApply(input: {
  docs: string;
  appliedBlock: string;
  closedBlock: string;
  focusBlock: string;
  applyReport: string;
}): Promise<string> {
  return chatCompletion(
    [
      {
        role: "system",
        content: `You are Ellis, Camron's career manager. Propose ONE next junior software application for today.
If a current apply queue is set, the candidate MUST be the first item in that queue.
Exclude already-applied companies AND closed / not-accepting listings.
Write for SPEECH — no file paths.

Output markdown:
## Today's apply candidate
- Company:
- Role:
- Why fit (1 short spoken sentence):
- Apply URL: (copy from queue or report if present)
- Ask Camron: confirm to generate packet, skip, or name a different company
- Status: ready-to-prep | needs-research | skip-today

If nothing sensible: Status: skip-today and one plain sentence why.`,
      },
      {
        role: "user",
        content: `### Camron's current apply queue (use item 1 as today's candidate)\n${input.focusBlock}\n\n### Already applied (DO NOT re-propose)\n${input.appliedBlock}\n\n### Closed / not accepting (DO NOT re-propose)\n${input.closedBlock}\n\n### Daily apply report\n${input.applyReport.slice(0, 8000)}\n\n### Other docs\n${input.docs.slice(0, 6000)}`,
      },
    ],
    { model: AtlasModels.fast(), maxTokens: 700, task: "career-manager-apply" },
  );
}

export async function runCareerManager(
  deps: ManagerRunDeps,
  options?: { force?: boolean },
): Promise<ManagerRunResult> {
  const project = "career" as const;
  const entry = findRegistryProject(deps.registry, project);
  if (!entry?.path) {
    return {
      project,
      ok: false,
      error: "Career dashboard path missing in projects.registry.json",
    };
  }

  if (!options?.force && standupPrepExistsForToday(deps.registry, project)) {
    return { project, ok: true, skipped: true };
  }

  try {
    const nightly = runCareerNightlyPipeline({
      careerPath: entry.path,
      force: options?.force,
    });
    if (nightly.skipped) {
      console.log(`[manager] career ingest skipped (${nightly.error})`);
    } else if (!nightly.ok) {
      console.warn(`[manager] career nightly: ${nightly.error}`);
    } else {
      console.log(
        `[manager] career nightly ok in ${nightly.durationMs}ms → ${nightly.reportPath}`,
      );
    }

    const gitBlock = getGitRecentContext(entry.path);
    const roadmapBlock = readRoadmapExcerpt(entry);
    const appliedBlock = formatAppliedBlock(deps.dataDir);
    const closedBlock = formatClosedBlock(deps.dataDir);
    const focusBlock = formatFocusBlock(deps.dataDir);
    const applyReport =
      nightly.reportText ||
      readLatestApplyReport(entry.path) ||
      "_No apply report yet. Run ATLAS_CAREER_INGEST=1 or npm run daily:apply in career-dashboard._";
    const docs = readCareerHints(entry.path);
    const applied = appliedCompanySet(deps.dataDir);

    let applySection: string;
    let boardPulse: string;
    try {
      applySection = await proposeNextApply({
        docs,
        appliedBlock,
        closedBlock,
        focusBlock,
        applyReport,
      });
      for (const company of applied) {
        if (company && applySection.toLowerCase().includes(company.toLowerCase())) {
          applySection += `\n\n_Note: ${company} appears in applied list — treat as already filed unless Camron says otherwise._`;
          break;
        }
      }
    } catch (error) {
      applySection = `_Apply candidate synthesis failed: ${
        error instanceof Error ? error.message : String(error)
      }_`;
    }

    try {
      boardPulse = await proposeBoardPulse({
        docs,
        appliedBlock,
        closedBlock,
        focusBlock,
        applyReport,
      });
    } catch (error) {
      boardPulse = `## Board pulse (speak)\n- No board pulse today (${
        error instanceof Error ? error.message : String(error)
      }). Check inbox apply-report-latest.md on Mac.`;
    }

    let synth;
    try {
      synth = await synthesizeStandupPrepSections({
        projectLabel: "Career dashboard / job search",
        managerName: ELLIS,
        gitBlock,
        roadmapBlock,
        analystMd: `${applySection}\n\n${boardPulse}`,
        extraContext: `Current queue:\n${focusBlock}\n\nApplied roles:\n${appliedBlock}\n\nClosed listings:\n${closedBlock}\n\nApply report excerpt:\n${applyReport.slice(0, 4000)}`,
      });
    } catch {
      synth = {
        sinceYesterday: "_See daily apply report._",
        roadmapPosition:
          "Daily apply track: overnight ingest → morning report → packet → submit.",
        proposedToday:
          "1. Confirm today's apply candidate and generate packet — P1 — S3",
        decisions: "1. Confirm today's apply candidate or skip.",
        autoQueue: "None today",
        raw: "",
      };
    }

    const body = [
      `# Standup prep — Career`,
      `**Date:** ${new Date().toISOString()} · **Manager:** ${ELLIS}`,
      "",
      "standup: active",
      "",
      "## Closing item — applications filed",
      "If Camron says he applied to a role, confirm company + role, then it must be marked applied",
      "(CLI `npm run mark-applied` or `POST /agent/mark_applied`) so it drops off tomorrow's priority list.",
      "",
      "## Already applied (exclude from priority)",
      appliedBlock,
      "",
      "## Closed / not accepting (exclude)",
      closedBlock,
      "",
      "## Current apply queue (Camron — source of truth)",
      focusBlock,
      "",
      boardPulse,
      "",
      applySection,
      "",
      "## Since yesterday",
      synth.sinceYesterday,
      "",
      "## Roadmap position",
      synth.roadmapPosition,
      "",
      "## Proposed today (P / S)",
      synth.proposedToday,
      "",
      "## Decisions for Camron",
      synth.decisions,
      "",
      "## Auto queue (S0/S1)",
      synth.autoQueue,
      "",
      "## Mac only (do not read on phone)",
      "Technical detail for Cursor / later review. Phone brief strips this section.",
      "",
      "### Nightly ingest",
      nightly.skipped
        ? `_Skipped — ${nightly.error}_`
        : nightly.ok
          ? `_OK_ ${nightly.durationMs}ms → ${nightly.reportPath}`
          : `_Failed_ ${nightly.error}`,
      "",
      "### Daily apply report",
      applyReport.slice(0, 12_000),
      "",
      "### Git snapshot",
      gitBlock,
    ].join("\n");

    const written = writeInboxArtifact(
      deps.registry,
      {
        project,
        title: STANDUP_PREP_TITLE,
        body,
      },
      deps.db,
    );

    return { project, ok: true, path: written.path };
  } catch (error) {
    return {
      project,
      ok: false,
      error: error instanceof Error ? error.message : "career manager failed",
    };
  }
}
