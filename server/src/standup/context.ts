import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import { resolveInboxDir } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import { findRegistryProject } from "../managers/projects.js";
import {
  standupDecisionsFilenameForToday,
  standupPrepFilenameForToday,
  standupAgendaFilenameForToday,
} from "./filenames.js";

const STANDUP_PROJECTS: InboxProjectSlug[] = ["vocallearn", "career", "atlas"];

export interface StandupPrepEntry {
  project: InboxProjectSlug;
  managerName: string;
  path: string | null;
  skip: boolean;
  excerpt: string;
}

function managerNameFor(project: InboxProjectSlug): string {
  if (project === "vocallearn") return "Sloane";
  if (project === "career") return "Ellis";
  return "Reed";
}

function readInboxFileSafe(filePath: string, maxChars = 12_000): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
  } catch {
    return null;
  }
}

function isSkipPrep(content: string): boolean {
  return /standup:\s*skip/i.test(content);
}

export function readStandupPrep(
  registry: ProjectRegistry,
  project: InboxProjectSlug,
): StandupPrepEntry {
  const entry = findRegistryProject(registry, project);
  const managerName = managerNameFor(project);
  if (!entry?.path) {
    return { project, managerName, path: null, skip: true, excerpt: "_Project path missing._" };
  }
  const filePath = path.join(entry.path, "inbox", standupPrepFilenameForToday());
  const raw = readInboxFileSafe(filePath);
  if (!raw) {
    return {
      project,
      managerName,
      path: null,
      skip: true,
      excerpt: "_No standup prep for today._",
    };
  }
  return {
    project,
    managerName,
    path: filePath,
    skip: isSkipPrep(raw),
    excerpt: raw,
  };
}

export function listStandupPreps(registry: ProjectRegistry): StandupPrepEntry[] {
  return STANDUP_PROJECTS.map((p) => readStandupPrep(registry, p));
}

export function readLatestStandupDecisions(registry: ProjectRegistry): string | null {
  try {
    const atlasInbox = resolveInboxDir("atlas", registry);
    const today = path.join(atlasInbox, standupDecisionsFilenameForToday());
    if (fs.existsSync(today)) return readInboxFileSafe(today, 8000);
    const files = fs
      .readdirSync(atlasInbox)
      .filter((f) => f.endsWith("-standup-decisions.md"))
      .sort()
      .reverse();
    if (!files[0]) return null;
    return readInboxFileSafe(path.join(atlasInbox, files[0]), 8000);
  } catch {
    return null;
  }
}

export function readTodayStandupAgenda(registry: ProjectRegistry): string | null {
  try {
    const atlasInbox = resolveInboxDir("atlas", registry);
    const p = path.join(atlasInbox, standupAgendaFilenameForToday());
    return readInboxFileSafe(p, 6000);
  } catch {
    return null;
  }
}

/**
 * Injected into chief instructions (HTTP session + economy voice) so Atlas stays current.
 */
export function buildStandupMemoryBlock(
  _db: Database.Database,
  registry: ProjectRegistry,
): string {
  const preps = listStandupPreps(registry);
  const active = preps.filter((p) => !p.skip && p.path);
  const skipped = preps.filter((p) => p.skip);
  const decisions = readLatestStandupDecisions(registry);
  const agenda = readTodayStandupAgenda(registry);
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    "## Standup memory (always current — cite in voice and text)",
    `Today: ${today}. Target standup window ~8:30 AM local (Camron starts when ready via app).`,
    "You are ONE chief: moderator in standup AND Camron's assistant outside it. Same memory.",
    "",
    `Departments reporting today: ${active.length ? active.map((p) => `${p.managerName} (${p.project})`).join(", ") : "none yet"}`,
    skipped.length
      ? `Skipped/quiet: ${skipped.map((p) => p.managerName).join(", ")}`
      : "",
    "",
  ];

  if (agenda) {
    lines.push("### Today's agenda", agenda, "");
  }

  for (const prep of active) {
    lines.push(
      `### ${prep.managerName} — standup prep (${prep.project})`,
      prep.excerpt,
      "",
    );
  }

  if (decisions) {
    lines.push("### Latest standup decisions", decisions, "");
  }

  lines.push(
    "Standup flow: manager report → you challenge (devil's advocate) → manager follow-up → your synthesis → Camron decides.",
    "Decision default approval window: **1 day**. If same decision resurfaces after expiry, ask Camron for a longer window.",
    "Docs: docs/MANAGER_CHARTER.md, docs/STANDUP_FLOW.md, docs/managers/*.md",
  );

  return lines.filter(Boolean).join("\n");
}
