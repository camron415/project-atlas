#!/usr/bin/env tsx
/**
 * Run a read-only analyst review from the CLI.
 * Usage: npm run analyst -- atlas "architecture and risks"
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import { enqueueAnalystJob } from "../analyst/run.js";
import { getAnalystJob } from "../analyst/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const project = process.argv[2];
const focus = process.argv.slice(3).join(" ").trim();

if (!project || !focus) {
  console.error("Usage: npm run analyst -- <project> <focus prompt>");
  console.error("Projects: atlas | vocallearn | career");
  process.exit(1);
}

const db = getDb(dataDir);
const registry = loadRegistry();
const { jobId } = enqueueAnalystJob({ db, registry, dataDir }, {
  project,
  focus,
  userIntent: focus,
  deep: process.argv.includes("--deep"),
});

console.log(`Analyst job queued: ${jobId}`);

const wait = async () => {
  for (let i = 0; i < 120; i++) {
    const job = getAnalystJob(db, jobId);
    if (!job) {
      console.error("Job disappeared");
      process.exit(1);
    }
    if (job.status === "done") {
      console.log("\n--- Analyst brief ---\n");
      console.log(job.summaryMarkdown ?? "(empty)");
      process.exit(0);
    }
    if (job.status === "error") {
      console.error("Analyst failed:", job.error);
      process.exit(1);
    }
    process.stdout.write(`\r${job.progress ?? job.status}...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("\nTimed out waiting for analyst job");
  process.exit(1);
};

void wait();
