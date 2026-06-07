import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { getActiveProjects, loadRegistry } from "../projects/registry.js";
import { syncProjectsToDb } from "../projects/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");

const registry = loadRegistry();
const db = getDb(dataDir);
const snapshots = syncProjectsToDb(db, getActiveProjects(registry));

console.log(`Scanned ${snapshots.length} active project(s):`);
for (const snap of snapshots) {
  console.log(`- ${snap.slug} @ ${snap.path} (${snap.gitHead?.slice(0, 8) ?? "no git"})`);
}
