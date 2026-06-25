import os from "node:os";

/** Prefer Wi‑Fi / Ethernet IPv4; skip Tailscale (100.x) and loopback. */
export function detectLanIp(): string | null {
  const preferred = ["en0", "en1", "eth0"];
  for (const name of preferred) {
    const ip = firstPublicV4(os.networkInterfaces()[name]);
    if (ip) return ip;
  }
  for (const entries of Object.values(os.networkInterfaces())) {
    const ip = firstPublicV4(entries);
    if (ip) return ip;
  }
  return null;
}

function firstPublicV4(
  entries: ReturnType<typeof os.networkInterfaces>[string],
): string | null {
  if (!entries) return null;
  for (const addr of entries) {
    if (addr.family !== "IPv4" || addr.internal) continue;
    if (addr.address.startsWith("100.")) continue;
    return addr.address;
  }
  return null;
}

export function resolveLanIp(): string | null {
  const detected = detectLanIp();
  if (detected) return detected;
  const fromEnv = process.env.ATLAS_LAN_IP?.trim();
  return fromEnv || null;
}
