import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";
import type { InboxProjectSlug, InboxWriteRequest, InboxWriteResult } from "./types.js";

/** Registry slug per inbox project key (registry uses vocalllearn spelling). */
const REGISTRY_SLUG: Record<InboxProjectSlug, string> = {
  atlas: "atlas",
  vocallearn: "vocalllearn",
  career: "career-dashboard",
};

export function slugifyInboxTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "session";
}

export function resolveInboxDir(
  project: InboxProjectSlug,
  registry: ProjectRegistry,
): string {
  const registrySlug = REGISTRY_SLUG[project];
  const entry = getActiveProjects(registry).find((p) => p.slug === registrySlug);
  if (!entry?.path) {
    throw new Error(`No active path for inbox project "${project}" (${registrySlug})`);
  }
  return path.join(entry.path, "inbox");
}

export function formatInboxMarkdown(
  req: InboxWriteRequest,
  writtenAt: string,
): string {
  const lines = [
    `# ${req.title.trim()}`,
    `**Date:** ${writtenAt} · **Project:** ${req.project}`,
  ];
  if (req.sessionId) lines.push(`**Session:** ${req.sessionId}`);
  if (req.analystJobId) lines.push(`**Analyst job:** ${req.analystJobId}`);
  lines.push("", req.body.trim(), "");
  return lines.join("\n");
}

export function writeInboxArtifact(
  registry: ProjectRegistry,
  req: InboxWriteRequest,
): InboxWriteResult {
  const project = req.project;
  if (!project || !req.title?.trim() || !req.body?.trim()) {
    throw new Error("project, title, and body are required");
  }

  const inboxDir = resolveInboxDir(project, registry);
  fs.mkdirSync(inboxDir, { recursive: true });

  const writtenAt = new Date().toISOString();
  const datePrefix = writtenAt.slice(0, 10);
  const slug = slugifyInboxTitle(req.title);
  const filename = `${datePrefix}-${slug}.md`;
  const filePath = path.join(inboxDir, filename);

  let finalPath = filePath;
  if (fs.existsSync(filePath)) {
    const stamp = writtenAt.slice(11, 19).replace(/:/g, "");
    finalPath = path.join(inboxDir, `${datePrefix}-${slug}-${stamp}.md`);
  }

  const markdown = formatInboxMarkdown(req, writtenAt);
  fs.writeFileSync(finalPath, markdown, "utf8");

  return {
    path: finalPath,
    project,
    writtenAt,
  };
}

export interface InboxListEntry {
  path: string;
  filename: string;
  title: string;
  writtenAt: string;
  project: InboxProjectSlug;
}

export function listInboxArtifacts(
  registry: ProjectRegistry,
  project: InboxProjectSlug,
  limit = 24,
): InboxListEntry[] {
  const inboxDir = resolveInboxDir(project, registry);
  if (!fs.existsSync(inboxDir)) return [];

  const files = fs
    .readdirSync(inboxDir)
    .filter((name) => name.endsWith(".md"))
    .map((filename) => {
      const filePath = path.join(inboxDir, filename);
      const stat = fs.statSync(filePath);
      let title = filename.replace(/\.md$/, "");
      try {
        const first = fs.readFileSync(filePath, "utf8").split("\n")[0]?.trim() ?? "";
        if (first.startsWith("# ")) title = first.slice(2).trim();
      } catch {
        // keep filename-based title
      }
      return {
        path: filePath,
        filename,
        title,
        writtenAt: stat.mtime.toISOString(),
        project,
      };
    })
    .sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))
    .slice(0, limit);

  return files;
}
