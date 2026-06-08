import assert from "node:assert/strict";
import { httpBaseToWs } from "./xai-stt";

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

console.log("xai-stt tests");
testHttpToWs();
console.log("All xai-stt tests passed.");
