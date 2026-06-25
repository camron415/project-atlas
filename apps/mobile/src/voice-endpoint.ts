/**
 * Adaptive end-of-speech timing — longer pauses allowed as you say more.
 * VocalLearn-style: short replies send sooner; long monologues tolerate thinking pauses.
 */

/** Post speech_final delay — Smart Turn already waited; submit ASAP. */
const SPEECH_FINAL_SUBMIT_MS = 0;

/** Tiny guard for very short ambiguous finals ("tell me about"). */
const SHORT_FINAL_EXTRA_MS = 150;
const SHORT_FINAL_MAX_WORDS = 3;

/** Fallback when no speech_final arrives — slightly above server smart_turn_timeout. */
export const LISTEN_IDLE_FALLBACK_MS = 3_000;

/** Longer idle window once the user has a substantial partial (road / thinking pauses). */
export const LISTEN_EXTENDED_IDLE_MS = 14_000;
const EXTENDED_IDLE_MIN_WORDS = 18;

/** Legacy adaptive silence (Apple STT path). */
const SILENCE_MS_MIN = 1_500;
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
  if (words <= 8) return 1_800;
  if (words <= 15) return 2_200;
  if (words <= 25) return 2_800;
  if (words <= 40) return 3_200;
  return SILENCE_MS_MAX;
}

/** Post-`speech_final` debounce — near-zero; Smart Turn already endpointed. */
export function computeSpeechFinalSubmitMs(text: string): number {
  const words = countWords(text);
  if (words <= SHORT_FINAL_MAX_WORDS) {
    return SPEECH_FINAL_SUBMIT_MS + SHORT_FINAL_EXTRA_MS;
  }
  return SPEECH_FINAL_SUBMIT_MS;
}

/** Idle fallback before auto-send when no speech_final (hybrid: longer for big partials). */
export function computeIdleFallbackMs(text: string, monologue = false): number {
  if (monologue) return LISTEN_WATCHDOG_MS;
  const words = countWords(text);
  if (words >= EXTENDED_IDLE_MIN_WORDS) return LISTEN_EXTENDED_IDLE_MS;
  return LISTEN_IDLE_FALLBACK_MS;
}
