/** Phase 1.75 — read-only analyst job types. */

export type AnalystJobStatus = "queued" | "running" | "done" | "error";

export interface AnalystRunRequest {
  projectSlug: string;
  focus: string;
  deep?: boolean;
}

export interface AnalystJob {
  id: string;
  projectSlug: string;
  focus: string;
  status: AnalystJobStatus;
  progress?: string;
  summaryMarkdown?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
