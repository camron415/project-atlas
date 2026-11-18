import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import { loadRegistry } from "../projects/registry.js";
import { writeInboxArtifact } from "../inbox/store.js";
import type { InboxProjectSlug } from "../inbox/types.js";
import {
  refreshPhoneKnowledge,
  type LoopNoteSource,
  type RefreshPhoneKnowledgeResult,
} from "../phone-brief/refresh-knowledge.js";
import fs from "node:fs";
import path from "node:path";

export type { LoopNoteSource };

export interface LoopCloseStamp {
  at: string;
  source: LoopNoteSource;
  notePreview: string;
  sessionNotePath?: string;
  exportOk: boolean;
  collectionSyncedAt: string | null;
  collectionOk: boolean | null;
  errors: string[];
}

export interface LoopCloseInput {
  atlasRoot: string;
  dataDir: string;
  source: LoopNoteSource;
  note?: string;
  skipExport?: boolean;
  skipSync?: boolean;
  project?: InboxProjectSlug;
  workspacePath?: string;
  db?: Database.Database;
  registry?: ProjectRegistry;
}

export function loopCloseStampPath(dataDir: string): string {
  return path.join(dataDir, "session-close-last.json");
}

export function readLoopCloseStamp(dataDir: string): LoopCloseStamp | null {
  try {
    const raw = fs.readFileSync(loopCloseStampPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as LoopCloseStamp;
    if (!parsed?.at) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLoopCloseStamp(dataDir: string, stamp: LoopCloseStamp): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(loopCloseStampPath(dataDir), `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
}

export function loopCloseIsStale(stamp: LoopCloseStamp | null, maxAgeHours = 36): boolean {
  if (!stamp?.at) return true;
  const then = Date.parse(stamp.at);
  if (!Number.isFinite(then)) return true;
  return Date.now() - then > maxAgeHours * 60 * 60 * 1000;
}

export function inferProjectFromWorkspace(workspacePath?: string): InboxProjectSlug | undefined {
  const p = (workspacePath ?? "").toLowerCase();
  if (!p.trim()) return undefined;
  if (p.includes("vocallearn") || p.includes("vocalllearn")) return "vocallearn";
  if (p.includes("career-planning") || p.includes("career-dashboard")) return "career";
  if (p.includes("/atlas") || p.endsWith("atlas")) return "atlas";
  return undefined;
}

function previewNote(note?: string): string {
  const text = (note ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export async function closeSessionLoop(
  input: LoopCloseInput,
): Promise<RefreshPhoneKnowledgeResult & { stamp: LoopCloseStamp }> {
  const registry = input.registry ?? loadRegistry();
  const project = input.project ?? inferProjectFromWorkspace(input.workspacePath);
  const note = input.note?.trim();

  if (note && project && project !== "atlas") {
    try {
      writeInboxArtifact(
        registry,
        {
          project,
          title: input.source === "cursor" || input.source === "session-end"
            ? "Cursor session"
            : input.source === "phone"
              ? "Phone call"
              : "Manager run",
          body: note,
        },
        input.db,
      );
    } catch (error) {
      console.warn(
        "[loop-close] project inbox copy failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const result = await refreshPhoneKnowledge({
    atlasRoot: input.atlasRoot,
    dataDir: input.dataDir,
    note,
    source: input.source,
    skipExport: input.skipExport,
    skipSync: input.skipSync,
  });

  const collectionOk =
    input.skipSync
      ? null
      : result.sync
        ? result.sync.ok
        : result.errors.some((e) => /collection/i.test(e))
          ? false
          : null;

  const stamp: LoopCloseStamp = {
    at: new Date().toISOString(),
    source: input.source,
    notePreview: previewNote(note),
    sessionNotePath: result.sessionNotePath,
    exportOk: result.exportOk,
    collectionSyncedAt: collectionOk === true ? new Date().toISOString() : readLoopCloseStamp(input.dataDir)?.collectionSyncedAt ?? null,
    collectionOk,
    errors: result.errors,
  };
  if (collectionOk === true) {
    stamp.collectionSyncedAt = stamp.at;
  }
  writeLoopCloseStamp(input.dataDir, stamp);

  if (input.db) {
    try {
      const { rebuildContextIndex } = await import("../context/search.js");
      rebuildContextIndex(input.db, registry);
    } catch (error) {
      console.warn(
        "[loop-close] FTS rebuild failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { ...result, stamp };
}

let closeQueue: Promise<unknown> = Promise.resolve();

/** Serialize overlapping dumps so Collection uploads do not clobber each other. */
export function enqueueCloseSessionLoop(
  input: LoopCloseInput,
): Promise<RefreshPhoneKnowledgeResult & { stamp: LoopCloseStamp }> {
  const run = closeQueue.then(
    () => closeSessionLoop(input),
    () => closeSessionLoop(input),
  );
  closeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
