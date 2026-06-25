import assert from "node:assert/strict";
import { getDb } from "../db/schema.js";
import { loadRegistry } from "../projects/registry.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureFtsSchema,
  rebuildContextIndex,
  searchContext,
} from "./search.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-fts-"));
const db = getDb(tmpDir);
const registry = loadRegistry();

ensureFtsSchema(db);
db.prepare(
  `INSERT INTO projects (slug, name, priority, status, path)
   VALUES ('atlas', 'Atlas', 0, 'active', ?)`,
).run(path.join(tmpDir, "atlas"));
db.prepare(
  `INSERT INTO project_reports (project_slug, summary, context_json, source)
   VALUES (?, ?, '{}', 'test')`,
).run("atlas", "Atlas voice economy field test three uses Grok STT and FTS retrieval.");

const count = rebuildContextIndex(db, registry);
assert.ok(count >= 1, `expected indexed docs, got ${count}`);

const hits = searchContext(db, registry, "voice economy FTS", 5);
assert.ok(hits.length >= 1, "expected FTS hit for voice economy");
assert.ok(hits[0]!.snippet.toLowerCase().includes("voice") || hits[0]!.source.includes("report"));

console.log("context/search.test.ts: ok");
