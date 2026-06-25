#!/usr/bin/env tsx
/**
 * Run project manager reports → {project}/inbox/YYYY-MM-DD-manager.md
 * Usage: npm run manager -- vocallearn [--force]
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import { initCostLedger } from "../cost/ledger.js";
import { resolveAnalystProject } from "../analyst/registry-slugs.js";
import { runManagers, parseManagerProjects } from "../managers/run.js";

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
for (const result of results) {
  if (result.skipped) {
    console.log(`${result.project}: skipped (already exists today)`);
    continue;
  }
  if (result.ok) {
    console.log(`${result.project}: ${result.path}`);
    continue;
  }
  console.error(`${result.project}: ${result.error ?? "failed"}`);
  exitCode = 1;
}

process.exit(exitCode);
