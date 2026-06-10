/**
 * Adaptive end-of-speech timing — longer pauses allowed as you say more.
 * VocalLearn-style: short replies send sooner; long monologues tolerate thinking pauses.
 */

/** Min silence after last transcript change before auto-send. */
const SILENCE_MS_MIN = 800;
const SILENCE_MS_MAX = 4_000;

/** Hard cap — auto-send a very long turn even if user keeps adding fragments. */
export const LISTEN_WATCHDOG_MS = 600_000;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Silence window before we assume the user is done (not just thinking).
 * Scales with word count so longer prompts get more pause room.
 */
export function computeSilenceSubmitMs(text: string): number {
  const words = countWords(text);
  if (words <= 3) return SILENCE_MS_MIN;
  if (words <= 8) return 1_200;
  if (words <= 15) return 1_600;
  if (words <= 25) return 2_200;
  if (words <= 40) return 2_800;
  return SILENCE_MS_MAX;
}
