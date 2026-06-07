import type Database from "better-sqlite3";
import type { ProjectSnapshot } from "../projects/scanner.js";

export interface StoredReport {
  projectSlug: string;
  summary: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface ContextManifestEntry {
  projectSlug: string;
  name: string;
  path: string;
  gitHead: string | null;
  docsFound: string[];
  deepScan: boolean;
  totalFiles: number | null;
  sourceFilesMatched: number | null;
  filesDeepRead: number | null;
  hasLlmSummary: boolean;
  scannedAt: string | null;
}

function buildSummary(snapshot: ProjectSnapshot): string {
  const inv = snapshot.codeInventory;
  const lines = [
    `# ${snapshot.name}`,
    `Path: ${snapshot.path}`,
    snapshot.gitHead ? `Git HEAD: ${snapshot.gitHead.slice(0, 8)}` : "Git: unavailable",
    snapshot.filesFound.length
      ? `Docs indexed: ${snapshot.filesFound.join(", ")}`
      : "Docs indexed: none found",
  ];

  if (inv) {
    lines.push(
      `Code inventory: ${inv.totalFiles} files in tree, ${inv.sourceFilesMatched} source-like, ${inv.sourceExcerpts.length} files deep-read`,
      "",
      "## Directory tree (preview)",
      inv.treePreview.slice(0, 80).join("\n"),
    );
    if (inv.treePreview.length > 80) {
      lines.push(`… +${inv.treePreview.length - 80} more paths`);
    }
  }

  if (snapshot.llmSummary) {
    lines.push("", "## AI synthesis (cheap scan model)", snapshot.llmSummary);
  }

  lines.push("", "## Docs excerpt", snapshot.roadmapExcerpt || "_No roadmap excerpt available._");

  if (inv?.sourceExcerpts.length) {
    lines.push("", "## Source excerpts (sample)");
    for (const file of inv.sourceExcerpts.slice(0, 12)) {
      lines.push(`### ${file.relativePath}`, file.excerpt.slice(0, 2500), "");
    }
    if (inv.sourceExcerpts.length > 12) {
      lines.push(`… +${inv.sourceExcerpts.length - 12} more files in cache`);
    }
  }

  return lines.join("\n").slice(0, 28_000);
}

export function storeProjectReport(
  db: Database.Database,
  snapshot: ProjectSnapshot,
  source = "scanner",
): StoredReport {
  const summary = buildSummary(snapshot);
  const inv = snapshot.codeInventory;
  const context = {
    path: snapshot.path,
    gitHead: snapshot.gitHead,
    filesFound: snapshot.filesFound,
    deepScan: Boolean(inv),
    inventory: inv
      ? {
          totalFiles: inv.totalFiles,
          sourceFilesMatched: inv.sourceFilesMatched,
          filesDeepRead: inv.sourceExcerpts.length,
          treePreviewCount: inv.treePreview.length,
          scannedAt: inv.scannedAt,
          excerptPaths: inv.sourceExcerpts.map((f) => f.relativePath),
        }
      : null,
    llmSummary: snapshot.llmSummary,
  };

  db.prepare(
    `INSERT INTO project_reports (project_slug, summary, context_json, source)
     VALUES (?, ?, ?, ?)`,
  ).run(snapshot.slug, summary, JSON.stringify(context), source);

  return {
    projectSlug: snapshot.slug,
    summary,
    context,
    createdAt: new Date().toISOString(),
  };
}

export function getLatestReports(db: Database.Database): StoredReport[] {
  const rows = db
    .prepare(
      `SELECT pr.project_slug, pr.summary, pr.context_json, pr.created_at
       FROM project_reports pr
       INNER JOIN (
         SELECT project_slug, MAX(id) AS max_id
         FROM project_reports
         GROUP BY project_slug
       ) latest ON pr.id = latest.max_id
       ORDER BY pr.project_slug`,
    )
    .all() as Array<{
    project_slug: string;
    summary: string;
    context_json: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    projectSlug: row.project_slug,
    summary: row.summary,
    context: JSON.parse(row.context_json) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export function getLatestReportForProject(
  db: Database.Database,
  projectSlug: string,
): StoredReport | null {
  const row = db
    .prepare(
      `SELECT project_slug, summary, context_json, created_at
       FROM project_reports
       WHERE project_slug = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(projectSlug) as
    | {
        project_slug: string;
        summary: string;
        context_json: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    projectSlug: row.project_slug,
    summary: row.summary,
    context: JSON.parse(row.context_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function buildChiefContext(db: Database.Database): string {
  const reports = getLatestReports(db);
  if (!reports.length) {
    return "No project reports cached yet. Ask Camron to refresh reports or say 'give me the latest'.";
  }

  const manifest = buildContextManifest(db);
  const manifestBlock = manifest
    .map(
      (m) =>
        `- ${m.name} (${m.projectSlug}): docs=[${m.docsFound.join(", ") || "none"}]; ` +
        `deepScan=${m.deepScan}; files=${m.totalFiles ?? "?"}; deepRead=${m.filesDeepRead ?? 0}; ` +
        `aiSummary=${m.hasLlmSummary}`,
    )
    .join("\n");

  const body = reports
    .map((r) => `### ${r.projectSlug}\n${r.summary.slice(0, 9000)}`)
    .join("\n\n");

  return [
    "## Context manifest (what you can see — disclose when asked)",
    manifestBlock,
    "",
    "When Camron asks what you know, what context you have, or to review a repo: cite this manifest, then answer from the cached excerpts below. If deepScan=false for a project, say a deep refresh is needed for full code review.",
    "",
    body,
  ].join("\n");
}

export function buildContextManifest(db: Database.Database): ContextManifestEntry[] {
  const rows = db
    .prepare(
      `SELECT p.slug, p.name, p.path, p.last_git_head,
              pr.context_json, pr.created_at
       FROM projects p
       LEFT JOIN project_reports pr ON pr.id = (
         SELECT id FROM project_reports
         WHERE project_slug = p.slug
         ORDER BY id DESC LIMIT 1
       )
       WHERE p.status = 'active'
       ORDER BY p.priority ASC`,
    )
    .all() as Array<{
    slug: string;
    name: string;
    path: string | null;
    last_git_head: string | null;
    context_json: string | null;
    created_at: string | null;
  }>;

  return rows.map((row) => {
    const ctx = row.context_json
      ? (JSON.parse(row.context_json) as Record<string, unknown>)
      : {};
    const inv = ctx.inventory as Record<string, unknown> | null | undefined;
    return {
      projectSlug: row.slug,
      name: row.name,
      path: row.path ?? "",
      gitHead: row.last_git_head,
      docsFound: (ctx.filesFound as string[]) ?? [],
      deepScan: Boolean(ctx.deepScan),
      totalFiles: (inv?.totalFiles as number) ?? null,
      sourceFilesMatched: (inv?.sourceFilesMatched as number) ?? null,
      filesDeepRead: (inv?.filesDeepRead as number) ?? null,
      hasLlmSummary: Boolean(ctx.llmSummary),
      scannedAt: (inv?.scannedAt as string) ?? row.created_at,
    };
  });
}
