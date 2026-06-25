/** Shared intent detection for chief routing (voice + text). */

const DEEP_INTENT =
  /\b(think (deeply|hard|carefully)|deep dive|deep[- ]?think|take your time|really think|think it through)\b/i;

/** Auto-promote to reasoning model for planning / decisions (option C). */
const PLANNING_INTENT =
  /\b(why|should we|how should|what if|plan|decide|strategy|priorit|roadmap|next step|trade-?off|compare|recommend|brainstorm|work out|figure out)\b/i;

/** @deprecated Research routing is chief tool policy (search_context → web_lookup), not client regex. */
export function looksResearch(_text: string): boolean {
  return false;
}

export function looksDeep(text: string): boolean {
  return DEEP_INTENT.test(text);
}

export function looksPlanning(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return PLANNING_INTENT.test(text) || words >= 28;
}
