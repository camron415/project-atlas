import fs from "node:fs";
import path from "node:path";
import type { ManagerRunDeps } from "../managers/types.js";
import { buildPhoneMorningBrief } from "./build.js";
import { syncPhoneBriefToCollection } from "../xai/collections.js";

function lastRunPath(dataDir: string): string {
  return path.join(dataDir, "phone-brief-last-run.txt");
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function phoneBriefHour(): number {
  const raw = Number(process.env.ATLAS_PHONE_BRIEF_HOUR ?? 6);
  return Number.isFinite(raw) ? Math.min(23, Math.max(0, raw)) : 6;
}

function phoneBriefMinute(): number {
  const raw = Number(process.env.ATLAS_PHONE_BRIEF_MINUTE ?? 20);
  return Number.isFinite(raw) ? Math.min(59, Math.max(0, raw)) : 20;
}

export function getPhoneBriefSchedulerStatus(dataDir: string): {
  enabled: boolean;
  hour: number;
  minute: number;
  lastRunDate: string | null;
  collectionSync: boolean;
} {
  const enabled = process.env.ATLAS_PHONE_BRIEF !== "0";
  let last: string | null = null;
  try {
    last = fs.readFileSync(lastRunPath(dataDir), "utf8").trim() || null;
  } catch {
    last = null;
  }
  return {
    enabled,
    hour: phoneBriefHour(),
    minute: phoneBriefMinute(),
    lastRunDate: enabled ? last : null,
    collectionSync: process.env.ATLAS_PHONE_COLLECTION_SYNC === "1",
  };
}

export async function runPhoneBriefPipeline(
  deps: ManagerRunDeps,
): Promise<{ ok: boolean; path?: string; sync?: unknown; error?: string }> {
  const built = buildPhoneMorningBrief({
    registry: deps.registry,
    dataDir: deps.dataDir,
  });
  if (!built.ok || !built.path) {
    return { ok: false, error: built.error ?? "build failed" };
  }

  let sync;
  if (process.env.ATLAS_PHONE_COLLECTION_SYNC === "1") {
    sync = await syncPhoneBriefToCollection(built.path);
  }

  fs.mkdirSync(deps.dataDir, { recursive: true });
  fs.writeFileSync(lastRunPath(deps.dataDir), `${localDateKey()}\n`, "utf8");

  return { ok: true, path: built.path, sync };
}

export function startPhoneBriefScheduler(deps: ManagerRunDeps): void {
  if (process.env.ATLAS_PHONE_BRIEF === "0") return;

  const hour = phoneBriefHour();
  const minute = phoneBriefMinute();
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    const today = localDateKey(now);
    try {
      const last = fs.readFileSync(lastRunPath(deps.dataDir), "utf8").trim();
      if (last === today) return;
    } catch {
      /* first run */
    }

    running = true;
    try {
      console.log("[phone-brief] Building daily phone morning brief…");
      const result = await runPhoneBriefPipeline(deps);
      if (result.ok) {
        console.log(`[phone-brief] Wrote ${result.path}`);
        if (result.sync) console.log("[phone-brief] Collection sync:", result.sync);
      } else {
        console.warn(`[phone-brief] ${result.error}`);
      }
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 60_000);

  console.log(
    `[phone-brief] Scheduler enabled — ${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")} local (collection sync=${
      process.env.ATLAS_PHONE_COLLECTION_SYNC === "1" ? "on" : "off"
    })`,
  );
}
