import type Database from "better-sqlite3";
import { getAnalystJob } from "./store.js";

export async function waitForAnalystJob(
  db: Database.Database,
  jobId: string,
  maxMs = 120_000,
): Promise<ReturnType<typeof getAnalystJob>> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const job = getAnalystJob(db, jobId);
    if (!job) return null;
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return getAnalystJob(db, jobId);
}
