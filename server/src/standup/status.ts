import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import { listStandupPreps } from "./context.js";
import { isStandupActive } from "./session-state.js";

export interface StandupStatus {
  date: string;
  standupActive: boolean;
  ready: boolean;
  reportingCount: number;
  preps: Array<{
    project: string;
    managerName: string;
    ready: boolean;
    skip: boolean;
    path: string | null;
  }>;
  openingHint: string;
}

export function getStandupStatus(
  _db: Database.Database,
  registry: ProjectRegistry,
  chatSessionId?: string,
): StandupStatus {
  const preps = listStandupPreps(registry);
  const reporting = preps.filter((p) => p.path && !p.skip);
  const date = new Date().toISOString().slice(0, 10);
  const ready = reporting.length > 0;

  const names = reporting.map((p) => p.managerName).join(", ") || "no departments";
  const openingHint = ready
    ? `Good morning, sir. Standup for ${date}. ${reporting.length} department(s) ready: ${names}. Shall I call on Sloane first?`
    : `Standup prep is not ready yet, sir. Run manager prep or wait for the scheduled scan.`;

  return {
    date,
    standupActive: isStandupActive(chatSessionId),
    ready,
    reportingCount: reporting.length,
    preps: preps.map((p) => ({
      project: p.project,
      managerName: p.managerName,
      ready: Boolean(p.path),
      skip: p.skip,
      path: p.path,
    })),
    openingHint,
  };
}
