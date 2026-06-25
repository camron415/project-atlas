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

/** xAI sometimes sends the same phrase twice in one partial (e.g. "hello hello"). */
function collapseDoubledPhrase(text: string, reference: string): string {
  const ref = reference.trim();
  const next = text.trim();
  if (!ref || !next) return next;
  if (next === ref) return ref;
  if (next === `${ref} ${ref}` || next === ref + ref) return ref;
  return next;
}

/** Collapse stuttered tokens (common on Bluetooth HFP): "check check check check" → "check check". */
export function collapseStutteredTokens(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const commaParts = trimmed.split(/,\s*/);
  if (commaParts.length >= 3) {
    const normalized = commaParts.map((p) => p.trim().toLowerCase());
    const allSame = normalized.every((p) => p === normalized[0] && p.length > 0);
    if (allSame && commaParts.length >= 3) {
      const once = commaParts[0];
      return `${once}, ${once}`;
    }
  }

  const words = trimmed.split(/\s+/);
  if (words.length >= 3) {
    const collapsed: string[] = [];
    for (const word of words) {
      const prev = collapsed[collapsed.length - 1];
      const prev2 = collapsed[collapsed.length - 2];
      if (
        word.toLowerCase() === prev?.toLowerCase() &&
        word.toLowerCase() === prev2?.toLowerCase()
      ) {
        continue;
      }
      collapsed.push(word);
    }
    if (collapsed.length < words.length) {
      return collapsed.join(" ");
    }
  }

  return trimmed;
}

/** Share of words from the shorter phrase that appear in the longer (order-agnostic). */
export function wordOverlapRatio(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wordsB = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wordsA.length || !wordsB.length) return 0;
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length <= wordsB.length ? wordsB : wordsA;
  const longSet = new Set(longer);
  const shared = shorter.filter((w) => longSet.has(w)).length;
  return shared / shorter.length;
}

/** When interim + speech_final both land in one string, keep the polished half. */
export function dedupeRevisedUtterance(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 40) return trimmed;

  const words = trimmed.split(/\s+/);
  if (words.length < 8) return trimmed;

  const mid = Math.floor(words.length / 2);
  for (let split = mid - 3; split <= mid + 3; split++) {
    if (split < 2 || split > words.length - 2) continue;
    const left = words.slice(0, split).join(" ");
    const right = words.slice(split).join(" ");
    const ratio = wordOverlapRatio(left, right);
    if (ratio >= 0.55 && right.length >= left.length * 0.85) {
      return right;
    }
    if (ratio >= 0.55 && left.length > right.length) {
      return left;
    }
  }
  return trimmed;
}

/** Final cleanup before submitting an utterance to Atlas. */
export function normalizeSttUtterance(text: string): string {
  const collapsed = collapseStutteredTokens(collapseDoubledPhrase(text.trim(), ""));
  return dedupeRevisedUtterance(collapsed);
}

export function mergeSttChunkText(committed: string, incoming: string): string {
  const prev = committed.trim();
  const next = incoming.trim();
  if (!next) return prev;
  if (!prev) return next;
  if (next === prev) return prev;
  if (next === `${prev} ${prev}`) return prev;
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
  const raw = event.text.trim();
  if (!raw) return state.peak;
  const text = collapseDoubledPhrase(raw, state.peak || state.committed);
  if (text === state.peak) return state.peak;

  if (event.speech_final) {
    const prev = (state.committed || state.peak).trim();
    if (!prev) {
      state.committed = text;
      state.peak = text;
      return text;
    }
    // speech_final is the authoritative polished utterance — do not stitch onto interim.
    if (text.startsWith(prev) || prev.startsWith(text)) {
      const best = text.length >= prev.length ? text : prev;
      state.committed = best;
      state.peak = best;
      return best;
    }
    if (wordOverlapRatio(prev, text) >= 0.45) {
      const best = text.length >= prev.length ? text : prev;
      state.committed = best;
      state.peak = best;
      return best;
    }
    const merged = mergeSttChunkText(prev, text);
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
