import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { findRegistryProject } from "../managers/projects.js";
import { standupPrepFilenameForToday, todayDatePrefix } from "../standup/filenames.js";
import { buildLatestStatusMarkdown } from "./latest-status.js";
import { loopCloseIsStale, readLoopCloseStamp, type LoopCloseStamp } from "./loop-close.js";

export interface WhereWeLeftOffResult {
  ok: true;
  generatedAt: string;
  stale: boolean;
  lastClose: LoopCloseStamp | null;
  context: string;
}

function readIfExists(filePath: string, maxChars: number): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars).trim();
  } catch {
    return "";
  }
}

function latestInboxMatch(inboxDir: string, needle: string, maxChars = 1200): string {
  if (!fs.existsSync(inboxDir)) return "";
  const files = fs
    .readdirSync(inboxDir)
    .filter((name) => name.endsWith(".md") && name.toLowerCase().includes(needle))
    .map((name) => {
      const filePath = path.join(inboxDir, name);
      return { filePath, mtime: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files[0]) return "";
  return readIfExists(files[0].filePath, maxChars);
}

function sectionBody(md: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  return md.match(re)?.[1]?.trim() ?? "";
}

function speakablePrepExcerpt(prepMd: string, maxChars = 900): string {
  const chunks: string[] = [];
  for (const heading of ["Roadmap position", "Since yesterday", "Decisions for Camron", "Proposed today (P / S)"]) {
    const body = sectionBody(prepMd, heading);
    if (body) chunks.push(`### ${heading}\n${body}`);
  }
  return chunks.join("\n\n").slice(0, maxChars);
}

function projectInbox(registry: ProjectRegistry, slug: "atlas" | "vocallearn" | "career"): string | null {
  const entry = findRegistryProject(registry, slug);
  if (!entry?.path) return null;
  return path.join(entry.path, "inbox");
}

/** Recent Halo / Cursor notes Sloane should read overnight (live disk, not Collection). */
export function readHaloLoopContext(registry: ProjectRegistry, maxChars = 3500): string {
  const vlInbox = projectInbox(registry, "vocallearn");
  const atlasInbox = projectInbox(registry, "atlas");
  const blocks: string[] = [
    "Halo / Cove is the live shipping surface (family Ask website). Language-learning VocalLearn is secondary until Camron reopens it.",
    "Managers flag drift and propose 1-3 Lab tasks. Do not edit Halo production source or deploy.",
  ];

  if (vlInbox) {
    const prep = readIfExists(path.join(vlInbox, standupPrepFilenameForToday()), 1500);
    if (prep) blocks.push("## Today's VocalLearn standup prep (excerpt)", speakablePrepExcerpt(prep, 800));
    const halo = latestInboxMatch(vlInbox, "halo", 1400);
    if (halo) blocks.push("## Latest Halo inbox note", halo);
    const cursor = latestInboxMatch(vlInbox, "cursor-session", 800);
    if (cursor) blocks.push("## Latest VocalLearn Cursor dump", cursor);
  }

  if (atlasInbox) {
    const session = latestInboxMatch(atlasInbox, "cursor-session", 800);
    if (session) blocks.push("## Latest Atlas Cursor dump", session);
    const phone = latestInboxMatch(atlasInbox, "phone-call", 600);
    if (phone) blocks.push("## Latest phone call dump", phone);
  }

  return blocks.join("\n\n").slice(0, maxChars);
}

export function buildWhereWeLeftOff(input: {
  atlasRoot: string;
  dataDir: string;
  registry: ProjectRegistry;
}): WhereWeLeftOffResult {
  const lastClose = readLoopCloseStamp(input.dataDir);
  const stale = loopCloseIsStale(lastClose);
  const date = todayDatePrefix();
  const latest = buildLatestStatusMarkdown({
    atlasRoot: input.atlasRoot,
    dataDir: input.dataDir,
    registry: input.registry,
  });

  const header = [
    `# Where we left off — ${date}`,
    "",
    "For Halo / VocalLearn current work, trust 00-LATEST (below). HANDOFF.md and ROADMAP.md in the Collection are historical.",
    lastClose
      ? `Last Collection dump: ${lastClose.at} (${lastClose.source}, collection ${lastClose.collectionOk === true ? "ok" : lastClose.collectionOk === false ? "failed" : "unknown"}).`
      : "No session_close stamp yet.",
    stale ? "Dump is older than 36 hours — say so if Camron asks for latest." : "",
    "",
    latest,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    stale,
    lastClose,
    context: header.slice(0, 10_000).trim(),
  };
}
