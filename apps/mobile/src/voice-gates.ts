/** Imperative hooks so voice intents can pause phrase wake before grabbing the mic. */

let pauseWakeHandler: (() => Promise<void>) | null = null;

export function registerWakePauseHandler(handler: (() => Promise<void>) | null): void {
  pauseWakeHandler = handler;
}

export async function pauseWakeListeningForVoice(): Promise<void> {
  await pauseWakeHandler?.();
}
