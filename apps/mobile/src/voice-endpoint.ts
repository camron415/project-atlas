/**
 * Adaptive end-of-speech timing — longer pauses allowed as you say more.
 * ChatGPT-style: short replies send sooner; long monologues tolerate thinking pauses.
 */

/** Min silence after last transcript change before auto-send. */
const SILENCE_MS_MIN = 1_600;
const SILENCE_MS_MAX = 4_000;

/** Hard cap — auto-send a very long turn even if user keeps adding fragments. */
export const LISTEN_WATCHDOG_MS = 120_000;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Silence window before we assume the user is done (not just thinking).
 * Scales with word count so longer prompts get more pause room.
 */
export function computeSilenceSubmitMs(text: string): number {
  const words = countWords(text);
  if (words <= 2) return SILENCE_MS_MIN;
  if (words <= 6) return 2_000;
  if (words <= 12) return 2_400;
  if (words <= 24) return 2_900;
  if (words <= 40) return 3_400;
  return SILENCE_MS_MAX;
}
