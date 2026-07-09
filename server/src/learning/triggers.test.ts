import assert from "node:assert/strict";
import {
  applyTutorTriggers,
  looksTutorEnter,
  looksTutorExit,
  stripTutorTriggers,
} from "./triggers.js";
import { deactivateTutor } from "./session-state.js";

deactivateTutor();

assert.equal(looksTutorEnter("Hey Atlas, study mode"), true);
assert.equal(looksTutorEnter("learning check-in please"), true);
assert.equal(looksTutorExit("end study"), true);

assert.equal(applyTutorTriggers("study mode", "s1"), true);
assert.equal(applyTutorTriggers("what is HTTP?", "s1"), true);
assert.equal(applyTutorTriggers("end study", "s1"), false);

assert.equal(stripTutorTriggers("Atlas, study mode — teach me async"), "Atlas, — teach me async");

console.log("learning/triggers.test.ts: ok");
