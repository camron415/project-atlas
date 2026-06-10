import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inline helpers mirrored from realtime-proxy.ts for unit testing.
function buildConversationItem(turn: { role: string; content: string }): Record<string, unknown> {
  const text = String(turn.content ?? "").trim();
  const role = String(turn.role ?? "user");
  if (role === "assistant" || role === "atlas") {
    return {
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
    };
  }
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}

describe("realtime proxy conversation seeding", () => {
  it("maps atlas role to assistant items", () => {
    const item = buildConversationItem({
      role: "atlas",
      content: "Project Atlas is your voice assistant.",
    });
    assert.equal(item.role, "assistant");
    assert.deepEqual(item.content, [{ type: "text", text: "Project Atlas is your voice assistant." }]);
  });

  it("maps user role to input_text items", () => {
    const item = buildConversationItem({ role: "user", content: "Can you hear me?" });
    assert.equal(item.role, "user");
    assert.deepEqual(item.content, [{ type: "input_text", text: "Can you hear me?" }]);
  });
});
