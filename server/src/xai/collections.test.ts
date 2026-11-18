import assert from "node:assert/strict";
import { normalizeCollectionDoc } from "./collections.js";

const nested = normalizeCollectionDoc({
  file_metadata: { file_id: "file_abc", name: "HANDOFF.md" },
  status: "DOCUMENT_STATUS_PROCESSED",
});
assert.equal(nested.file_id, "file_abc");
assert.equal(nested.name, "HANDOFF.md");

const flat = normalizeCollectionDoc({ file_id: "file_flat", name: "LATEST.md" });
assert.equal(flat.file_id, "file_flat");
assert.equal(flat.name, "LATEST.md");

console.log("collections normalizeCollectionDoc ok");
