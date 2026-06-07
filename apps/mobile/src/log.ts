// Lightweight tagged logger for the voice pipeline. Gated by ATLAS_DEBUG so it
// can be silenced in production, but on by default so device debugging is easy.
// All voice timing/lifecycle events flow through here — grep the Metro console
// for "[atlas:" to trace a turn end-to-end.
import { ATLAS_DEBUG } from "./config";

const t0 = Date.now();

function stamp(): string {
  const ms = Date.now() - t0;
  return `+${(ms / 1000).toFixed(2)}s`;
}

export function dlog(tag: string, ...args: unknown[]): void {
  if (!ATLAS_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(`[atlas:${tag}] ${stamp()}`, ...args);
}

export function dwarn(tag: string, ...args: unknown[]): void {
  if (!ATLAS_DEBUG) return;
  // eslint-disable-next-line no-console
  console.warn(`[atlas:${tag}] ${stamp()}`, ...args);
}
