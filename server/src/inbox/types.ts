/** Phase 1.75 — inbox artifact types (implementation in store.ts). */

export type InboxProjectSlug = "atlas" | "vocallearn" | "career";

export interface InboxWriteRequest {
  project: InboxProjectSlug;
  title: string;
  body: string;
  sessionId?: string;
  analystJobId?: string;
}

export interface InboxWriteResult {
  path: string;
  project: InboxProjectSlug;
  writtenAt: string;
}
