# Hey Atlas — Wake Word Setup (Feature C)

## What works today

- **Foreground wake word** while the app is open (Feature C1)
- Toggle in **Speakers & wake** settings (gear in Atlas header)
- **Test keyword:** built-in `porcupine` until you add a custom model
- **Background audio** mode is enabled in `app.config.ts` for short screen-off turns

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
