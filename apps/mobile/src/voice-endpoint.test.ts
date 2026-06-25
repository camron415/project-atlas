/**
 * Adaptive silence timing tests.
 * Run: npm run test:voice
 */
import assert from "node:assert/strict";
import {
  computeSilenceSubmitMs,
  computeSpeechFinalSubmitMs,
  countWords,
  LISTEN_IDLE_FALLBACK_MS,
} from "./voice-endpoint";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

console.log("voice-endpoint tests");

test("short phrase gets ~1.5s minimum (Apple STT path)", () => {
  assert.equal(computeSilenceSubmitMs("hi"), 1500);
});

test("speech_final debounce is immediate for normal utterances", () => {
  assert.equal(computeSpeechFinalSubmitMs("tell me about the weather today please"), 0);
});

test("speech_final debounce waits briefly for short ambiguous finals", () => {
  assert.equal(computeSpeechFinalSubmitMs("tell me about"), 150);
});

test("idle fallback slightly above server smart turn timeout", () => {
  assert.equal(LISTEN_IDLE_FALLBACK_MS, 3_000);
});

test("medium phrase gets 1.6s+", () => {
  const text = "I need to update the atlas project with the latest context from my repos";
  assert.ok(countWords(text) > 12);
  assert.ok(computeSilenceSubmitMs(text) >= 1600);
});

test("long monologue gets max pause window", () => {
  const text = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
  assert.equal(computeSilenceSubmitMs(text), 4000);
});

console.log("\nAll voice-endpoint tests passed.");
