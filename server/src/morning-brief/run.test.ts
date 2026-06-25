import test from "node:test";
import assert from "node:assert/strict";
import {
  morningBriefFilenameForToday,
  parseMorningBriefProjects,
} from "./run.js";

test("parseMorningBriefProjects defaults to atlas", () => {
  assert.deepEqual(parseMorningBriefProjects(""), ["atlas"]);
  assert.deepEqual(parseMorningBriefProjects("atlas"), ["atlas"]);
});

test("parseMorningBriefProjects supports atlas and vocallearn", () => {
  assert.deepEqual(parseMorningBriefProjects("atlas,vocallearn"), [
    "atlas",
    "vocallearn",
  ]);
});

test("morningBriefFilenameForToday uses morning slug", () => {
  const datePrefix = new Date().toISOString().slice(0, 10);
  assert.equal(morningBriefFilenameForToday(), `${datePrefix}-morning.md`);
});
