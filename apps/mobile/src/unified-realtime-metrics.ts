export interface UnifiedRealtimeMetrics {
  realtimeConnectMs?: number;
  firstAudioDeltaMs?: number;
  turnCompleteMs?: number;
  configuredAt?: number;
}

let latest: UnifiedRealtimeMetrics = {};

export function resetUnifiedMetrics(): void {
  latest = {};
}

export function recordUnifiedMetric(
  key: keyof UnifiedRealtimeMetrics,
  value: number,
): void {
  latest = { ...latest, [key]: value };
}

export function getUnifiedMetrics(): UnifiedRealtimeMetrics {
  return { ...latest };
}
