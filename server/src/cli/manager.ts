#!/usr/bin/env tsx
/**
 * Run project manager reports → {project}/inbox/YYYY-MM-DD-manager.md
 * Usage: npm run manager -- vocallearn [--force]
 */
import "../load-env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import { initCostLedger } from "../cost/ledger.js";
import { resolveAnalystProject } from "../analyst/registry-slugs.js";
import { runManagers, parseManagerProjects } from "../managers/run.js";
import { enqueueCloseSessionLoop } from "../agent/loop-close.js";

function writeLastRunDate(dataDir: string, dateKey: string): void {
  fs.writeFileSync(path.join(dataDir, "manager-last-run.txt"), `${dateKey}\n`, "utf8");
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const args = process.argv.slice(2);
const force = args.includes("--force");
const projectArg = args.find((a) => !a.startsWith("--"));
const projects = projectArg
  ? (() => {
      const p = resolveAnalystProject(projectArg);
      return p ? [p] : parseManagerProjects(projectArg);
    })()
  : parseManagerProjects();

const db = getDb(dataDir);
initCostLedger(db);
const registry = loadRegistry();
const deps = { db, registry, dataDir };

console.log(`Manager run for: ${projects.join(", ")}${force ? " (force)" : ""}`);

const results = await runManagers(deps, projects, { force });

let exitCode = 0;
let anyOk = false;
for (const result of results) {
  if (result.skipped) {
    console.log(`${result.project}: skipped (already exists today)`);
    anyOk = true;
    continue;
  }
  if (result.ok) {
    console.log(`${result.project}: ${result.path}`);
    anyOk = true;
    continue;
  }
  console.error(`${result.project}: ${result.error ?? "failed"}`);
  exitCode = 1;
}

if (anyOk) {
  writeLastRunDate(dataDir, localDateKey());
  const atlasRoot = path.resolve(__dirname, "../../..");
  const wrote = results.filter((r) => r.ok && !r.skipped).map((r) => r.project);
  const skipped = results.filter((r) => r.skipped).map((r) => r.project);
  try {
    const dump = await enqueueCloseSessionLoop({
      atlasRoot,
      dataDir,
      db,
      registry,
      source: "manager",
      note: [
        `Manager CLI finished for ${projects.join(", ")}.`,
        wrote.length ? `Wrote: ${wrote.join(", ")}.` : "",
        skipped.length ? `Skipped: ${skipped.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
    console.log(JSON.stringify({ loop: dump.ok, errors: dump.errors, stamp: dump.stamp }, null, 2));
  } catch (error) {
    console.warn(`[manager] Loop dump error: ${error instanceof Error ? error.message : error}`);
  }
}

process.exit(exitCode);
