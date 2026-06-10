#!/usr/bin/env node
/**
 * Smoke test: health + realtime metrics (no xAI credits).
 * Usage: node scripts/test-realtime-proxy.mjs [baseUrl]
 */
const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("health:", JSON.stringify(health, null, 2));
  if (!health.realtimeProxy) {
    console.warn("realtimeProxy is false — set XAI_API_KEY in server/.env");
  }

  const metrics = await fetch(`${base}/realtime/metrics`).then((r) => r.json());
  console.log("metrics:", JSON.stringify(metrics, null, 2));
  console.log("ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
