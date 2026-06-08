import assert from "node:assert/strict";
import {
  buildXaiSttWebSocketUrl,
  getSttSessionConfig,
} from "./stt.js";

process.env.XAI_API_KEY = "test-key";
process.env.ATLAS_STT_SMART_TURN = "0.7";
process.env.ATLAS_STT_SMART_TURN_TIMEOUT = "4000";
process.env.ATLAS_STT_KEYTERMS = "Atlas,VocalLearn";

function testConfigDefaults(): void {
  const config = getSttSessionConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.sampleRate, 16000);
  assert.equal(config.smartTurn, 0.7);
  assert.equal(config.smartTurnTimeoutMs, 4000);
  assert.deepEqual(config.keyterms, ["Atlas", "VocalLearn"]);
  assert.equal(config.wsPath, "/stt/stream");
  console.log("  ok config defaults");
}

function testBuildUrl(): void {
  const url = new URL(buildXaiSttWebSocketUrl());
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/v1/stt");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
  assert.equal(url.searchParams.get("encoding"), "pcm");
  assert.equal(url.searchParams.get("interim_results"), "true");
  assert.equal(url.searchParams.get("smart_turn"), "0.7");
  assert.equal(url.searchParams.get("smart_turn_timeout"), "4000");
  assert.equal(url.searchParams.get("language"), "en");
  assert.equal(url.searchParams.getAll("keyterm").join(","), "Atlas,VocalLearn");
  console.log("  ok build URL with smart turn + keyterms");
}

function testDiarizeDefaultOn(): void {
  delete process.env.ATLAS_STT_DIARIZE;
  const url = new URL(buildXaiSttWebSocketUrl());
  assert.equal(url.searchParams.get("diarize"), "true");
  console.log("  ok diarize on by default");
}

function testDiarizeOptOut(): void {
  process.env.ATLAS_STT_DIARIZE = "0";
  const url = new URL(buildXaiSttWebSocketUrl());
  assert.equal(url.searchParams.get("diarize"), null);
  delete process.env.ATLAS_STT_DIARIZE;
  console.log("  ok diarize opt-out");
}

console.log("xai/stt tests");
testConfigDefaults();
testBuildUrl();
testDiarizeDefaultOn();
testDiarizeOptOut();
console.log("All xai/stt tests passed.");
