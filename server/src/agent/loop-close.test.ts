import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inferProjectFromWorkspace,
  loopCloseIsStale,
  readLoopCloseStamp,
  writeLoopCloseStamp,
  type LoopCloseStamp,
} from "./loop-close.js";
import { loopNoteSlug, writeCursorSessionNote } from "../phone-brief/refresh-knowledge.js";
import { buildWhereWeLeftOff } from "./where-we-left-off.js";
import { loadRegistry } from "../projects/registry.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-loop-close-"));
const atlasRoot = path.join(tmp, "atlas");
const dataDir = path.join(tmp, "data");
fs.mkdirSync(path.join(atlasRoot, "inbox"), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

assert.equal(inferProjectFromWorkspace("/Users/me/vocalLearn"), "vocallearn");
assert.equal(inferProjectFromWorkspace("/Users/me/career-planning-roadmap/career-dashboard"), "career");
assert.equal(inferProjectFromWorkspace("/Users/me/projects/atlas"), "atlas");
assert.equal(inferProjectFromWorkspace("/tmp/unrelated"), undefined);

assert.equal(loopNoteSlug("phone"), "phone-call");
assert.equal(loopNoteSlug("manager"), "manager-run");
assert.equal(loopNoteSlug("cursor"), "cursor-session");

const cursorNote = writeCursorSessionNote({
  atlasRoot,
  note: "Shipped Halo-first Sloane prompt.",
  source: "cursor",
});
assert.match(cursorNote, /cursor-session\.md$/);
assert.ok(fs.readFileSync(cursorNote, "utf8").includes("Shipped Halo-first"));

const phoneNote = writeCursorSessionNote({
  atlasRoot,
  note: "Standup closed: commit Halo working tree.",
  source: "phone",
});
assert.match(phoneNote, /phone-call\.md$/);

const stamp: LoopCloseStamp = {
  at: new Date().toISOString(),
  source: "cursor",
  notePreview: "Shipped Halo-first Sloane prompt.",
  exportOk: true,
  collectionSyncedAt: new Date().toISOString(),
  collectionOk: true,
  errors: [],
};
writeLoopCloseStamp(dataDir, stamp);
const read = readLoopCloseStamp(dataDir);
assert.equal(read?.source, "cursor");
assert.equal(loopCloseIsStale(read, 36), false);
assert.equal(loopCloseIsStale({ ...stamp, at: "2020-01-01T00:00:00.000Z" }, 36), true);

const registry = loadRegistry();
const where = buildWhereWeLeftOff({ atlasRoot, dataDir, registry });
assert.equal(where.ok, true);
assert.equal(where.stale, false);
assert.match(where.context, /Last Collection dump|Last dump into the loop|00-LATEST|THIS FILE SUPERSEDES/);
assert.match(where.context, /Shipped Halo-first/);

console.log("loop-close tests ok");
