#!/usr/bin/env tsx
/**
 * Run the morning inbox brief (analyst scan → inbox/YYYY-MM-DD-morning.md).
 * Usage: npm run morning-brief [-- --force] [-- atlas,vocallearn]
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import {
  parseMorningBriefProjects,
  runMorningBrief,
} from "../morning-brief/run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const args = process.argv.slice(2);
const force = args.includes("--force");
const projectArg = args.find((a) => !a.startsWith("--"));
const projects = projectArg
  ? parseMorningBriefProjects(projectArg)
  : parseMorningBriefProjects();

const db = getDb(dataDir);
const registry = loadRegistry();
const deps = { db, registry, dataDir };

console.log(`Morning brief for: ${projects.join(", ")}${force ? " (force)" : ""}`);

const results = await runMorningBrief(deps, projects, { force });

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
