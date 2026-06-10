# Atlas Home Screen Widget

Dark-themed widget matching the in-app header: **Atlas** title, connection pill,
status line, last message preview, and a **Mic** button (`atlas://listen`).

## One-time Xcode setup

The widget extension source lives in `ios/AtlasWidgetExtension/`. Add it to the
Xcode project once:

```bash
gem install xcodeproj   # if needed
ruby scripts/setup-ios-widget.rb
cd apps/mobile/ios && pod install
```

In [Apple Developer](https://developer.apple.com/account) → Identifiers, enable
**App Groups** for both `com.camrontrost.atlas` and `com.camrontrost.atlas.widget`,
then add `group.com.camrontrost.atlas` to both entitlements files. Until then the
widget shows placeholder text (live sync requires App Groups).

## Add to Home Screen

Long-press Home Screen → **+** → search **Atlas** → choose Small or Medium widget.

The widget reads live state from the app via App Group shared storage (connection,
voice status, last line, wake toggle).

## Limitations

- Widgets **cannot** access the microphone — tapping **Mic** opens the app.
- Widget updates when the app syncs state (on status/connection/message changes).
