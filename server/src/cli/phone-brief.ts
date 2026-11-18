#!/usr/bin/env tsx
/**
 * Build phone morning brief (+ optional Collections sync).
 * Usage: npm run phone-brief [-- --force]
 */
import "../load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import { initCostLedger } from "../cost/ledger.js";
import { runPhoneBriefPipeline } from "../phone-brief/schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const db = getDb(dataDir);
initCostLedger(db);
const registry = loadRegistry();

const result = await runPhoneBriefPipeline({ db, registry, dataDir });
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(result.path);
if (result.sync) console.log(JSON.stringify(result.sync, null, 2));
