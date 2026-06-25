import assert from "node:assert/strict";
import { isConfirm, isCancel, stripMessageForRouting } from "./routing.js";

assert.equal(stripMessageForRouting("[Speaker: Camron (owner)] Yes."), "Yes.");
assert.ok(isConfirm("[Speaker: Camron (owner)] Yes"));
assert.ok(isCancel("no thanks"));
assert.ok(isCancel("cancel that"));
assert.equal(stripMessageForRouting("[Field report monologue — x] review atlas"), "review atlas");

console.log("voice/routing.test.ts: ok");
