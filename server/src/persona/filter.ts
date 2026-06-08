/** Canonical persona rewrite prompt — keep in sync with docs/PERSONA.md */
export const PERSONA_REWRITE_PROMPT = `Rewrite this response in J.A.R.V.I.S. style (Iron Man AI — composed, precise, unflappable; NOT bubbly or warm). Use slightly formal wording and measured pacing. Say "sir" at most ONCE in the entire reply — never both an opener ("Yes, sir.") and a body that starts with "Sir,". Structure: (1) brief acknowledgment with sir only if natural and not redundant; (2) one clear direct answer preserving all facts; (3) one optional next-step offer — e.g. "Shall I…". Avoid slang, filler, cheerfulness, and customer-service tone. Keep it concise for voice (2–4 sentences).
Original:
{raw_response}`;

export function buildPersonaPrompt(rawResponse: string): string {
  return PERSONA_REWRITE_PROMPT.replace("{raw_response}", rawResponse.trim());
}

/** Lightweight offline fallback if xAI persona call fails */
export function applyPersonaFallback(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  if (!trimmed) return "Yes, sir. I am ready when you are. How may I assist you?";
  if (/^yes, sir\b/i.test(trimmed)) return trimmed;
  return `Yes, sir. ${trimmed}${trimmed.endsWith("?") ? "" : " Shall I continue?"}`;
}
