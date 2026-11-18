#!/usr/bin/env tsx
/**
 * End-of-Cursor-session closeout:
 * 1) optional session note → atlas/inbox
 * 2) re-export knowledge pack from live repos
 * 3) write LIVE-REPO-STATUS + WHERE_WE_LEFT_OFF
 * 4) rebuild PHONE-MORNING-BRIEF speak layer
 * 5) upload full pack to xAI Collection
 *
 * Usage:
 *   npm run refresh-phone-knowledge
 *   npm run refresh-phone-knowledge -- --note "Shipped speak-layer phone brief; Collection full sync"
 *   npm run refresh-phone-knowledge -- --skip-sync
 */
import "../load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueCloseSessionLoop } from "../agent/loop-close.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "../..");
const atlasRoot = path.resolve(serverRoot, "..");
const dataDir = path.resolve(
  serverRoot,
  process.env.ATLAS_DATA_DIR?.trim() || "./data",
);

const args = process.argv.slice(2);
function flag(name: string): boolean {
  return args.includes(name);
}

const noteParts: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--note") {
    noteParts.push(args[++i] ?? "");
  }
}

const result = await enqueueCloseSessionLoop({
  atlasRoot,
  dataDir,
  source: "cursor",
  note: noteParts.filter(Boolean).join(" ").trim() || undefined,
  skipExport: flag("--skip-export"),
  skipSync: flag("--skip-sync"),
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
