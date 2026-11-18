import fs from "node:fs";
import path from "node:path";

const FILES_URL = "https://api.x.ai/v1/files";
const MGMT_URL = "https://management-api.x.ai/v1";

export interface CollectionSyncResult {
  ok: boolean;
  uploaded: string[];
  skipped: string[];
  errors: string[];
}

function apiKey(): string {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY required for Collections upload");
  return key;
}

function managementKey(): string {
  const key = process.env.XAI_MANAGEMENT_API_KEY?.trim();
  if (!key) throw new Error("XAI_MANAGEMENT_API_KEY required for Collections upload");
  return key;
}

function collectionId(): string {
  const id = process.env.XAI_PHONE_COLLECTION_ID?.trim();
  if (!id) throw new Error("XAI_PHONE_COLLECTION_ID required");
  return id;
}

async function uploadFile(filePath: string, name: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buf)], { type: "text/markdown" }),
    name,
  );
  form.append("purpose", "assistants");

  const res = await fetch(FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`file upload failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("file upload missing id");
  return data.id;
}

async function addToCollection(fileId: string): Promise<void> {
  const res = await fetch(
    `${MGMT_URL}/collections/${collectionId()}/documents/${fileId}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${managementKey()}` },
    },
  );
  if (!res.ok) {
    throw new Error(`add to collection failed (${res.status}): ${await res.text()}`);
  }
}

export function normalizeCollectionDoc(raw: Record<string, unknown>): {
  file_id?: string;
  name?: string;
} {
  const meta = (raw.file_metadata ?? raw.fileMetadata ?? raw) as Record<string, unknown>;
  const fileId =
    (typeof raw.file_id === "string" && raw.file_id) ||
    (typeof meta.file_id === "string" && meta.file_id) ||
    (typeof raw.id === "string" && raw.id) ||
    undefined;
  const name =
    (typeof raw.name === "string" && raw.name) ||
    (typeof meta.name === "string" && meta.name) ||
    (typeof raw.file_name === "string" && raw.file_name) ||
    (typeof meta.file_name === "string" && meta.file_name) ||
    undefined;
  return { file_id: fileId, name };
}

async function listCollectionDocs(): Promise<Array<{ file_id?: string; name?: string }>> {
  const out: Array<{ file_id?: string; name?: string }> = [];
  let paginationToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${MGMT_URL}/collections/${collectionId()}/documents`);
    url.searchParams.set("limit", "100");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${managementKey()}` },
    });
    if (!res.ok) break;
    const data = (await res.json()) as {
      documents?: Array<Record<string, unknown>>;
      pagination_token?: string;
    };
    const batch = data.documents ?? [];
    for (const row of batch) out.push(normalizeCollectionDoc(row));
    if (batch.length < 100 || !data.pagination_token) break;
    paginationToken = data.pagination_token;
  }
  return out;
}

async function removeDoc(fileId: string): Promise<void> {
  const res = await fetch(`${MGMT_URL}/collections/${collectionId()}/documents/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${managementKey()}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`remove collection doc failed (${res.status}): ${await res.text()}`);
  }
}

async function deleteUploadedFile(fileId: string): Promise<void> {
  const res = await fetch(`${FILES_URL}/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete file failed (${res.status}): ${await res.text()}`);
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      const item = items[i];
      if (item === undefined) continue;
      try {
        await fn(item);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

/** Unlink every document in the phone Collection (and optionally delete the Files API objects). */
export async function wipePhoneCollection(options?: {
  deleteFiles?: boolean;
}): Promise<{ listed: number; removed: number; failed: number }> {
  const existing = await listCollectionDocs();
  const ids = existing.map((d) => d.file_id).filter((id): id is string => Boolean(id));
  const result = await mapPool(ids, 8, async (fileId) => {
    await removeDoc(fileId);
    if (options?.deleteFiles) await deleteUploadedFile(fileId);
  });
  return { listed: existing.length, removed: result.ok, failed: result.failed };
}

/** Upload daily phone brief (and optional extras). Replaces prior PHONE-MORNING-BRIEF*.md docs when found. */
export async function syncPhoneBriefToCollection(
  briefPath: string,
  extraPaths: string[] = [],
): Promise<CollectionSyncResult> {
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  if (process.env.ATLAS_PHONE_COLLECTION_SYNC !== "1") {
    return {
      ok: true,
      uploaded,
      skipped: ["sync disabled (set ATLAS_PHONE_COLLECTION_SYNC=1)"],
      errors,
    };
  }

  try {
    managementKey();
    collectionId();
  } catch (error) {
    return {
      ok: false,
      uploaded,
      skipped,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  try {
    const existing = await listCollectionDocs();
    for (const doc of existing) {
      const name = doc.name ?? "";
      if (/PHONE-MORNING-BRIEF/i.test(name) && doc.file_id) {
        try {
          await removeDoc(doc.file_id);
        } catch {
          /* best effort */
        }
      }
    }
  } catch (error) {
    errors.push(
      `list/remove prior briefs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const files = [briefPath, ...extraPaths].filter((p) => p && fs.existsSync(p));
  for (const filePath of files) {
    const name = path.basename(filePath);
    try {
      const fileId = await uploadFile(filePath, name);
      await addToCollection(fileId);
      uploaded.push(name);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: errors.length === 0, uploaded, skipped, errors };
}

export function collectionSyncConfigured(): boolean {
  return (
    process.env.ATLAS_PHONE_COLLECTION_SYNC === "1" &&
    Boolean(process.env.XAI_MANAGEMENT_API_KEY?.trim()) &&
    Boolean(process.env.XAI_PHONE_COLLECTION_ID?.trim())
  );
}

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(md|txt|json)$/i.test(entry.name)) continue;
    // Skip resume-data.ts-style binaries; keep json/md/txt only
    out.push(full);
  }
  return out;
}

/** Unique collection document name (folder__file) so HANDOFF.md from multiple projects don't collide. */
export function collectionDocName(packRoot: string, filePath: string): string {
  const rel = path.relative(packRoot, filePath).replace(/\\/g, "/");
  return rel.replace(/\//g, "__");
}

/**
 * Re-export full phone knowledge pack into the xAI Collection.
 * Replaces prior pack docs (names containing known prefixes / matching basenames).
 */
export async function syncKnowledgePackToCollection(
  packRoot: string,
): Promise<CollectionSyncResult> {
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  if (process.env.ATLAS_PHONE_COLLECTION_SYNC !== "1") {
    return {
      ok: true,
      uploaded,
      skipped: ["sync disabled (set ATLAS_PHONE_COLLECTION_SYNC=1)"],
      errors,
    };
  }

  try {
    managementKey();
    collectionId();
    apiKey();
  } catch (error) {
    return {
      ok: false,
      uploaded,
      skipped,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const files = walkMarkdownFiles(packRoot);
  if (files.length === 0) {
    return { ok: false, uploaded, skipped, errors: [`no files under ${packRoot}`] };
  }

  try {
    const wiped = await wipePhoneCollection({ deleteFiles: true });
    if (wiped.failed) {
      errors.push(`wipe incomplete: removed ${wiped.removed}/${wiped.listed}, failed ${wiped.failed}`);
    }
  } catch (error) {
    errors.push(
      `list/remove prior pack: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const filePath of files) {
    const name = collectionDocName(packRoot, filePath);
    try {
      const fileId = await uploadFile(filePath, name);
      await addToCollection(fileId);
      uploaded.push(name);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: errors.length === 0, uploaded, skipped, errors };
}
