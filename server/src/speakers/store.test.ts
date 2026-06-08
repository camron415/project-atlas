import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../db/schema.js";
import {
  listSpeakerProfiles,
  remapSpeaker,
  resolveSpeaker,
  seedSpeakerProfiles,
} from "./store.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-speakers-"));
const db = getDb(tmpDir);
seedSpeakerProfiles(db);

function testSeed(): void {
  const profiles = listSpeakerProfiles(db);
  assert.equal(profiles.length, 2);
  const slugs = profiles.map((p) => p.slug).sort();
  assert.deepEqual(slugs, ["camron", "guest"]);
  console.log("  ok seed owner + guest");
}

function testAutoMap(): void {
  const owner = resolveSpeaker(db, "session-a", 0);
  assert.equal(owner.profile.slug, "camron");
  assert.match(owner.messagePrefix, /Camron/);

  const guest = resolveSpeaker(db, "session-a", 1);
  assert.equal(guest.profile.slug, "guest");
  assert.match(guest.messagePrefix, /guest/i);
  console.log("  ok auto-map speaker 0/1");
}

function testRemap(): void {
  const remapped = remapSpeaker(db, "session-b", 0, "guest");
  assert.equal(remapped.profile.slug, "guest");
  const again = resolveSpeaker(db, "session-b", 0);
  assert.equal(again.profile.slug, "guest");
  console.log("  ok manual remap");
}

console.log("speakers/store tests");
testSeed();
testAutoMap();
testRemap();
console.log("All speakers/store tests passed.");
