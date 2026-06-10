import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  buildCodeInventory,
  formatInventoryForPrompt,
  type InventoryOptions,
} from "../projects/code-inventory.js";
import { getGitRecentContext } from "../projects/git-context.js";
import type { RegistryProject } from "../projects/registry.js";
import { snapshotProject } from "../projects/scanner.js";
import { getLatestReportForProject } from "../reports/store.js";
import { synthesizeProjectReport } from "../reports/synthesize.js";

/** Analyst gets a wider deep-read than routine cache refresh. */
export const ANALYST_INVENTORY_OPTIONS: InventoryOptions = {
  maxTreeEntries: 800,
  maxSourceFiles: 140,
  maxBytesPerFile: 10_000,
  maxTotalBytes: 380_000,
  maxDepth: 12,
};

/** Always include these paths when present (atlas + shared patterns). */
const CANONICAL_DOC_GLOBS = [
  "docs/PHASE_1_75.md",
  "docs/PHASE_1_5_CLOSEOUT.md",
  "docs/VOICE_PHASE4.md",
  "docs/VOICE_BASELINE.md",
  "docs/inbox/README.md",
  "docs/ROADMAP.md",
  "README.md",
];

const ANALYST_CODE_HINTS = [
  "server/src/analyst/",
  "server/src/inbox/",
  "server/src/sessions/",
  "server/src/realtime-proxy.ts",
  "apps/mobile/src/voice-v2/",
  "inbox/",
];

function readFileExcerpt(root: string, relativePath: string, max = 12_000): string | null {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) return null;
  try {
    return fs.readFileSync(full, "utf8").slice(0, max);
  } catch {
    return null;
  }
}

function listRecentInboxFiles(projectRoot: string, limit = 5): string[] {
  const inboxDir = path.join(projectRoot, "inbox");
  if (!fs.existsSync(inboxDir)) return [];
  try {
    return fs
      .readdirSync(inboxDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ f, m: fs.statSync(path.join(inboxDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, limit)
      .map((x) => `inbox/${x.f}`);
  } catch {
    return [];
  }
}

function readCanonicalDocs(projectRoot: string): string {
  const chunks: string[] = [];
  for (const rel of CANONICAL_DOC_GLOBS) {
    const text = readFileExcerpt(projectRoot, rel);
    if (text) chunks.push(`## ${rel}\n${text}`);
  }
  for (const rel of listRecentInboxFiles(projectRoot)) {
    const text = readFileExcerpt(projectRoot, rel, 8000);
    if (text) chunks.push(`## ${rel} (recent inbox)\n${text}`);
  }
  return chunks.join("\n\n").slice(0, 48_000);
}

function readAnalystPriorityFiles(projectRoot: string): string {
  const inventory = buildCodeInventory(projectRoot, ANALYST_INVENTORY_OPTIONS);
  const hints = ANALYST_CODE_HINTS.map((h) => h.toLowerCase());
  const priority = inventory.sourceExcerpts.filter((f) =>
    hints.some((h) => f.relativePath.toLowerCase().includes(h.replace(/\/$/, ""))),
  );
  if (!priority.length) return "";
  return priority
    .map((f) => `### ${f.relativePath}\n${f.excerpt}`)
    .join("\n\n")
    .slice(0, 32_000);
}

function reportIsStale(
  db: Database.Database,
  registrySlug: string,
  liveHead: string | null,
): boolean {
  if (!liveHead) return true;
  const cached = getLatestReportForProject(db, registrySlug);
  if (!cached) return true;
  const ctxHead = cached.context?.gitHead as string | undefined;
  return !ctxHead || ctxHead !== liveHead;
}

export async function buildFreshAnalystContext(
  db: Database.Database,
  project: RegistryProject,
): Promise<string> {
  if (!project.path) throw new Error("Project path missing");

  const snap = snapshotProject(project, { deep: false });
  if (!snap) throw new Error("Could not snapshot project");

  const inventory = buildCodeInventory(project.path, ANALYST_INVENTORY_OPTIONS);
  const enriched = {
    ...snap,
    codeInventory: inventory,
  };

  let llmSummary: string | null = null;
  if (process.env.XAI_API_KEY) {
    llmSummary = await synthesizeProjectReport(enriched);
  }

  const canonical = readCanonicalDocs(project.path);
  const priorityCode = readAnalystPriorityFiles(project.path);
  const gitCtx = getGitRecentContext(project.path);
  const inventoryBlock = formatInventoryForPrompt(inventory);

  const staleNote = reportIsStale(db, project.slug, snap.gitHead)
    ? "Cache was stale relative to git HEAD — this context was built fresh for this analyst job."
    : "Context refreshed for this analyst job.";

  return [
    `# Analyst context: ${project.name}`,
    `Path: ${project.path}`,
    staleNote,
    "",
    "## Where summaries live (read these first)",
    "- Cached report: SQLite `project_reports` on Mac Atlas server (refreshed per git HEAD)",
    "- Planning inbox: `{repo}/inbox/*.md` — session close artifacts from voice",
    "- Phase docs: `docs/PHASE_1_75.md`, `docs/PHASE_1_5_CLOSEOUT.md`, `docs/VOICE_PHASE4.md`",
    "- Live capabilities: analyst jobs, POST /inbox, voice tools on realtime proxy",
    "",
    "## Git activity",
    gitCtx,
    "",
    llmSummary ? `## AI synthesis (fresh)\n${llmSummary}` : "",
    "",
    "## Canonical docs (always loaded)",
    canonical || "_No canonical docs found._",
    "",
    priorityCode ? `## Priority implementation files\n${priorityCode}` : "",
    "",
    "## Full codebase inventory (deep read)",
    inventoryBlock,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 96_000);
}
