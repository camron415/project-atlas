/**
 * Normalize Grok STT transcripts before chief routing (client-side, zero latency).
 * Adapted from VocalLearn — Atlas-focused filler/punctuation cleanup.
 */

const FILLER_PATTERN =
  /\b(um+|uh+|er+|hmm+|like[,\s]|you know[,\s]|kind of[,\s]|sort of[,\s]|basically[,\s]|literally[,\s]|i mean[,\s]|actually[,\s]|well[,\s])\b/gi;

const SPOKEN_PUNCTUATION: [RegExp, string][] = [
  [/\b(period|full stop)\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bquestion mark\b/gi, "?"],
  [/\bexclamation( point| mark)?\b/gi, "!"],
];

const PHONETIC_SUBS: [RegExp, string][] = [
  [/\bvocal\s*learn\b/gi, "VocalLearn"],
  [/\bvocalllearn\b/gi, "VocalLearn"],
  [/\batlas\b/gi, "Atlas"],
];

export function cleanSttText(raw: string): string {
  if (!raw?.trim()) return raw;

  let text = raw;
  for (const [pattern, replacement] of PHONETIC_SUBS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(FILLER_PATTERN, " ");
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}
