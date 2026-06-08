#!/usr/bin/env bash
# Verify Atlas server voice endpoints (run on Mac while server is up).
set -euo pipefail

BASE="${1:-http://127.0.0.1:8787}"

echo "=== GET /health ==="
curl -sf "${BASE}/health" | python3 -m json.tool
echo ""

echo "=== POST /tts (Rex MP3) ==="
curl -sf -X POST "${BASE}/tts" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Good day, sir. Audio pipeline test."}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
audio=d.get('audio') or ''
print('audioFormat:', d.get('audioFormat'))
print('audioError:', d.get('audioError'))
print('audio base64 length:', len(audio))
if len(audio) < 100:
    print('FAIL: audio payload too small')
    sys.exit(1)
print('OK: TTS returned audio')
"

echo ""
echo "=== GET /stt/config ==="
curl -sf "${BASE}/stt/config" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('enabled:', d.get('enabled'))
print('smartTurn:', d.get('smartTurn'), 'timeoutMs:', d.get('smartTurnTimeoutMs'))
print('wsPath:', d.get('wsPath'))
if not d.get('wsPath'):
    print('FAIL: missing wsPath')
    sys.exit(1)
print('OK: STT config')
"

echo ""
echo "=== POST /realtime/client-secret ==="
curl -sf -X POST "${BASE}/realtime/client-secret" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('wsUrl:', d.get('wsUrl','?')[:60]+'...'); print('OK' if d.get('value') else 'FAIL')"

echo ""
echo "All voice pipeline server checks passed."
