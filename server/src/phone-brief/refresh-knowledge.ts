import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getGitRecentContext } from "../projects/git-context.js";
import { loadRegistry } from "../projects/registry.js";
import { findRegistryProject } from "../managers/projects.js";
import { buildPhoneMorningBrief } from "../phone-brief/build.js";
import {
  collectionSyncConfigured,
  syncKnowledgePackToCollection,
} from "../xai/collections.js";
import { writeLatestStatusFiles } from "../agent/latest-status.js";
import { todayDatePrefix } from "../standup/filenames.js";

export interface RefreshPhoneKnowledgeResult {
  ok: boolean;
  packDir: string;
  exportOk: boolean;
  briefPath?: string;
  sessionNotePath?: string;
  liveStatusPath?: string;
  sync?: Awaited<ReturnType<typeof syncKnowledgePackToCollection>>;
  errors: string[];
}

function readFirstLines(filePath: string, maxChars = 1200): string {
  try {
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars).trim();
  } catch {
    return "";
  }
}

/** Write a speakable live status snapshot from git across registered projects. */
export function writeLiveRepoStatus(input: {
  packDir: string;
  atlasRoot: string;
  sessionNote?: string;
}): string {
  const registry = loadRegistry();
  const date = todayDatePrefix();
  const blocks: string[] = [
    `# LIVE REPO STATUS — ${date}`,
    "",
    "Generated for the phone agent / overnight managers. Plain outcomes preferred over paths.",
    "",
  ];

  if (input.sessionNote?.trim()) {
    blocks.push("## Latest Cursor session note", input.sessionNote.trim(), "");
  }

  const projects: Array<{ label: string; slug: "atlas" | "vocallearn" | "career" }> = [
    { label: "Atlas", slug: "atlas" },
    { label: "VocalLearn", slug: "vocallearn" },
    { label: "Career", slug: "career" },
  ];

  for (const p of projects) {
    const entry = findRegistryProject(registry, p.slug);
    const projectPath = entry?.path;
    blocks.push(`## ${p.label}`);
    if (!projectPath || !fs.existsSync(projectPath)) {
      blocks.push("_Path missing in registry._", "");
      continue;
    }
    const git = getGitRecentContext(projectPath);
    const head = git.match(/HEAD:\s*(\S+)/)?.[1] ?? "unknown";
    const commits = (git.match(/## Recent commits\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 5)
      .map((line) => `- ${line.replace(/^[a-f0-9]+\s+/i, "")}`);
    const dirty = /## Working tree\n([\s\S]*?)$/m.exec(git)?.[1]?.trim() ?? "";
    const dirtyLines = dirty
      .split("\n")
      .slice(0, 8)
      .filter((l) => l && !l.startsWith("##"));

    blocks.push(`- HEAD: ${head}`);
    if (commits.length) {
      blocks.push("- Recent commits:", ...commits);
    }
    if (dirtyLines.length > 1) {
      blocks.push("- Working tree has local changes (not all committed).");
    } else {
      blocks.push("- Working tree: clean or nearly clean.");
    }

    // Continuity docs (first chunk)
    const handoffCandidates = [
      path.join(projectPath, "HANDOFF.md"),
      path.join(projectPath, "docs", "HANDOFF.md"),
      path.join(projectPath, "ROADMAP.md"),
      path.join(projectPath, "docs", "ROADMAP.md"),
    ];
    for (const h of handoffCandidates) {
      const chunk = readFirstLines(h, 500);
      if (chunk) {
        blocks.push(`- From ${path.basename(h)}:`, chunk.split("\n").slice(0, 8).join("\n"));
        break;
      }
    }
    blocks.push("");
  }

  const statusDir = path.join(input.packDir, "05-status");
  fs.mkdirSync(statusDir, { recursive: true });
  const outPath = path.join(statusDir, "LIVE-REPO-STATUS.md");
  fs.writeFileSync(outPath, blocks.join("\n"), "utf8");
  fs.writeFileSync(path.join(input.packDir, "LIVE-REPO-STATUS.md"), blocks.join("\n"), "utf8");

  // Refresh WHERE_WE_LEFT_OFF to point at live status + session note
  const where = [
    `# Where we left off — ${date}`,
    "",
    "Auto-refreshed by `npm run refresh-phone-knowledge`. Prefer this + LIVE-REPO-STATUS over older static summaries.",
    "",
    input.sessionNote?.trim()
      ? `## Cursor session\n${input.sessionNote.trim()}\n`
      : "## Cursor session\n_No `--note` passed this refresh. Ask Camron what changed since the last call._\n",
    "## Live repos",
    "See `LIVE-REPO-STATUS.md` in this pack for HEAD + recent commits across Atlas, VocalLearn, Career.",
    "",
    "## Continuity sources",
    "- **Read first:** `00-LATEST.md` (this week's Cursor + phone dumps). It beats HANDOFF/ROADMAP.",
    "- VocalLearn HANDOFF/ROADMAP in this pack are historical. Do not treat them as current Halo work.",
    "- Daily speak agenda: `PHONE-MORNING-BRIEF.md` — if it disagrees with `00-LATEST.md`, speak LATEST.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(statusDir, "WHERE_WE_LEFT_OFF.md"), where, "utf8");
  fs.writeFileSync(path.join(input.packDir, "WHERE_WE_LEFT_OFF.md"), where, "utf8");

  return outPath;
}

export type LoopNoteSource = "cursor" | "phone" | "manager" | "session-end";

export function loopNoteSlug(source: LoopNoteSource = "cursor"): string {
  if (source === "phone") return "phone-call";
  if (source === "manager") return "manager-run";
  return "cursor-session";
}

export function writeCursorSessionNote(input: {
  atlasRoot: string;
  note: string;
  source?: LoopNoteSource;
}): string {
  const source = input.source ?? "cursor";
  const inbox = path.join(input.atlasRoot, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(inbox, `${todayDatePrefix()}-${loopNoteSlug(source)}.md`);
  const title =
    source === "phone"
      ? "Phone call"
      : source === "manager"
        ? "Manager run"
        : "Cursor session";
  const body = [
    `# ${title}`,
    `**Date:** ${new Date().toISOString()}`,
    `**Source:** ${source}`,
    "",
    input.note.trim(),
    "",
    `_Also stamped ${stamp}_`,
    "",
  ].join("\n");
  // Append if today's note exists
  if (fs.existsSync(file)) {
    fs.appendFileSync(file, `\n---\n\n${body}`, "utf8");
  } else {
    fs.writeFileSync(file, body, "utf8");
  }
  return file;
}

function runExport(atlasRoot: string, packDir: string): void {
  const script = path.join(atlasRoot, "scripts", "export-phone-agent-knowledge.sh");
  const absPack = path.resolve(packDir);
  execFileSync("bash", [script, absPack], {
    cwd: atlasRoot,
    stdio: "inherit",
  });
}

function restorePhoneInstructions(atlasRoot: string, packDir: string): void {
  const canonical = path.join(atlasRoot, "docs", "ATLAS_PHONE_AGENT_INSTRUCTIONS.md");
  if (!fs.existsSync(canonical)) return;
  const text = fs.readFileSync(canonical, "utf8");
  fs.mkdirSync(path.join(packDir, "00-meta"), { recursive: true });
  fs.writeFileSync(path.join(packDir, "00-meta", "00-ATLAS-PHONE-AGENT.md"), text, "utf8");
  fs.writeFileSync(path.join(packDir, "00-ATLAS-PHONE-AGENT.md"), text, "utf8");
}

export async function refreshPhoneKnowledge(input: {
  atlasRoot: string;
  dataDir: string;
  note?: string;
  source?: LoopNoteSource;
  skipExport?: boolean;
  skipSync?: boolean;
}): Promise<RefreshPhoneKnowledgeResult> {
  const errors: string[] = [];
  const packDir = path.join(input.dataDir, "phone-agent-knowledge");
  let sessionNotePath: string | undefined;
  let exportOk = false;

  if (input.note?.trim()) {
    try {
      sessionNotePath = writeCursorSessionNote({
        atlasRoot: input.atlasRoot,
        note: input.note.trim(),
        source: input.source,
      });
    } catch (error) {
      errors.push(
        `session note: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!input.skipExport) {
    try {
      runExport(input.atlasRoot, packDir);
      exportOk = true;
    } catch (error) {
      errors.push(`export: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    exportOk = fs.existsSync(packDir);
  }

  restorePhoneInstructions(input.atlasRoot, packDir);

  let liveStatusPath: string | undefined;
  try {
    liveStatusPath = writeLiveRepoStatus({
      packDir,
      atlasRoot: input.atlasRoot,
      sessionNote: input.note,
    });
  } catch (error) {
    errors.push(
      `live status: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    writeLatestStatusFiles({
      atlasRoot: input.atlasRoot,
      dataDir: input.dataDir,
      registry: loadRegistry(),
      sessionNote: input.note,
    });
  } catch (error) {
    errors.push(`latest status: ${error instanceof Error ? error.message : String(error)}`);
  }

  let briefPath: string | undefined;
  try {
    const registry = loadRegistry();
    const brief = buildPhoneMorningBrief({ registry, dataDir: input.dataDir });
    if (brief.ok && brief.path) briefPath = brief.path;
    else if (brief.error) errors.push(`phone-brief: ${brief.error}`);
  } catch (error) {
    errors.push(`phone-brief: ${error instanceof Error ? error.message : String(error)}`);
  }

  let sync: RefreshPhoneKnowledgeResult["sync"];
  if (!input.skipSync) {
    if (!collectionSyncConfigured()) {
      errors.push(
        "Collection sync not configured (need ATLAS_PHONE_COLLECTION_SYNC=1 + management key + collection id)",
      );
    } else {
      try {
        sync = await syncKnowledgePackToCollection(packDir);
        if (!sync.ok) errors.push(...sync.errors);
      } catch (error) {
        errors.push(`sync: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    packDir,
    exportOk,
    briefPath,
    sessionNotePath,
    liveStatusPath,
    sync,
    errors,
  };
}
