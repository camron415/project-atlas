# Hey Atlas — Wake Word Setup (Feature C)

## What works today

- **Settings UI** — gear icon → Speakers & wake (toggle present, disabled until native link)
- **Background audio** mode in `app.config.ts` for short screen-off turns
- **Code scaffold** — `useWakeWord.ts` + wake → start listening hook in `App.tsx`

## Known blocker (June 2026)

`@picovoice/porcupine-react-native` v4 does not yet `pod install` cleanly with **Expo SDK 54 +
New Architecture** (missing `RCT-Folly` spec). Porcupine was removed from the release build so
speaker/diarization features ship reliably. Re-add when Picovoice publishes a fix or we disable
New Architecture for a wake-word-only build variant.

## Enable wake word

1. Create a free [Picovoice Console](https://console.picovoice.ai/) account
2. Train **"Hey Atlas"** under Porcupine → download **iOS `.ppn`**
3. Add the file to `apps/mobile/ios/Atlas/` and include it in the Xcode target
4. Set env (release build script or `.env`):

```bash
EXPO_PUBLIC_WAKE_WORD=1
EXPO_PUBLIC_PICOVOICE_ACCESS_KEY=your_access_key
EXPO_PUBLIC_WAKE_KEYWORD_PATH=hey-atlas_ios.ppn
```

5. Rebuild: `./scripts/build-ios-release.sh`

Until step 2–4 are done, leave wake **Off** or use the built-in `porcupine` test word
(with `EXPO_PUBLIC_WAKE_KEYWORD_PATH` unset).

## Mac 24/7 wake (Feature C5 — later)

Always-on "Hey Atlas" on the Mac server (reliable Jarvis path) + push notification
to iPhone is planned after iPhone foreground wake is stable.
