import fs from "node:fs";
import path from "node:path";
import type { AnalystRunDeps } from "../analyst/run.js";
import {
  parseMorningBriefProjects,
  runMorningBrief,
} from "./run.js";

function morningBriefHour(): number {
  const raw = Number(process.env.ATLAS_MORNING_BRIEF_HOUR ?? 7);
  return Number.isFinite(raw) ? Math.min(23, Math.max(0, raw)) : 7;
}

function morningBriefMinute(): number {
  const raw = Number(process.env.ATLAS_MORNING_BRIEF_MINUTE ?? 0);
  return Number.isFinite(raw) ? Math.min(59, Math.max(0, raw)) : 0;
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function lastRunPath(dataDir: string): string {
  return path.join(dataDir, "morning-brief-last-run.txt");
}

function readLastRunDate(dataDir: string): string | null {
  try {
    return fs.readFileSync(lastRunPath(dataDir), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function getMorningBriefSchedulerStatus(dataDir: string): {
  enabled: boolean;
  hour: number;
  minute: number;
  projects: string[];
  lastRunDate: string | null;
} {
  const enabled = process.env.ATLAS_MORNING_BRIEF === "1";
  return {
    enabled,
    hour: morningBriefHour(),
    minute: morningBriefMinute(),
    projects: enabled ? parseMorningBriefProjects() : [],
    lastRunDate: enabled ? readLastRunDate(dataDir) : null,
  };
}

function writeLastRunDate(dataDir: string, dateKey: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lastRunPath(dataDir), `${dateKey}\n`, "utf8");
}

export function startMorningBriefScheduler(deps: AnalystRunDeps): void {
  if (process.env.ATLAS_MORNING_BRIEF !== "1") return;

  const projects = parseMorningBriefProjects();
  const hour = morningBriefHour();
  const minute = morningBriefMinute();
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = new Date();
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    const today = localDateKey(now);
    if (readLastRunDate(deps.dataDir) === today) return;

    running = true;
    try {
      console.log(`[morning-brief] Running scheduled scan for: ${projects.join(", ")}`);
      const results = await runMorningBrief(deps, projects);
      for (const result of results) {
        if (result.skipped) {
          console.log(`[morning-brief] ${result.project}: already written today`);
        } else if (result.ok) {
          console.log(`[morning-brief] ${result.project}: wrote ${result.path}`);
        } else {
          console.warn(`[morning-brief] ${result.project}: ${result.error ?? "failed"}`);
        }
      }
      writeLastRunDate(deps.dataDir, today);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 60_000);

  console.log(
    `[morning-brief] Scheduler enabled — ${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")} local for ${projects.join(", ")}`,
  );
}
