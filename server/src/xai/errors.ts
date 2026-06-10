/** User-facing message for xAI 429 / quota failures from server routes. */
export function formatXaiApiError(message: string): string {
  const lower = message.toLowerCase();
  if (!lower.includes("429") && !lower.includes("exhausted") && !lower.includes("rate limit")) {
    return message;
  }

  const creditHints = [
    "credit",
    "billing",
    "payment",
    "prepaid",
    "balance",
    "spending",
    "insufficient",
    "quota",
    "resource has been exhausted",
  ];
  const rateHints = ["rate limit", "too many requests", "rpm", "tpm", "concurrent"];

  const likelyCredits = creditHints.some((h) => lower.includes(h));
  const likelyRate = rateHints.some((h) => lower.includes(h));

  if (likelyCredits && !likelyRate) {
    return "xAI quota exhausted (429). Add credits at console.x.ai → Billing, then retry.";
  }
  if (likelyRate && !likelyCredits) {
    return "xAI rate limit (429). Wait 1–2 minutes and retry.";
  }
  return "xAI unavailable (429). Check console.x.ai Billing & Usage, then retry.";
}

export function xaiErrorStatus(message: string): number {
  return message.includes("429") ? 429 : 500;
}
