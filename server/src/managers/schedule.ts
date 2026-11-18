import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagerRunDeps, ManagerSchedulerStatus } from "./types.js";
import { parseManagerProjects, runManagers } from "./run.js";
import { enqueueCloseSessionLoop } from "../agent/loop-close.js";

function managerHour(): number {
  const raw = Number(process.env.ATLAS_MANAGER_HOUR ?? 6);
  return Number.isFinite(raw) ? Math.min(23, Math.max(0, raw)) : 6;
}

function managerMinute(): number {
  const raw = Number(process.env.ATLAS_MANAGER_MINUTE ?? 0);
  return Number.isFinite(raw) ? Math.min(59, Math.max(0, raw)) : 0;
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function lastRunPath(dataDir: string): string {
  return path.join(dataDir, "manager-last-run.txt");
}

const atlasRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readLastRunDate(dataDir: string): string | null {
  try {
    return fs.readFileSync(lastRunPath(dataDir), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function writeLastRunDate(dataDir: string, dateKey: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lastRunPath(dataDir), `${dateKey}\n`, "utf8");
}

export function getManagerSchedulerStatus(dataDir: string): ManagerSchedulerStatus {
  const enabled = process.env.ATLAS_MANAGER === "1";
  return {
    enabled,
    hour: managerHour(),
    minute: managerMinute(),
    projects: enabled ? parseManagerProjects() : [],
    lastRunDate: enabled ? readLastRunDate(dataDir) : null,
  };
}

export function startManagerScheduler(deps: ManagerRunDeps): void {
  if (process.env.ATLAS_MANAGER !== "1") return;

  const projects = parseManagerProjects();
  const hour = managerHour();
  const minute = managerMinute();
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    const today = localDateKey(now);
    if (readLastRunDate(deps.dataDir) === today) return;

    running = true;
    try {
      console.log(`[manager] Running scheduled scan for: ${projects.join(", ")}`);
      const results = await runManagers(deps, projects);
      for (const result of results) {
        if (result.skipped) {
          console.log(`[manager] ${result.project}: already written today`);
        } else if (result.ok) {
          console.log(`[manager] ${result.project}: wrote ${result.path}`);
        } else {
          console.warn(`[manager] ${result.project}: ${result.error ?? "failed"}`);
        }
      }
      writeLastRunDate(deps.dataDir, today);

      const wrote = results.filter((r) => r.ok && !r.skipped);
      const skipped = results.filter((r) => r.skipped);
      const failed = results.filter((r) => !r.ok);
      try {
        const dump = await enqueueCloseSessionLoop({
          atlasRoot,
          dataDir: deps.dataDir,
          db: deps.db,
          registry: deps.registry,
          source: "manager",
          note: [
            `Overnight managers finished.`,
            wrote.length
              ? `Wrote: ${wrote.map((r) => r.project).join(", ")}.`
              : "No new manager files.",
            skipped.length ? `Already had today's prep: ${skipped.map((r) => r.project).join(", ")}.` : "",
            failed.length ? `Failed: ${failed.map((r) => `${r.project} (${r.error})`).join(", ")}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
        if (dump.ok) {
          console.log(`[manager] Loop dump ok collection=${String(dump.stamp.collectionOk)}`);
        } else {
          console.warn(`[manager] Loop dump errors: ${dump.errors.join("; ")}`);
        }
      } catch (error) {
        console.warn(
          `[manager] Loop dump error: ${error instanceof Error ? error.message : String(error)}`,
        );
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
    `[manager] Scheduler enabled — ${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")} local for ${projects.join(", ")}`,
  );
}
