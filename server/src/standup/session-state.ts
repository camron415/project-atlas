const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

let activeUntil = 0;
let activeChatSessionId: string | null = null;

export function activateStandup(chatSessionId?: string): void {
  activeUntil = Date.now() + SESSION_TTL_MS;
  activeChatSessionId = chatSessionId?.trim() || null;
}

export function deactivateStandup(): void {
  activeUntil = 0;
  activeChatSessionId = null;
}

export function isStandupActive(chatSessionId?: string | null): boolean {
  if (Date.now() > activeUntil) {
    activeUntil = 0;
    return false;
  }
  if (!activeChatSessionId) return true;
  if (!chatSessionId) return true;
  return activeChatSessionId === chatSessionId;
}
