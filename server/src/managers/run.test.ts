import test from "node:test";
import assert from "node:assert/strict";
import {
  parseManagerProjects,
  managerReportExistsForToday,
  standupPrepFilenameForToday,
} from "./projects.js";
import { loadRegistry } from "../projects/registry.js";

test("parseManagerProjects defaults to vocallearn", () => {
  assert.deepEqual(parseManagerProjects(""), ["vocallearn"]);
  assert.deepEqual(parseManagerProjects("vocallearn"), ["vocallearn"]);
});

test("parseManagerProjects supports vocallearn alias", () => {
  assert.deepEqual(parseManagerProjects("vocalllearn"), ["vocallearn"]);
});

test("standupPrepFilenameForToday uses standup-prep slug", () => {
  const datePrefix = new Date().toISOString().slice(0, 10);
  assert.equal(standupPrepFilenameForToday(), `${datePrefix}-standup-prep.md`);
});

test("managerReportExistsForToday is false when inbox missing", () => {
  const registry = loadRegistry();
  assert.equal(managerReportExistsForToday(registry, "vocallearn"), false);
});
