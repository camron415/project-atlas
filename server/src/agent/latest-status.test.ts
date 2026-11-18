import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLatestStatusMarkdown, recentInboxNotes } from "./latest-status.js";
import { loadRegistry } from "../projects/registry.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-latest-"));
const vlInbox = path.join(tmp, "vl-inbox");
fs.mkdirSync(vlInbox, { recursive: true });
fs.writeFileSync(
  path.join(vlInbox, "2026-08-26-cursor-session.md"),
  "Keep beads drop to home as mastery mini-games.",
);
fs.writeFileSync(
  path.join(vlInbox, "2020-01-01-ancient.md"),
  "This ancient note should be ignored.",
);

const recent = recentInboxNotes(vlInbox, { maxFiles: 8, maxAgeDays: 7 });
assert.equal(recent.length, 1, "should skip notes older than 7 days");
assert.match(recent[0]!.body, /Keep beads/);

const registry = loadRegistry();
const atlasRoot = path.join(tmp, "atlas");
const dataDir = path.join(tmp, "data");
fs.mkdirSync(path.join(atlasRoot, "inbox"), { recursive: true });
const md = buildLatestStatusMarkdown({
  atlasRoot,
  dataDir,
  registry,
  sessionNote: "Paper heat pass shipped; Keep vision is the live Halo track.",
});
assert.match(md, /THIS FILE SUPERSEDES/);
assert.match(md, /Paper heat pass/);
assert.match(md, /LATEST/);

console.log("latest-status tests ok");
