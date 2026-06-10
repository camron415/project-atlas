function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractBodyText(raw: string): string {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return raw.toLowerCase();

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const parts = [parsed.error, parsed.message, parsed.code].filter(Boolean);
    if (parts.length) return parts.join(" ").toLowerCase();
  } catch {
    // fall through
  }
  return raw.toLowerCase();
}

export function isXaiQuotaError(error: unknown): boolean {
  const raw = errorText(error).toLowerCase();
  const body = extractBodyText(errorText(error));
  return (
    raw.includes("429") ||
    body.includes("429") ||
    body.includes("rate limit") ||
    body.includes("too many requests") ||
    body.includes("resource has been exhausted") ||
    body.includes("exhausted")
  );
}

/**
 * Turn raw xAI / Atlas proxy errors into actionable copy for STT, realtime, and chat.
 */
export function formatXaiQuotaError(error: unknown, context?: string): string {
  const raw = errorText(error);
  if (!isXaiQuotaError(error)) {
    return context ? `${context}: ${raw}` : raw;
  }

  const body = extractBodyText(raw);
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
    "exhausted",
  ];
  const rateHints = [
    "rate limit",
    "too many requests",
    "rpm",
    "tpm",
    "requests per",
    "concurrent",
  ];

  const likelyCredits = creditHints.some((h) => body.includes(h));
  const likelyRate = rateHints.some((h) => body.includes(h));

  let detail: string;
  if (likelyCredits && !likelyRate) {
    detail =
      "xAI quota looks exhausted. Open console.x.ai → Billing and add credits or fix payment, then retry.";
  } else if (likelyRate && !likelyCredits) {
    detail =
      "xAI rate limit (429). Wait 1–2 minutes — today's voice testing opened many STT/realtime sessions.";
  } else {
    detail =
      "xAI returned 429 (rate limit or low credits). Check Billing & Usage at console.x.ai, wait a minute, retry.";
  }

  return context ? `${context} — ${detail}` : detail;
}
