import assert from "node:assert/strict";
import { dominantSttSpeaker, httpBaseToWs } from "./xai-stt";

function testHttpToWs(): void {
  assert.equal(
    httpBaseToWs("http://macbook.tail5f7dec.ts.net:8787", "/stt/stream"),
    "ws://macbook.tail5f7dec.ts.net:8787/stt/stream",
  );
  assert.equal(
    httpBaseToWs("https://atlas.example.com", "/stt/stream"),
    "wss://atlas.example.com/stt/stream",
  );
  console.log("  ok http → ws URL");
}

function testDominantSpeaker(): void {
  assert.equal(
    dominantSttSpeaker([
      { text: "hi", speaker: 0 },
      { text: "there", speaker: 1 },
      { text: "camron", speaker: 0 },
    ]),
    0,
  );
  console.log("  ok dominant speaker");
}

console.log("xai-stt tests");
testHttpToWs();
testDominantSpeaker();
console.log("All xai-stt tests passed.");
