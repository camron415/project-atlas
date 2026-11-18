import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { findRegistryProject } from "../managers/projects.js";
import { todayDatePrefix } from "../standup/filenames.js";
import { readLoopCloseStamp } from "./loop-close.js";

const STALE_BANNER =
  "THIS FILE SUPERSEDES HANDOFF.md, ROADMAP.md, README.md, and any inbox older than 7 days. If those disagree with this file, this file wins.";

export interface LatestStatusWrite {
  markdown: string;
  packPath: string;
  inboxPath: string;
}

function readIfExists(filePath: string, maxChars: number): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars).trim();
  } catch {
    return "";
  }
}

function inboxDir(
  registry: ProjectRegistry,
  slug: "atlas" | "vocallearn" | "career",
): string | null {
  const entry = findRegistryProject(registry, slug);
  if (!entry?.path) return null;
  return path.join(entry.path, "inbox");
}

/** Newest markdown files, skipping LATEST itself, within maxAgeDays. */
export function recentInboxNotes(
  dir: string | null,
  opts: { maxFiles?: number; maxAgeDays?: number; maxCharsEach?: number } = {},
): Array<{ name: string; body: string }> {
  if (!dir || !fs.existsSync(dir)) return [];
  const maxFiles = opts.maxFiles ?? 8;
  const maxAgeDays = opts.maxAgeDays ?? 7;
  const maxCharsEach = opts.maxCharsEach ?? 900;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !/LATEST/i.test(name))
    .map((name) => {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      const day = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      const named = day ? Date.parse(`${day}T12:00:00`) : NaN;
      return {
        name,
        filePath,
        mtime: Number.isFinite(named) ? named : stat.mtimeMs,
      };
    })
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles)
    .map((f) => ({
      name: f.name,
      body: readIfExists(f.filePath, maxCharsEach),
    }))
    .filter((f) => f.body);
}

export function buildLatestStatusMarkdown(input: {
  atlasRoot: string;
  dataDir: string;
  registry: ProjectRegistry;
  sessionNote?: string;
}): string {
  const date = todayDatePrefix();
  const stamp = readLoopCloseStamp(input.dataDir);
  const vlNotes = recentInboxNotes(inboxDir(input.registry, "vocallearn"), {
    maxFiles: 8,
    maxAgeDays: 7,
    maxCharsEach: 700,
  });
  const atlasNotes = recentInboxNotes(inboxDir(input.registry, "atlas"), {
    maxFiles: 4,
    maxAgeDays: 7,
    maxCharsEach: 500,
  });

  const blocks: string[] = [
    `# LATEST — ${date}`,
    "",
    `**Generated:** ${new Date().toISOString()}`,
    "",
    STALE_BANNER,
    "",
    "Phone Atlas: for Halo / VocalLearn / 'where are we' questions, answer from this file and this week's notes below. Do not quote HANDOFF or ROADMAP as current work.",
    "",
  ];

  if (stamp) {
    blocks.push(
      "## Last dump into the loop",
      `- When: ${stamp.at}`,
      `- Source: ${stamp.source}`,
      stamp.notePreview ? `- Note: ${stamp.notePreview}` : "",
      "",
    );
  }

  if (input.sessionNote?.trim()) {
    blocks.push("## This dump's note", input.sessionNote.trim(), "");
  }

  if (vlNotes.length) {
    blocks.push("## Halo / VocalLearn — this week's inbox (newest first)");
    for (const note of vlNotes) {
      blocks.push(`### ${note.name}`, note.body, "");
    }
  } else {
    blocks.push("## Halo / VocalLearn", "_No VocalLearn inbox notes in the last 7 days._", "");
  }

  if (atlasNotes.length) {
    blocks.push("## Atlas loop notes (this week)");
    for (const note of atlasNotes) {
      blocks.push(`### ${note.name}`, note.body, "");
    }
  }

  return blocks.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n").slice(0, 12_000);
}

export function writeLatestStatusFiles(input: {
  atlasRoot: string;
  dataDir: string;
  registry: ProjectRegistry;
  sessionNote?: string;
}): LatestStatusWrite {
  const markdown = buildLatestStatusMarkdown(input);
  const packDir = path.join(input.dataDir, "phone-agent-knowledge");
  const statusDir = path.join(packDir, "05-status");
  fs.mkdirSync(statusDir, { recursive: true });
  const packPath = path.join(packDir, "00-LATEST.md");
  fs.writeFileSync(packPath, markdown, "utf8");
  fs.writeFileSync(path.join(statusDir, "00-LATEST.md"), markdown, "utf8");

  const inbox = path.join(input.atlasRoot, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const inboxPath = path.join(inbox, `${todayDatePrefix()}-LATEST.md`);
  fs.writeFileSync(inboxPath, markdown, "utf8");

  return { markdown, packPath, inboxPath };
}
