import "../load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/schema.js";
import { getActiveProjects, loadRegistry } from "../projects/registry.js";
import {
  projectsNeedingRefresh,
  syncProjectsToDb,
} from "../projects/scanner.js";
import {
  buildContextManifest,
  getLatestReports,
  getLatestReportForProject,
  storeProjectReport,
} from "../reports/store.js";
import { synthesizeProjectReport } from "../reports/synthesize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(__dirname, "../../data");
const deep = process.argv.includes("--deep");
const force = process.argv.includes("--force") || deep;

const registry = loadRegistry();
const db = getDb(dataDir);
const active = getActiveProjects(registry);
const snapshots = syncProjectsToDb(db, active, { deep });
const refreshed = force ? snapshots : projectsNeedingRefresh(db, snapshots);

for (const snap of refreshed) {
  let enriched = snap;
  if (deep && enriched.codeInventory && process.env.XAI_API_KEY) {
    console.log(`Synthesizing ${snap.slug}…`);
    const llmSummary = await synthesizeProjectReport(enriched);
    if (llmSummary) enriched = { ...enriched, llmSummary };
  }
  storeProjectReport(db, enriched, deep ? "cli-deep" : "cli-refresh");
}

console.log(`Refreshed ${refreshed.length} report(s) deep=${deep}. Manifest:`);
for (const entry of buildContextManifest(db)) {
  console.log(
    `- ${entry.projectSlug}: deep=${entry.deepScan} files=${entry.totalFiles} read=${entry.filesDeepRead} ai=${entry.hasLlmSummary}`,
  );
}

for (const report of getLatestReports(db)) {
  console.log(`\n[${report.projectSlug}] updated ${report.createdAt}`);
  console.log(report.summary.slice(0, 500) + "...");
}
