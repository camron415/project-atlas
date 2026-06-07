# Native streaming audio (AVAudioEngine)

Gapless PCM16 playback for xAI realtime voice on iOS.

## Architecture

```
WebSocket output_audio.delta (base64 PCM16 @ 24kHz)
        │
        ▼
AtlasStreamAudioModule.swift
  AVAudioEngine + AVAudioPlayerNode
  scheduleBuffer() per delta — no temp files, no gaps
        │
        ▼
    Speaker
```

Android / simulator without native module falls back to `src/pcm-audio.ts` (expo-av segments).

## Rebuild required

This is a **native module**. After pulling changes:

```bash
cd apps/mobile
npm install
npx expo run:ios --device   # rebuild dev client on iPhone
```

JS-only reload (`r` in Metro) is **not** enough.

## Verify in Metro logs

On a voice turn you should see:

```
[atlas:audio] using native AVAudioEngine stream
[atlas:rt] first audio delta (…ms)
[atlas:rt] first audio (…ms)
```

If you see `using expo-av segmented fallback`, the native module did not link — rebuild.

## Module API (JS)

```typescript
import { isNativeStreamAudioAvailable } from "atlas-stream-audio";
```

Used via `src/stream-audio.ts` facade — do not call directly from UI code.
