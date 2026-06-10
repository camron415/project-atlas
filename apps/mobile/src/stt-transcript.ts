/**
 * xAI streaming STT partials are usually cumulative (full utterance-so-far), but
 * can also send ~3s chunk windows. The banner must NEVER shrink mid-utterance.
 */

export interface SttTranscriptState {
  /** Locked text from is_final chunks (no speech_final). */
  committed: string;
  /** Longest coherent transcript this utterance — monotonic display source. */
  peak: string;
}

export function mergeSttChunkText(committed: string, incoming: string): string {
  const prev = committed.trim();
  const next = incoming.trim();
  if (!next) return prev;
  if (!prev) return next;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  if (prev.includes(next)) return prev;

  const prevWords = prev.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const maxOverlap = Math.min(prevWords.length, nextWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const suffix = prevWords.slice(-overlap).join(" ");
    const prefix = nextWords.slice(0, overlap).join(" ");
    if (suffix === prefix) {
      const tail = nextWords.slice(overlap).join(" ");
      return tail ? `${prev} ${tail}`.trim() : prev;
    }
  }

  return `${prev} ${next}`.trim();
}

function monotonicPeak(state: SttTranscriptState, candidate: string): string {
  const next = candidate.trim();
  if (!next) return state.peak;
  if (!state.peak) {
    state.peak = next;
    return state.peak;
  }
  if (next.startsWith(state.peak) || next.length >= state.peak.length) {
    state.peak = next;
    return state.peak;
  }
  if (state.peak.startsWith(next)) return state.peak;
  const merged = mergeSttChunkText(state.peak, next);
  if (merged.length >= state.peak.length) {
    state.peak = merged;
  }
  return state.peak;
}

export function applySttPartialEvent(
  state: SttTranscriptState,
  event: { text: string; is_final?: boolean; speech_final?: boolean },
): string {
  const text = event.text.trim();
  if (!text) return state.peak;

  if (event.speech_final) {
    const merged = mergeSttChunkText(state.committed || state.peak, text);
    state.committed = merged;
    state.peak = merged;
    return merged;
  }

  // Cumulative partial (xAI default with interim_results): text grows in place.
  if (
    text.startsWith(state.peak) ||
    text.startsWith(state.committed) ||
    (state.peak && state.peak.startsWith(text))
  ) {
    const best =
      text.length >= state.peak.length
        ? text
        : state.peak.length >= text.length
          ? state.peak
          : text;
    if (event.is_final) {
      state.committed = best.length >= state.committed.length ? best : state.committed;
    }
    return monotonicPeak(state, best);
  }

  // Non-cumulative chunk — stitch onto locked base.
  const base = state.committed || state.peak;
  const stitched = mergeSttChunkText(base, text);
  if (event.is_final) {
    state.committed = mergeSttChunkText(state.committed, text);
    if (state.committed.length > stitched.length) {
      return monotonicPeak(state, state.committed);
    }
  }
  return monotonicPeak(state, stitched);
}

export function newSttTranscriptState(): SttTranscriptState {
  return { committed: "", peak: "" };
}
