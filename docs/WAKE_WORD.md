# Hey Atlas — Wake Word + Background Listening

## Option A — No Picovoice account (default)

Release builds enable **phrase wake** automatically. No signup or API key required.

1. Rebuild: `./scripts/build-ios-release.sh`
2. Open Atlas → **⚙ Settings** → turn **Wake word** **On**
3. Say **"Hey Atlas"** (or **"OK Atlas"**) while the app is idle

This uses on-device Apple speech recognition. It works well in the foreground and for
brief background/lock-screen use, but uses more battery than Porcupine and is less
precise than a dedicated wake-word model.

## Option B — Picovoice Porcupine (optional, lower battery)

1. Sign up at [console.picovoice.ai](https://console.picovoice.ai/) (individual developer
   signup — not the enterprise “Talk to Sales” form). Gmail usually works; if blocked,
   email `hello@picovoice.ai` and ask for a personal developer account.
2. Add to `server/.env` (gitignored):

```bash
PICOVOICE_ACCESS_KEY=your_key_here
# Optional custom model from Picovoice Console:
# EXPO_PUBLIC_WAKE_KEYWORD_PATH=hey-atlas_ios.ppn
```

3. Rebuild: `./scripts/build-ios-release.sh`

When a Picovoice key is baked into the build, Atlas prefers Porcupine over phrase wake.
Default built-in keyword is **Jarvis** until you bundle a custom **Hey Atlas** `.ppn`.

## Background behavior

- `UIBackgroundModes: audio` keeps the audio session alive while wake is on
- Works best: app recently used, screen locked briefly, Low Power Mode **off**
- iOS may still suspend after extended idle — not Siri-grade 24/7 on third-party apps
- **Mac 24/7 daemon** (roadmap C5) remains the reliable always-on path

## Disable phrase wake

Set `EXPO_PUBLIC_WAKE_PHRASE=0` at build time to require Picovoice only.
