import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writeEllisBoardSnapshot } from "./applied-roles.js";

export interface CareerNightlyResult {
  ok: boolean;
  skipped?: boolean;
  ingestOk?: boolean;
  reportPath?: string;
  reportText?: string;
  error?: string;
  durationMs: number;
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSpawnDeadlock(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /deadlock|error -11|EDEADLK|EAGAIN|Resource deadlock/i.test(msg);
}

function sleepSync(ms: number): void {
  execFileSync("/bin/sleep", [String(Math.max(1, Math.ceil(ms / 1000)))]);
}

/** Run a career-dashboard tsx script without going through npm (launchd-safe). */
function runCareerTsx(careerPath: string, relScript: string, timeoutMs: number): void {
  const tsxCli = path.join(careerPath, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(careerPath, relScript);
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`tsx missing under ${careerPath}`);
  }
  if (!fs.existsSync(script)) {
    throw new Error(`script missing: ${relScript}`);
  }
  const attempts = 3;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync(process.execPath, [tsxCli, script], {
        cwd: careerPath,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: Number.isFinite(timeoutMs) ? timeoutMs : 12 * 60_000,
        maxBuffer: 8_000_000,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      return;
    } catch (error) {
      last = error;
      if (!isSpawnDeadlock(error) || i === attempts - 1) throw error;
      const waitMs = 1500 * (i + 1);
      console.warn(`[career-nightly] ${relScript} deadlock, retry in ${waitMs}ms`);
      sleepSync(waitMs);
    }
  }
  throw last;
}

/** Run career-dashboard ingest + morning apply report (env-gated). */
export function runCareerNightlyPipeline(input: {
  careerPath: string;
  force?: boolean;
}): CareerNightlyResult {
  const started = Date.now();
  const skipIngest = process.env.ATLAS_CAREER_SKIP_INGEST === "1";
  const enabled =
    !skipIngest &&
    (input.force ||
      process.env.ATLAS_CAREER_INGEST === "1" ||
      process.env.ATLAS_CAREER_INGEST === "true");

  if (!enabled) {
    return {
      ok: true,
      skipped: true,
      durationMs: Date.now() - started,
      error: skipIngest
        ? "ATLAS_CAREER_SKIP_INGEST=1 — using existing apply report"
        : "set ATLAS_CAREER_INGEST=1 to enable overnight ingest",
    };
  }

  if (!fs.existsSync(input.careerPath)) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: `career path missing: ${input.careerPath}`,
    };
  }

  const timeoutMs = Number(process.env.ATLAS_CAREER_INGEST_TIMEOUT_MS ?? 12 * 60_000);
  writeEllisBoardSnapshot(
    process.env.ATLAS_DATA_DIR?.trim() || path.resolve(process.cwd(), "data"),
    input.careerPath,
  );
  // Run tsx via node directly — nested `npm run` from launchd hits macOS EDEADLK.
  const useDailyApply = process.env.ATLAS_CAREER_DAILY_APPLY !== "0";
  if (useDailyApply) {
    try {
      runCareerTsx(input.careerPath, "scripts/ingest-job-alerts.ts", timeoutMs);
    } catch (error) {
      console.warn(
        `[career-nightly] ingest:alerts failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  try {
    runCareerTsx(input.careerPath, "workers/daily-run.ts", timeoutMs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[career-nightly] ingest failed: ${msg}`);
  }

  try {
    runCareerTsx(input.careerPath, "scripts/morning-apply-report.ts", 180_000);
  } catch (error) {
    return {
      ok: false,
      ingestOk: true,
      durationMs: Date.now() - started,
      error: `apply:report failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const reportPath = path.join(
    input.careerPath,
    "inbox",
    `${todayKey()}-apply-report.md`,
  );
  const latest = path.join(input.careerPath, "inbox", "apply-report-latest.md");
  const chosen = fs.existsSync(reportPath)
    ? reportPath
    : fs.existsSync(latest)
      ? latest
      : null;

  return {
    ok: Boolean(chosen),
    ingestOk: true,
    reportPath: chosen ?? undefined,
    reportText: chosen ? fs.readFileSync(chosen, "utf8").slice(0, 16_000) : undefined,
    durationMs: Date.now() - started,
    error: chosen ? undefined : "apply report file missing after run",
  };
}

export function readLatestApplyReport(careerPath: string): string | null {
  const candidates = [
    path.join(careerPath, "inbox", `${todayKey()}-apply-report.md`),
    path.join(careerPath, "inbox", "apply-report-latest.md"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").slice(0, 16_000);
    } catch {
      /* skip */
    }
  }
  return null;
}
