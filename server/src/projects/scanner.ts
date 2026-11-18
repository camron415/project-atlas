import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { RegistryProject } from "./registry.js";
import { buildCodeInventory, type CodeInventory } from "./code-inventory.js";

export interface ProjectSnapshot {
  slug: string;
  name: string;
  path: string;
  gitHead: string | null;
  roadmapExcerpt: string;
  filesFound: string[];
  codeInventory: CodeInventory | null;
  /** LLM synthesis from deep refresh; null until generated. */
  llmSummary: string | null;
}

function readGitHead(projectPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readRoadmapExcerpt(project: RegistryProject): {
  excerpt: string;
  filesFound: string[];
} {
  if (!project.path) return { excerpt: "", filesFound: [] };

  const chunks: string[] = [];
  const filesFound: string[] = [];

  for (const file of project.roadmapFiles ?? ["README.md"]) {
    const fullPath = path.join(project.path, file);
    if (!fs.existsSync(fullPath)) continue;
    filesFound.push(file);
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      chunks.push(`## ${file}\n${content.slice(0, 4000)}`);
    } catch (error) {
      chunks.push(`## ${file}\n_Could not read (${error instanceof Error ? error.message : String(error)})._`);
    }
  }

  return {
    excerpt: chunks.join("\n\n").slice(0, 12000),
    filesFound,
  };
}

export function snapshotProject(
  project: RegistryProject,
  options: { deep?: boolean } = {},
): ProjectSnapshot | null {
  if (!project.path || !fs.existsSync(project.path)) return null;

  const { excerpt, filesFound } = readRoadmapExcerpt(project);
  const codeInventory = options.deep ? buildCodeInventory(project.path) : null;

  return {
    slug: project.slug,
    name: project.name,
    path: project.path,
    gitHead: readGitHead(project.path),
    roadmapExcerpt: excerpt,
    filesFound,
    codeInventory,
    llmSummary: null,
  };
}

export function resnapshotWithInventory(
  snap: ProjectSnapshot,
  deep: boolean,
): ProjectSnapshot {
  if (!deep) return snap;
  return {
    ...snap,
    codeInventory: buildCodeInventory(snap.path),
  };
}

export function syncProjectsToDb(
  db: Database.Database,
  projects: RegistryProject[],
  options: { deep?: boolean } = {},
): ProjectSnapshot[] {
  const upsert = db.prepare(`
    INSERT INTO projects (slug, name, priority, status, path, target_path, report_cadence, config_json, last_scanned_at, last_git_head)
    VALUES (@slug, @name, @priority, @status, @path, @targetPath, @reportCadence, @configJson, datetime('now'), @gitHead)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      priority = excluded.priority,
      status = excluded.status,
      path = excluded.path,
      target_path = excluded.target_path,
      report_cadence = excluded.report_cadence,
      config_json = excluded.config_json,
      last_scanned_at = datetime('now'),
      last_git_head = excluded.last_git_head,
      updated_at = datetime('now')
  `);

  const snapshots: ProjectSnapshot[] = [];

  for (const project of projects) {
    if (project.status !== "active" || !project.path) continue;
    const snap = snapshotProject(project, options);
    if (!snap) continue;

    upsert.run({
      slug: project.slug,
      name: project.name,
      priority: project.priority,
      status: project.status,
      path: project.path,
      targetPath: project.targetPath ?? null,
      reportCadence: project.reportCadence ?? "daily",
      configJson: JSON.stringify({ workers: project.workers ?? [] }),
      gitHead: snap.gitHead,
    });

    snapshots.push(snap);
  }

  return snapshots;
}

export function projectsNeedingRefresh(
  db: Database.Database,
  snapshots: ProjectSnapshot[],
): ProjectSnapshot[] {
  const getHead = db.prepare(
    `SELECT last_git_head FROM projects WHERE slug = ?`,
  );

  return snapshots.filter((snap) => {
    const row = getHead.get(snap.slug) as { last_git_head: string | null } | undefined;
    return !row?.last_git_head || row.last_git_head !== snap.gitHead;
  });
}
