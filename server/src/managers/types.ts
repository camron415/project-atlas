import type Database from "better-sqlite3";
import type { ProjectRegistry } from "../projects/registry.js";
import type { AnalystRunDeps } from "../analyst/run.js";
import type { InboxProjectSlug } from "../inbox/types.js";

export type ManagerRunDeps = AnalystRunDeps;

export interface ManagerRunResult {
  project: InboxProjectSlug;
  ok: boolean;
  path?: string;
  skipped?: boolean;
  error?: string;
  analystJobId?: string;
}

export interface ManagerSchedulerStatus {
  enabled: boolean;
  hour: number;
  minute: number;
  projects: InboxProjectSlug[];
  lastRunDate: string | null;
}
