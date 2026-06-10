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
  userIntent?: string;
  status: AnalystJobStatus;
  progress?: string;
  summaryMarkdown?: string;
  error?: string;
  deep?: boolean;
  createdAt: string;
  updatedAt: string;
}
