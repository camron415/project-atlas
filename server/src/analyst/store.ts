import type Database from "better-sqlite3";
import type { AnalystJob, AnalystJobStatus } from "./types.js";

export interface AnalystJobRow {
  id: string;
  project_slug: string;
  focus: string;
  user_intent: string | null;
  status: AnalystJobStatus;
  progress: string | null;
  summary_markdown: string | null;
  error: string | null;
  deep: number;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: AnalystJobRow): AnalystJob {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    focus: row.focus,
    userIntent: row.user_intent ?? undefined,
    status: row.status,
    progress: row.progress ?? undefined,
    summaryMarkdown: row.summary_markdown ?? undefined,
    error: row.error ?? undefined,
    deep: row.deep === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function makeAnalystJobId(): string {
  return `aj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAnalystJob(
  db: Database.Database,
  input: {
    projectSlug: string;
    focus: string;
    userIntent?: string;
    deep?: boolean;
  },
): AnalystJob {
  const id = makeAnalystJobId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO analyst_jobs
      (id, project_slug, focus, user_intent, status, progress, deep, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', 'Queued', ?, ?, ?)`,
  ).run(
    id,
    input.projectSlug,
    input.focus.trim(),
    input.userIntent?.trim() || null,
    input.deep ? 1 : 0,
    now,
    now,
  );
  return getAnalystJob(db, id)!;
}

export function getAnalystJob(db: Database.Database, jobId: string): AnalystJob | null {
  const row = db
    .prepare(`SELECT * FROM analyst_jobs WHERE id = ?`)
    .get(jobId) as AnalystJobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function updateAnalystJob(
  db: Database.Database,
  jobId: string,
  patch: Partial<{
    status: AnalystJobStatus;
    progress: string;
    summaryMarkdown: string;
    error: string;
  }>,
): AnalystJob | null {
  const existing = getAnalystJob(db, jobId);
  if (!existing) return null;

  const status = patch.status ?? existing.status;
  const progress = patch.progress ?? existing.progress ?? null;
  const summaryMarkdown = patch.summaryMarkdown ?? existing.summaryMarkdown ?? null;
  const error = patch.error ?? existing.error ?? null;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE analyst_jobs
     SET status = ?, progress = ?, summary_markdown = ?, error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, progress, summaryMarkdown, error, now, jobId);

  return getAnalystJob(db, jobId);
}
