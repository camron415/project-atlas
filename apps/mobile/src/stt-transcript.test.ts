import assert from "node:assert/strict";
import { applySttPartialEvent, mergeSttChunkText, newSttTranscriptState } from "./stt-transcript";

function testMergeOverlap(): void {
  assert.equal(
    mergeSttChunkText("tell me about the weather", "weather in Denver today"),
    "tell me about the weather in Denver today",
  );
  console.log("  ok merge overlap");
}

function testCumulativeInterimNeverShrinks(): void {
  const state = newSttTranscriptState();
  applySttPartialEvent(state, { text: "tell me about the weather", is_final: false });
  applySttPartialEvent(state, { text: "tell me about", is_final: false });
  assert.equal(state.peak, "tell me about the weather");
  console.log("  ok cumulative interim never shrinks");
}

function testSlidingWindowStitch(): void {
  const state = newSttTranscriptState();
  applySttPartialEvent(state, { text: "hello world", is_final: true, speech_final: false });
  const display = applySttPartialEvent(state, { text: "world how are", is_final: false });
  assert.ok(display.includes("hello"));
  assert.ok(display.includes("how are"));
  console.log("  ok sliding window stitch");
}

function testSpeechFinal(): void {
  const state = newSttTranscriptState();
  applySttPartialEvent(state, { text: "one two", is_final: true, speech_final: false });
  const full = applySttPartialEvent(state, {
    text: "one two three four",
    is_final: true,
    speech_final: true,
  });
  assert.equal(full, "one two three four");
  console.log("  ok speech_final");
}

console.log("stt-transcript tests");
testMergeOverlap();
testCumulativeInterimNeverShrinks();
testSlidingWindowStitch();
testSpeechFinal();
console.log("All stt-transcript tests passed.");
