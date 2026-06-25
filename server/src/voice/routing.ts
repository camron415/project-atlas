import type { InboxProjectSlug } from "../inbox/types.js";

/** Strip injected prefixes before intent regex (speaker, location, hold hints). */
export function stripMessageForRouting(message: string): string {
  let m = message.trim();
  for (let i = 0; i < 6; i++) {
    const next = m
      .replace(/^\[Speaker:[^\]]+\]\s*/i, "")
      .replace(/^\[Voice input[^\]]+\]\s*/i, "")
      .replace(/^\[User location:[^\]]+\]\s*/i, "")
      .replace(/^\[User interrupted[^\]]+\]\s*/i, "")
      .replace(/^\[Camron already heard[^\]]+\]\s*/i, "")
      .replace(/^\[Field report monologue[^\]]+\]\s*/i, "")
      .trim();
    if (next === m) break;
    m = next;
  }
  return m;
}

export const CONFIRM_RE =
  /^(yes|yeah|yep|sure|ok|okay|go ahead|proceed|please do|do it|affirmative|confirm|please)\b/i;

export const CANCEL_RE =
  /^(no|nope|not now|cancel|stop|never mind|don't|wait)\b/i;

export function detectProject(text: string): InboxProjectSlug | null {
  const lower = text.toLowerCase();
  if (/\bvocal\s*learn\b|\bvocalllearn\b/.test(lower)) return "vocallearn";
  if (/\bcareer\b/.test(lower)) return "career";
  if (/\batlas\b/.test(lower)) return "atlas";
  return null;
}

export function extractFocus(text: string, project: InboxProjectSlug): string {
  const trimmed = stripMessageForRouting(text).trim();
  if (trimmed.length > 24) return trimmed.slice(0, 500);
  return `General ${project} review — architecture, recent changes, and priorities`;
}

export function isConfirm(message: string): boolean {
  return CONFIRM_RE.test(stripMessageForRouting(message));
}

export function isCancel(message: string): boolean {
  return CANCEL_RE.test(stripMessageForRouting(message));
}
