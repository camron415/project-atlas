import assert from "node:assert/strict";
import { formatXaiQuotaError, isXaiQuotaError } from "./xai-errors";

function testStt429(): void {
  const err = new Error("Unexpected server response: 429");
  assert.equal(isXaiQuotaError(err), true);
  assert.match(formatXaiQuotaError(err), /429/);
  console.log("  ok STT 429");
}

function testRealtimeExhausted(): void {
  const err = new Error(
    'Realtime client secret failed (429): {"error":"Some resource has been exhausted"}',
  );
  assert.equal(isXaiQuotaError(err), true);
  assert.match(formatXaiQuotaError(err), /quota|429|Billing/i);
  console.log("  ok realtime exhausted");
}

function testPassthrough(): void {
  const err = new Error("network failed");
  assert.equal(isXaiQuotaError(err), false);
  assert.equal(formatXaiQuotaError(err), "network failed");
  console.log("  ok passthrough");
}

console.log("xai-errors tests");
testStt429();
testRealtimeExhausted();
testPassthrough();
console.log("all passed");
