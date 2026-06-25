import assert from "node:assert/strict";
import { sanitizeVoiceReply } from "./voice-sanitize.js";

assert.equal(
  sanitizeVoiceReply("I can save this to the Atlas inbox — say yes to confirm."),
  "I can save this to the Atlas inbox — say yes to confirm.",
);

assert.equal(
  sanitizeVoiceReply(
    "Action: Call write_inbox with confirmed=true\nI'll save that for you, sir.",
  ),
  "I'll save that for you, sir.",
);

assert.equal(
  sanitizeVoiceReply(
    "Call `write_inbox` to save /Users/camrontrost/atlas/inbox/field-note.md",
  ),
  "Call to save",
);

assert.ok(
  !sanitizeVoiceReply("Use dispatch_analyst with confirmed=true for VocalLearn.").includes(
    "dispatch_analyst",
  ),
);

assert.equal(
  sanitizeVoiceReply("Action: Call search_context\nHere is what I found."),
  "Here is what I found.",
);

console.log("voice/voice-sanitize.test.ts: ok");
