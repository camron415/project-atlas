import type { ProjectRegistry } from "../projects/registry.js";
import { writeInboxArtifact } from "../inbox/store.js";
import { standupDecisionsFilenameForToday } from "./filenames.js";

export interface StandupDecisionInput {
  project: string;
  text: string;
  approvalDays?: number;
}

export function writeStandupDecisions(
  registry: ProjectRegistry,
  summary: string,
  decisions: StandupDecisionInput[] = [],
  db?: import("better-sqlite3").Database,
): { path: string } {
  const date = new Date().toISOString().slice(0, 10);
  const validUntil = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const table =
    decisions.length > 0
      ? [
          "| ID | Project | Decision | Valid until |",
          "|----|---------|----------|-------------|",
          ...decisions.map((dec, i) => {
            const days = dec.approvalDays ?? 1;
            return `| D-${date}-${i + 1} | ${dec.project} | ${dec.text.replace(/\|/g, "/")} | ${validUntil(days)} |`;
          }),
        ].join("\n")
      : "_No formal decisions recorded._";

  const body = [
    "## Summary",
    summary.trim() || "_Standup closed._",
    "",
    "## Decisions",
    table,
    "",
    "## Notes",
    "Default approval window: 1 day unless Camron specified otherwise.",
    "Re-open expired decisions in the next standup.",
  ].join("\n");

  const written = writeInboxArtifact(registry, {
    project: "atlas",
    title: "Standup decisions",
    body,
  }, db);

  return { path: written.path };
}

export function standupDecisionsBasenameToday(): string {
  return standupDecisionsFilenameForToday();
}
