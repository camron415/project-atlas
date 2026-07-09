import {
  activateTutor,
  deactivateTutor,
  isTutorActive,
} from "./session-state.js";

const ENTER_TUTOR =
  /\b(study\s+mode|learning\s+check-?in|tutor\s+mode|start\s+study|begin\s+study)\b/i;
const EXIT_TUTOR =
  /\b(end\s+study|exit\s+study(\s+mode)?|stop\s+study|leave\s+study\s+mode|end\s+tutor)\b/i;

export function looksTutorEnter(text: string): boolean {
  return ENTER_TUTOR.test(text.trim());
}

export function looksTutorExit(text: string): boolean {
  return EXIT_TUTOR.test(text.trim());
}

/** Apply enter/exit phrases; returns whether tutor mode is on after this message. */
export function applyTutorTriggers(
  text: string,
  chatSessionId?: string,
): boolean {
  const trimmed = text.trim();
  if (looksTutorExit(trimmed)) {
    deactivateTutor();
    return false;
  }
  if (looksTutorEnter(trimmed)) {
    activateTutor(chatSessionId);
    return true;
  }
  return isTutorActive(chatSessionId ?? null);
}

export function stripTutorTriggers(text: string): string {
  return text
    .replace(ENTER_TUTOR, "")
    .replace(EXIT_TUTOR, "")
    .replace(/\s+/g, " ")
    .trim();
}
