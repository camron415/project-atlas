import assert from "node:assert/strict";
import { looksDeep, looksPlanning, looksResearch } from "./intents.js";

assert.equal(looksResearch("What's the weather for tomorrow?"), false);
assert.equal(looksResearch("Who do you think's gonna win the big game?"), false);
assert.ok(looksDeep("think deeply about this"));
assert.ok(!looksDeep("what's the weather"));
assert.ok(looksPlanning("how should we prioritize the atlas roadmap"));
assert.ok(looksPlanning("word ".repeat(30)));

console.log("chief/intents.test.ts: ok");
