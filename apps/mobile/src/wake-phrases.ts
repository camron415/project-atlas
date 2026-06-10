/** Phrase wake — no Picovoice key; uses on-device Apple speech recognition. */
const WAKE_PHRASE_RE = /\b(hey[\s,.-]*atlas|ok[\s,.-]*atlas)\b/i;

export function matchesWakePhrase(text: string): boolean {
  return WAKE_PHRASE_RE.test(text.trim());
}
