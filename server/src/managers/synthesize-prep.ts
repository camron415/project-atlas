import { chatCompletion } from "../xai/client.js";
import { AtlasModels } from "../models/router.js";

export interface PrepSynthesis {
  sinceYesterday: string;
  roadmapPosition: string;
  proposedToday: string;
  decisions: string;
  autoQueue: string;
  raw: string;
}

const SYSTEM = `You are a department manager writing standup prep that will be READ ALOUD on a phone call (~10 min).

Audience: Camron, driving / on a delivery shift — not staring at a screen.

Output markdown with EXACTLY these headings (no others):

## Since yesterday
(2-3 plain-English bullets. Outcomes only. No file paths, no commit hashes, no code identifiers.)

## Roadmap position
(1-2 bullets: what phase/track we're on + the next real outcome in plain words.)

## Proposed today (P / S)
(1-3 numbered items. Each: plain-English action people can approve by voice — then a tag like P1/S2 at the end only.)
Bad: "Open docs/PHASE_1_75.md and tag src/hooks/useSession.ts"
Good: "Confirm Phase 1.75 is still the active plan, then add simple priority labels to the roadmap — P1 — S2"

## Decisions for Camron
(1-3 short yes/no or pick-A/B questions OR the single line: None today)
Questions must be speakable in one breath.

## Auto queue (S0/S1)
(bullet list of safe background tasks OR: None today — plain English only)

Hard rules:
- NEVER include file paths, folder names, commit SHAs, npm scripts, or function/class names.
- NEVER dump analyst "findings" lists or git diffs.
- Prefer outcomes ("ship recruiter README") over mechanics ("edit README.md").
- If the only honest work is boring housekeeping, say so in one line and propose at most ONE decision — do not invent fake drama.
- If Extra / Cursor / phone notes contradict git, HANDOFF, or ROADMAP, trust Extra. HANDOFF is historical.
- Prefer fewer, clearer items.`;

export async function synthesizeStandupPrepSections(input: {
  projectLabel: string;
  managerName: string;
  gitBlock: string;
  roadmapBlock: string;
  analystMd: string;
  extraContext?: string;
}): Promise<PrepSynthesis> {
  const user = [
    `Project: ${input.projectLabel}`,
    `Manager: ${input.managerName}`,
    "",
    "Use the notes below as private context. Translate into spoken standup language.",
    "",
    "### Git",
    input.gitBlock.slice(0, 4000),
    "",
    "### Roadmap excerpt",
    input.roadmapBlock.slice(0, 5000),
    "",
    "### Analyst findings",
    input.analystMd.slice(0, 8000),
    input.extraContext ? `\n### Extra\n${input.extraContext.slice(0, 4000)}` : "",
  ].join("\n");

  const raw = await chatCompletion(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    { model: AtlasModels.fast(), maxTokens: 900, task: "manager-prep-synth" },
  );

  return {
    sinceYesterday: section(raw, "Since yesterday") || "_Quiet overnight — nothing material._",
    roadmapPosition: section(raw, "Roadmap position") || "_Stay the course; confirm next outcome with Camron._",
    proposedToday:
      section(raw, "Proposed today (P / S)") ||
      section(raw, "Proposed today") ||
      "1. Skim yesterday's progress and pick one focus for today — P2 — S3",
    decisions: section(raw, "Decisions for Camron") || "None today",
    autoQueue: section(raw, "Auto queue (S0/S1)") || "None today",
    raw,
  };
}

function section(md: string, heading: string): string {
  const re = new RegExp(
    `##\\s*${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const m = md.match(re);
  return m?.[1]?.trim() ?? "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
