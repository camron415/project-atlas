#!/usr/bin/env node
/**
 * One-time: bundle Rex TTS "one moment" clips for instant hold phrases (no network).
 * Usage: node scripts/generate-moment-clips.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "server/.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const outDir = path.join(root, "apps/mobile/assets/audio/moments");
const phrases = [
  { file: "one-moment-sir.mp3", text: "One moment, sir." },
  { file: "just-a-moment-sir.mp3", text: "Just a moment, sir." },
  { file: "one-moment-look-sir.mp3", text: "One moment while I look into that, sir." },
  { file: "allow-me-moment-sir.mp3", text: "Allow me a moment, sir." },
  { file: "one-moment-check-sir.mp3", text: "One moment, sir. I shall check." },
  {
    file: "one-moment-analyst-sir.mp3",
    text: "One moment while I consult the analyst, sir.",
  },
];

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error("XAI_API_KEY required in server/.env");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

for (const { file, text } of phrases) {
  const dest = path.join(outDir, file);
  const res = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: process.env.XAI_TTS_VOICE ?? "rex",
      language: "en",
    }),
  });
  if (!res.ok) {
    console.error(`TTS failed for ${file}:`, await res.text());
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`wrote ${dest} (${buf.length} bytes)`);
}

console.log("Done — moment clips ready for bundling.");
