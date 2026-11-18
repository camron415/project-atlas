import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRegistry } from "../projects/registry.js";
import { slugifyInboxTitle, writeInboxArtifact } from "./store.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-inbox-test-"));
const atlasInbox = path.join(tmpRoot, "atlas", "inbox");

const registry = loadRegistry();
const atlasEntry = registry.projects.find((p) => p.slug === "atlas");
if (!atlasEntry) throw new Error("atlas project missing in registry");
atlasEntry.path = path.join(tmpRoot, "atlas");

fs.mkdirSync(atlasInbox, { recursive: true });

const result = writeInboxArtifact(registry, {
  project: "atlas",
  title: "Phase 1.75 kickoff",
  body: "## Summary\nTest inbox write.",
  sessionId: "cs-test",
});

if (!result.path.endsWith(".md")) throw new Error("expected .md path");
if (!fs.existsSync(result.path)) throw new Error("file not written");
const content = fs.readFileSync(result.path, "utf8");
if (!content.includes("Phase 1.75 kickoff")) throw new Error("title missing");
if (!content.includes("cs-test")) throw new Error("sessionId missing");

if (slugifyInboxTitle("Hello World!!!") !== "hello-world") {
  throw new Error("slugify failed");
}

const standup1 = writeInboxArtifact(registry, {
  project: "atlas",
  title: "Standup prep",
  body: "first standup body",
});
const standup2 = writeInboxArtifact(registry, {
  project: "atlas",
  title: "Standup prep",
  body: "second standup body",
});
if (standup1.path !== standup2.path) {
  throw new Error("standup-prep should overwrite the canonical daily file");
}
if (!fs.readFileSync(standup2.path, "utf8").includes("second standup body")) {
  throw new Error("standup-prep overwrite did not land");
}

const latest1 = writeInboxArtifact(registry, {
  project: "atlas",
  title: "LATEST",
  body: "first latest",
});
const latest2 = writeInboxArtifact(registry, {
  project: "atlas",
  title: "LATEST",
  body: "second latest",
});
if (latest1.path !== latest2.path) {
  throw new Error("latest should overwrite the canonical daily file");
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("inbox store tests passed");
