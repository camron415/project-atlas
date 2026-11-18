#!/usr/bin/env python3
"""Cursor sessionStart hook — inject Atlas where-we-left-off into the chat."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ATLAS_ROOT = os.environ.get(
    "ATLAS_ROOT",
    "/Users/camrontrost/Documents/Macbook-Documents/projects/atlas",
)
ENV_PATH = os.path.join(ATLAS_ROOT, "server", ".env")
BASE = os.environ.get("ATLAS_HOOK_URL", "http://127.0.0.1:8787")


def read_token() -> str:
    try:
        with open(ENV_PATH, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("ATLAS_AGENT_TOKEN="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        return ""
    return os.environ.get("ATLAS_AGENT_TOKEN", "").strip()


def fetch_context(token: str) -> str:
    req = urllib.request.Request(
        f"{BASE}/agent/where_we_left_off",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        return f"Atlas where_we_left_off failed: {data.get('error', 'unknown')}"
    return str(data.get("context") or "").strip()


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}
    session_id = str(payload.get("session_id") or payload.get("conversation_id") or "")
    token = read_token()
    extra = (
        "Atlas loop: overnight managers and the phone agent cannot see this chat "
        "until you dump it. When you wrap up or ship something durable, POST "
        f"{BASE}/agent/session_close with a 3-8 bullet `note` (Bearer ATLAS_AGENT_TOKEN "
        "from atlas/server/.env), or run "
        "`cd atlas/server && npm run refresh-phone-knowledge -- --note \"...\"`. "
        "At the start of this chat, prefer the block below over guessing overnight status.\n\n"
    )
    if not token:
        context = extra + "Atlas agent token missing — cannot load where_we_left_off."
    else:
        try:
            context = extra + fetch_context(token)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            context = extra + f"Atlas server unreachable at {BASE} ({err}). Mac LaunchAgent may be down."

    out = {
        "env": {"ATLAS_HOOK_SESSION_ID": session_id} if session_id else {},
        "additional_context": context[:8000],
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
