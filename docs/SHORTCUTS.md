# Atlas — Shortcuts & Siri (pseudo wake word)

iOS does **not** let third-party apps run continuous background wake-word listening
like Siri. Shortcuts are the Apple-sanctioned workaround: you pick a phrase Siri
already listens for, and it hands off to Atlas.

## The unlock requirement (important)

Per [Apple Support](https://support.apple.com/guide/shortcuts/run-shortcuts-with-siri-apd07c25bb38/ios):

> When your device is locked and you run a shortcut that **opens an app**, Siri asks
> to unlock your device before continuing.

Any shortcut that launches Atlas (`Open URLs` → `atlas://listen`, or **Open App**)
**will require Face ID / passcode while the phone is locked**. There is no
supported workaround for third-party apps — this is an Apple security policy, not
an Atlas limitation.

**What works without unlocking:**

| Method | Unlock required? |
| --- | --- |
| **Wake word** with app recently open (phrase or Porcupine) | No — mic already active in app |
| **Action Button** → Talk to Atlas shortcut | Yes — one press, but you’re holding the phone |
| **"Hey Siri, Talk to Atlas"** while locked | **Yes** — Siri opens the app |
| Shortcuts that only call a URL (no app open) | Sometimes — but Atlas can’t listen without the app |

**Best locked-phone flow today:** enable **Wake word** in Settings and leave Atlas
in the background (don’t force-quit). Say **"Hey Atlas"** — no Siri, no unlock.

For true hands-free from a cold start while locked, the roadmap is **Mac daemon +
push** (Feature C5) — Mac hears the wake word and notifies the phone.

## Quick setup

### Option 1 — "Hey Siri, Talk to Atlas" (requires unlock)

1. Open **Shortcuts** → **+** → add **Open URLs**
2. URL: `atlas://listen`
3. Name the shortcut **Talk to Atlas**
4. Tap **ⓘ** → enable **Allow Running When Locked** (helps for non-app actions; opening Atlas may still prompt unlock)
5. Say: **"Hey Siri, Talk to Atlas"**

### Option 2 — Action Button (iPhone 15 Pro)

Settings → Action Button → Shortcut → **Talk to Atlas**

One press while the phone is awake starts a voice session immediately.

### Option 3 — Ask a question (one-shot)

1. Shortcut → **Open URLs** → `atlas://ask?text=What's%20the%20status%20of%20VocalLearn%3F`
2. Name it **Ask Atlas status**
3. **"Hey Siri, Ask Atlas status"** (unlock likely required)

## Deep link reference

| URL | Behavior |
| --- | --- |
| `atlas://listen` | Start continuous voice session (mic on). Waits for server + pauses phrase wake so Grok STT starts cleanly. |
| `atlas://ask?text=…` | Send one text question; Atlas speaks the reply |

## Best combined setup (Phase 1)

| Situation | Use |
| --- | --- |
| App open / recent background | **Wake word** in Settings ("Hey Atlas") |
| Phone locked, app not running | **Not possible** without unlock — use Action Button or unlock once |
| Always-on Jarvis (future) | Mac daemon + push notification (roadmap C5) |

See also `docs/WAKE_WORD.md`, `docs/WIDGET.md`, and `docs/PRODUCTION_VOICE.md` (Feature C).
