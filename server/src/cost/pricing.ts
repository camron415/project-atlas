/** Estimated USD per 1M tokens — planning rates; verify against xAI billing. */
const RATES_PER_MILLION: Record<string, { input: number; output: number }> = {
  "grok-4-fast-non-reasoning": { input: 0.2, output: 0.5 },
  "grok-4-fast-reasoning": { input: 1.25, output: 2.5 },
  "grok-4-1-fast": { input: 0.2, output: 0.5 },
  "grok-4-fast": { input: 0.2, output: 0.5 },
  "grok-voice-think-fast-1.0": { input: 3.0, output: 15.0 },
  "xai-tts": { input: 0.5, output: 0 },
  "xai-responses": { input: 0.2, output: 0.5 },
};

const DEFAULT_RATE = { input: 0.5, output: 1.5 };

export function estimateTokenCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = RATES_PER_MILLION[model] ?? DEFAULT_RATE;
  const inputCost = (inputTokens / 1_000_000) * rate.input;
  const outputCost = (outputTokens / 1_000_000) * rate.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
