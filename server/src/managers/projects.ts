import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry, RegistryProject } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";
import { resolveAnalystProject } from "../analyst/registry-slugs.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import { standupPrepFilenameForToday } from "../standup/filenames.js";

export function parseManagerProjects(
  raw = process.env.ATLAS_MANAGER_PROJECTS ?? "vocallearn",
): InboxProjectSlug[] {
  const projects: InboxProjectSlug[] = [];
  for (const token of raw.split(",")) {
    const project = resolveAnalystProject(token.trim());
    if (project && !projects.includes(project)) projects.push(project);
  }
  return projects.length ? projects : ["vocallearn"];
}

export { standupPrepFilenameForToday };

/** @deprecated alias */
export function managerFilenameForToday(): string {
  return standupPrepFilenameForToday();
}

export function findRegistryProject(
  registry: ProjectRegistry,
  inboxProject: InboxProjectSlug,
): RegistryProject | undefined {
  const registrySlug =
    inboxProject === "vocallearn"
      ? "vocalllearn"
      : inboxProject === "career"
        ? "career-dashboard"
        : "atlas";
  return getActiveProjects(registry).find((p) => p.slug === registrySlug);
}

export function readRoadmapExcerpt(project: RegistryProject, maxChars = 6000): string {
  if (!project.path) return "_No project path in registry._";
  const candidates = project.roadmapFiles?.length
    ? project.roadmapFiles
    : ["README.md", "ROADMAP.md", "docs/ROADMAP.md", "HANDOFF.md"];

  for (const rel of candidates) {
    const filePath = path.join(project.path, rel);
    try {
      if (!fs.existsSync(filePath)) continue;
      const text = fs.readFileSync(filePath, "utf8").trim();
      if (text) {
        return `### ${rel}\n\n${text.slice(0, maxChars)}`;
      }
    } catch {
      continue;
    }
  }
  return "_No roadmap files found._";
}

export function standupPrepExistsForToday(
  registry: ProjectRegistry,
  project: InboxProjectSlug,
): boolean {
  const entry = findRegistryProject(registry, project);
  if (!entry?.path) return false;
  const inboxDir = path.join(entry.path, "inbox");
  return fs.existsSync(path.join(inboxDir, standupPrepFilenameForToday()));
}

/** @deprecated */
export function managerReportExistsForToday(
  registry: ProjectRegistry,
  project: InboxProjectSlug,
): boolean {
  return standupPrepExistsForToday(registry, project);
}
