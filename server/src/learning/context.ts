import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistry } from "../projects/registry.js";
import { getActiveProjects } from "../projects/registry.js";

const MAX_CHARS = 14_000;

function readDoc(registry: ProjectRegistry, rel: string): string | null {
  const atlas = getActiveProjects(registry).find((p) => p.slug === "atlas");
  if (!atlas?.path) return null;
  const filePath = path.join(atlas.path, rel);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8").slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}

/** Inline learning docs for study mode (supplements FTS search_context). */
export function buildLearningMemoryBlock(registry: ProjectRegistry): string {
  const ledger = readDoc(registry, "docs/LEARNING_LEDGER.md");
  const policy = readDoc(registry, "docs/LEARNING_TUTOR.md");
  const parts: string[] = ["## Learning tutor memory"];
  if (ledger) {
    parts.push("### LEARNING_LEDGER.md\n" + ledger);
  } else {
    parts.push("_LEARNING_LEDGER.md not found — run search_context for learning._");
  }
  if (policy) {
    parts.push("### LEARNING_TUTOR.md (policy excerpt)\n" + policy.slice(0, 4000));
  }
  return parts.join("\n\n");
}
