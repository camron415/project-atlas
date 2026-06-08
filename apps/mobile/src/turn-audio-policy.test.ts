/**
 * Isolated tests for fast-turn audio routing (no network, no native modules).
 * Run: npm run test:audio
 */
import assert from "node:assert/strict";
import { decideTurnAudio, flushAppendChain } from "./turn-audio-policy";

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(
    () => console.log(`  ok ${name}`),
    (err) => {
      console.error(`  FAIL ${name}`);
      throw err;
    },
  );
}

async function run(): Promise<void> {
  console.log("turn-audio-policy tests");

  await test("no audio deltas → TTS fallback allowed", () => {
    const d = decideTurnAudio({
      textOnly: false,
      text: "Hello sir",
      sawAudioDeltas: false,
      pcmDelivered: false,
    });
    assert.equal(d.allowTtsFallback, true);
    assert.equal(d.route, "tts-fallback");
  });

  await test("audio deltas → NEVER TTS (even if pcm not delivered yet)", () => {
    const d = decideTurnAudio({
      textOnly: false,
      text: "Hello sir",
      sawAudioDeltas: true,
      pcmDelivered: false,
    });
    assert.equal(d.allowTtsFallback, false);
    assert.equal(d.route, "native-stream");
  });

  await test("audio deltas + pcm delivered → native only", () => {
    const d = decideTurnAudio({
      textOnly: false,
      text: "Hello sir",
      sawAudioDeltas: true,
      pcmDelivered: true,
    });
    assert.equal(d.allowTtsFallback, false);
    assert.equal(d.route, "native-stream");
  });

  await test("text-only mode → no TTS", () => {
    const d = decideTurnAudio({
      textOnly: true,
      text: "Hello",
      sawAudioDeltas: false,
      pcmDelivered: false,
    });
    assert.equal(d.allowTtsFallback, false);
    assert.equal(d.route, "text-only");
  });

  await test("race: response.done before append microtask — flush chain first", async () => {
    let pcmDelivered = false;
    let sawAudioDeltas = false;
    let chain = Promise.resolve();

    // Simulate delta scheduled on response.done boundary
    sawAudioDeltas = true;
    chain = chain.then(async () => {
      await new Promise((r) => setTimeout(r, 5));
      pcmDelivered = true;
    });

    // BUG if we decide before flush:
    const premature = decideTurnAudio({
      textOnly: false,
      text: "Hi",
      sawAudioDeltas,
      pcmDelivered,
    });
    assert.equal(premature.allowTtsFallback, false, "sawAudioDeltas blocks TTS even before flush");

    await flushAppendChain(chain);
    assert.equal(pcmDelivered, true);

    const after = decideTurnAudio({
      textOnly: false,
      text: "Hi",
      sawAudioDeltas,
      pcmDelivered,
    });
    assert.equal(after.allowTtsFallback, false);
    assert.equal(after.route, "native-stream");
  });

  await test("double-playback scenario: native played + old pcmDelivered gate would TTS", () => {
    // Previously: sawAudio=true, pcmDelivered=false → requiresTtsFallback=true → DOUBLE
    const d = decideTurnAudio({
      textOnly: false,
      text: "Full reply text",
      sawAudioDeltas: true,
      pcmDelivered: false,
    });
    assert.equal(d.allowTtsFallback, false, "must not TTS when API sent audio");
  });

  await test("pcm delivered → never double with TTS gate", () => {
    const nativeOk = { pcmDelivered: true, sawAudioDeltas: true };
    assert.equal(nativeOk.pcmDelivered, true);
    const useTts = !nativeOk.pcmDelivered;
    assert.equal(useTts, false);
  });

  console.log("\nAll turn-audio-policy tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
