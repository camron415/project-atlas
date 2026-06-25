import { describe, expect, it } from "vitest";
import { detectLanIp, resolveLanIp } from "./lan-ip.js";

describe("detectLanIp", () => {
  it("returns a non-tailscale IPv4 when interfaces exist", () => {
    const ip = detectLanIp();
    if (ip) {
      expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(ip.startsWith("100.")).toBe(false);
    }
  });

  it("resolveLanIp prefers detected over env", () => {
    const prev = process.env.ATLAS_LAN_IP;
    process.env.ATLAS_LAN_IP = "10.0.0.1";
    const ip = resolveLanIp();
    process.env.ATLAS_LAN_IP = prev;
    if (detectLanIp()) {
      expect(ip).toBe(detectLanIp());
    }
  });
});
