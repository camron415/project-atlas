/** Central model routing — cheapest capable model per task type. */

export const AtlasModels = {
  /** Fast chat, scan synthesis, persona rewrite (default). */
  fast: () => process.env.XAI_CHAT_MODEL ?? "grok-4-fast-non-reasoning",
  /** Deep reasoning when user explicitly asks. */
  deep: () => process.env.XAI_DEEP_MODEL ?? "grok-4-fast-reasoning",
  /** Project code inventory synthesis during deep refresh. */
  scan: () => process.env.XAI_SCAN_MODEL ?? process.env.XAI_CHAT_MODEL ?? "grok-4-fast-non-reasoning",
  /** Realtime voice (WebSocket). */
  realtime: () => process.env.XAI_REALTIME_MODEL ?? "grok-voice-think-fast-1.0",
  /** Read-only analyst brief synthesis (Phase 1.75). */
  analyst: () =>
    process.env.XAI_ANALYST_MODEL ?? process.env.XAI_SCAN_MODEL ?? "grok-4-fast-non-reasoning",
} as const;
