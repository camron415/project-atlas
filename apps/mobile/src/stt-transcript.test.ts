import assert from "node:assert/strict";
import {
  applySttPartialEvent,
  collapseStutteredTokens,
  mergeSttChunkText,
  normalizeSttUtterance,
  newSttTranscriptState,
} from "./stt-transcript";

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

function testDuplicateChunkIgnored(): void {
  const state = newSttTranscriptState();
  applySttPartialEvent(state, { text: "what time is it", is_final: false });
  const display = applySttPartialEvent(state, { text: "what time is it what time is it", is_final: false });
  assert.equal(display, "what time is it");
  console.log("  ok duplicate chunk ignored");
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

function testStutterCollapse(): void {
  assert.equal(normalizeSttUtterance("Check, check, check, check"), "Check, Check");
  assert.equal(collapseStutteredTokens("check check check check"), "check check");
  console.log("  ok stutter collapse");
}

function testSpeechFinalReplacesInterim(): void {
  const state = newSttTranscriptState();
  applySttPartialEvent(state, {
    text: "Can you have the analyst review the code and report? What the next?",
    is_final: false,
  });
  const final = applySttPartialEvent(state, {
    text: "Can you have the analyst review the code and roadmap and then tell me what the next step in project Atlas should be?",
    is_final: true,
    speech_final: true,
  });
  assert.ok(!final.includes("What the next?"));
  assert.ok(final.includes("roadmap"));
  console.log("  ok speech_final replaces interim");
}

function testDedupeRevisedUtterance(): void {
  const duped =
    "Can you have the analyst review the code? What the next step? Can you have the analyst review the code and roadmap and tell me the next step?";
  const cleaned = normalizeSttUtterance(duped);
  assert.equal(cleaned.split("Can you have").length - 1, 1);
  console.log("  ok dedupe revised utterance");
}

console.log("stt-transcript tests");
testStutterCollapse();
testSpeechFinalReplacesInterim();
testDedupeRevisedUtterance();
testMergeOverlap();
testCumulativeInterimNeverShrinks();
testSlidingWindowStitch();
testDuplicateChunkIgnored();
testSpeechFinal();
console.log("All stt-transcript tests passed.");
