import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import { searchContext } from "../context/search.js";
import { buildContextManifest } from "../reports/store.js";
import { buildLatestStatusMarkdown } from "./latest-status.js";

export function agentSearchContext(
  db: Database.Database,
  registry: ProjectRegistry,
  query: string,
  limit = 8,
  paths?: { atlasRoot: string; dataDir: string },
): {
  ok: true;
  query: string;
  manifest: string;
  instruction: string;
  latest: string;
  hits: Array<{ source: string; path: string; snippet: string }>;
} {
  const q = query.trim();
  const capped = Math.min(Math.max(limit, 1), 12);
  const rawHits = searchContext(db, registry, q, capped * 2);
  const hits = preferRecentInbox(rawHits).slice(0, capped);
  const manifest = buildContextManifest(db)
    .map(
      (m) =>
        `${m.name} (${m.projectSlug}): docs=${m.docsFound.length}; deepScan=${m.deepScan}; files=${m.totalFiles ?? "?"}`,
    )
    .join("\n");

  const latest = paths
    ? buildLatestStatusMarkdown({
        atlasRoot: paths.atlasRoot,
        dataDir: paths.dataDir,
        registry,
      }).slice(0, 4000)
    : "";

  return {
    ok: true,
    query: q,
    manifest,
    instruction:
      "Prefer dated inbox notes from the last 7 days and the `latest` field over HANDOFF.md / ROADMAP.md. Those two files are historical. If they disagree with `latest`, `latest` wins.",
    latest,
    hits: hits.map((h) => ({
      source: h.source,
      path: h.path,
      snippet: h.snippet,
    })),
  };
}

function preferRecentInbox<T extends { source: string; path: string }>(hits: T[]): T[] {
  const now = Date.now();
  const score = (h: T): number => {
    const day = h.path.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (day) {
      const then = Date.parse(day);
      if (Number.isFinite(then)) {
        const ageDays = (now - then) / 86_400_000;
        if (ageDays >= 0 && ageDays <= 7) return 200 - ageDays;
      }
    }
    if (/HANDOFF|ROADMAP/i.test(h.path)) return -20;
    if (h.source.startsWith("inbox:")) return 5;
    return 0;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}
