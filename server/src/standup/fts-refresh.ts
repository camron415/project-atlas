import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";

/** Rebuild FTS after inbox/standup writes so chief search_context stays current. */
export async function refreshStandupContextIndex(
  db: Database.Database,
  registry: ProjectRegistry,
): Promise<number> {
  const { rebuildContextIndex } = await import("../context/search.js");
  const n = rebuildContextIndex(db, registry);
  console.log(`[standup] FTS context index refreshed: ${n} documents`);
  return n;
}
