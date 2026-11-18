#!/usr/bin/env tsx
/**
 * Inspect + optionally wipe the phone-agent xAI Collection.
 * Does not print secrets. Writes a local inventory under server/data/.
 *
 *   npx tsx src/cli/inspect-phone-collection.ts
 *   npx tsx src/cli/inspect-phone-collection.ts --wipe
 */
import "../load-env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wipePhoneCollection } from "../xai/collections.js";

const FILES_URL = "https://api.x.ai/v1/files";
const MGMT_URL = "https://management-api.x.ai/v1";

function apiKey(): string {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY missing");
  return key;
}
function managementKey(): string {
  const key = process.env.XAI_MANAGEMENT_API_KEY?.trim();
  if (!key) throw new Error("XAI_MANAGEMENT_API_KEY missing");
  return key;
}
function collectionId(): string {
  const id = process.env.XAI_PHONE_COLLECTION_ID?.trim();
  if (!id) throw new Error("XAI_PHONE_COLLECTION_ID missing");
  return id;
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

async function listAllCollectionDocs(): Promise<{
  docs: Array<{ file_id?: string; name?: string }>;
  rawFirst?: unknown;
  pages: number;
}> {
  const docs: Array<{ file_id?: string; name?: string }> = [];
  let paginationToken: string | undefined;
  let pages = 0;
  let rawFirst: unknown;
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${MGMT_URL}/collections/${collectionId()}/documents`);
    url.searchParams.set("limit", "100");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${managementKey()}` },
    });
    if (!res.ok) {
      throw new Error(`list documents failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      documents?: Array<Record<string, unknown>>;
      pagination_token?: string;
    };
    pages += 1;
    const batch = data.documents ?? [];
    if (!rawFirst && batch[0]) rawFirst = Object.keys(batch[0]);
    for (const row of batch) docs.push(normalizeCollectionDoc(row));
    if (batch.length < 100 || !data.pagination_token) break;
    paginationToken = data.pagination_token;
  }
  return { docs, rawFirst, pages };
}

async function getCollection(): Promise<Record<string, unknown>> {
  const res = await fetch(`${MGMT_URL}/collections/${collectionId()}`, {
    headers: { Authorization: `Bearer ${managementKey()}` },
  });
  if (!res.ok) throw new Error(`get collection failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

async function listAllFiles(): Promise<{ count: number; names: string[] }> {
  const names: string[] = [];
  let paginationToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const url = new URL(FILES_URL);
    url.searchParams.set("limit", "100");
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) {
      throw new Error(`list files failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string; filename?: string; name?: string }>;
      files?: Array<{ id?: string; filename?: string; name?: string }>;
      pagination_token?: string;
    };
    const batch = data.data ?? data.files ?? [];
    for (const f of batch) names.push(f.filename ?? f.name ?? f.id ?? "?");
    if (batch.length < 100 || !data.pagination_token) break;
    paginationToken = data.pagination_token;
  }
  return { count: names.length, names };
}

function nameCounts(names: Array<string | undefined>): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const n of names) {
    const key = n?.trim() || "(unnamed)";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

const wipe = process.argv.includes("--wipe");
const deleteOrphans = process.argv.includes("--delete-files");

const collection = await getCollection();
const listed = await listAllCollectionDocs();
const dupes = nameCounts(listed.docs.map((d) => d.name)).filter(([, n]) => n > 1);
const missingId = listed.docs.filter((d) => !d.file_id).length;

let files: { count: number; names: string[] } | { error: string } = { count: 0, names: [] };
try {
  files = await listAllFiles();
} catch (error) {
  files = { error: error instanceof Error ? error.message : String(error) };
}

const summary = {
  collection_id_prefix: `${collectionId().slice(0, 18)}…`,
  collection_name: collection.collection_name ?? collection.name,
  documents_count_api: collection.documents_count ?? collection.document_count,
  documents_listed: listed.docs.length,
  documents_missing_file_id: missingId,
  list_pages: listed.pages,
  raw_doc_keys: listed.rawFirst,
  unique_names: nameCounts(listed.docs.map((d) => d.name)).length,
  duplicate_names: dupes.slice(0, 25),
  files_api: "error" in files ? files : { count: files.count, unique_names: nameCounts(files.names).length, top_dupes: nameCounts(files.names).filter(([, n]) => n > 1).slice(0, 15) },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../../data/collection-inventory.json");
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`inventory → ${outPath}`);

if (!wipe) {
  console.log("Re-run with --wipe --delete-files to empty the Collection and delete leftover uploads.");
  process.exit(0);
}

const wiped = await wipePhoneCollection({ deleteFiles: deleteOrphans });
const after = await getCollection();
console.log(JSON.stringify({
  wiped: true,
  ...wiped,
  documents_count_after: after.documents_count ?? after.document_count,
}, null, 2));
