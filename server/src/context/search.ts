import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";
import { resolveInboxDir } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import { getLatestReports } from "../reports/store.js";

const INBOX_PROJECTS: InboxProjectSlug[] = ["atlas", "vocallearn", "career"];
const MAX_BODY_CHARS = 24_000;
const MAX_DOC_CHARS = 18_000;

export interface SearchHit {
  source: string;
  path: string;
  snippet: string;
  rank: number;
}

export function ensureFtsSchema(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(
      source UNINDEXED,
      doc_path UNINDEXED,
      body,
      tokenize='porter unicode61'
    );
  `);
}

function insertDoc(
  db: Database.Database,
  source: string,
  docPath: string,
  body: string,
): void {
  const trimmed = body.trim().slice(0, MAX_BODY_CHARS);
  if (!trimmed) return;
  db.prepare(
    `INSERT INTO context_fts (source, doc_path, body) VALUES (?, ?, ?)`,
  ).run(source, docPath, trimmed);
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 512_000) return null;
    return fs.readFileSync(filePath, "utf8").slice(0, MAX_DOC_CHARS);
  } catch {
    return null;
  }
}

function indexInboxFiles(
  db: Database.Database,
  registry: ProjectRegistry,
): number {
  let count = 0;
  for (const project of INBOX_PROJECTS) {
    try {
      const inboxDir = resolveInboxDir(project, registry);
      if (!fs.existsSync(inboxDir)) continue;
      for (const name of fs.readdirSync(inboxDir)) {
        if (!name.endsWith(".md")) continue;
        const filePath = path.join(inboxDir, name);
        const body = readFileSafe(filePath);
        if (!body) continue;
        insertDoc(db, `inbox:${project}`, filePath, body);
        count++;
      }
    } catch {
      // project path missing — skip
    }
  }
  return count;
}

function indexAtlasOrchestratorDocs(db: Database.Database, registry: ProjectRegistry): number {
  const atlas = getActiveProjects(registry).find((p) => p.slug === "atlas");
  if (!atlas?.path) return 0;
  const rels = [
    "docs/MANAGER_CHARTER.md",
    "docs/STANDUP_FLOW.md",
    "docs/PHASE_2_KICKOFF.md",
    "docs/managers/PERSONAS.md",
    "docs/managers/VOCALLEARN_POLICY.md",
    "docs/managers/CAREER_POLICY.md",
    "docs/managers/ATLAS_POLICY.md",
    "docs/STANDUP_IMPLEMENTATION.md",
    "docs/ROADMAP.md",
    "docs/LEARNING_LEDGER.md",
    "docs/LEARNING_TUTOR.md",
  ];
  let count = 0;
  for (const rel of rels) {
    const filePath = path.join(atlas.path!, rel);
    const body = readFileSafe(filePath);
    if (!body) continue;
    insertDoc(db, "atlas:standup-doc", filePath, body);
    count++;
  }
  return count;
}

function indexKeyDocs(db: Database.Database, registry: ProjectRegistry): number {
  let count = 0;
  for (const project of getActiveProjects(registry)) {
    if (!project.path) continue;
    const files = project.roadmapFiles ?? ["README.md"];
    for (const rel of files) {
      const filePath = path.join(project.path, rel);
      const body = readFileSafe(filePath);
      if (!body) continue;
      insertDoc(db, `doc:${project.slug}`, filePath, body);
      count++;
    }
  }
  return count;
}

/** Rebuild FTS index from cached reports, inbox markdown, and registry key docs. */
export function rebuildContextIndex(
  db: Database.Database,
  registry: ProjectRegistry,
): number {
  ensureFtsSchema(db);
  db.exec(`DELETE FROM context_fts`);

  let count = 0;
  for (const report of getLatestReports(db)) {
    insertDoc(db, `report:${report.projectSlug}`, report.projectSlug, report.summary);
    count++;
  }
  count += indexInboxFiles(db, registry);
  count += indexKeyDocs(db, registry);
  count += indexAtlasOrchestratorDocs(db, registry);
  return count;
}

function ftsRowCount(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM context_fts`).get() as { n: number };
  return row.n;
}

function ensureIndexed(db: Database.Database, registry: ProjectRegistry): void {
  ensureFtsSchema(db);
  if (ftsRowCount(db) === 0) {
    rebuildContextIndex(db, registry);
  }
}

function escapeFtsQuery(query: string): string {
  return query
    .trim()
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w.replace(/"/g, "")}"`)
    .join(" ");
}

export function searchContext(
  db: Database.Database,
  registry: ProjectRegistry,
  query: string,
  limit = 8,
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];

  ensureIndexed(db, registry);
  const ftsQuery = escapeFtsQuery(q);
  if (!ftsQuery) return [];

  const rows = db
    .prepare(
      `SELECT source, doc_path, snippet(context_fts, 2, '…', '…', 12, 48) AS snippet,
              bm25(context_fts) AS rank
       FROM context_fts
       WHERE context_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as Array<{
    source: string;
    doc_path: string;
    snippet: string;
    rank: number;
  }>;

  return rows.map((row) => ({
    source: row.source,
    path: row.doc_path,
    snippet: row.snippet,
    rank: row.rank,
  }));
}
