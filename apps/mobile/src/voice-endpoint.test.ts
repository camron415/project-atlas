/**
 * Adaptive silence timing tests.
 * Run: npm run test:voice
 */
import assert from "node:assert/strict";
import { computeSilenceSubmitMs, countWords } from "./voice-endpoint";

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

test("short phrase gets ~0.8s minimum", () => {
  assert.equal(computeSilenceSubmitMs("hi"), 800);
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
