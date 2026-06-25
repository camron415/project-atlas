import assert from "node:assert/strict";
import { detectLanIp, resolveLanIp } from "./lan-ip.js";

const detected = detectLanIp();
if (detected) {
  assert.match(detected, /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(detected.startsWith("100."), false);
}

const prev = process.env.ATLAS_LAN_IP;
process.env.ATLAS_LAN_IP = "10.0.0.1";
const resolved = resolveLanIp();
process.env.ATLAS_LAN_IP = prev;
if (detected) {
  assert.equal(resolved, detected);
}

console.log("network/lan-ip.test.ts: ok");
