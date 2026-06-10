export interface RealtimeLatencyMetrics {
  sessionId: string | null;
  connectMs: number | null;
  configuredMs: number | null;
  firstAudioDeltaMs: number | null;
  lastTurnCompleteMs: number | null;
  updatedAt: string;
}

const empty: RealtimeLatencyMetrics = {
  sessionId: null,
  connectMs: null,
  configuredMs: null,
  firstAudioDeltaMs: null,
  lastTurnCompleteMs: null,
  updatedAt: new Date(0).toISOString(),
};

let latest = { ...empty };

export function resetRealtimeMetrics(sessionId: string): void {
  latest = {
    sessionId,
    connectMs: null,
    configuredMs: null,
    firstAudioDeltaMs: null,
    lastTurnCompleteMs: null,
    updatedAt: new Date().toISOString(),
  };
}

export function recordRealtimeMetric(
  key: keyof Omit<RealtimeLatencyMetrics, "sessionId" | "updatedAt">,
  value: number,
): void {
  latest = { ...latest, [key]: value, updatedAt: new Date().toISOString() };
}

export function getRealtimeMetrics(): RealtimeLatencyMetrics {
  return { ...latest };
}
