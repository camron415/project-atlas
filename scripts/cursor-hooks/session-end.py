#!/usr/bin/env python3
"""Cursor sessionEnd hook — dump a stub if this chat never called session_close."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

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


def fetch_last_close(token: str) -> dict:
    req = urllib.request.Request(
        f"{BASE}/agent/where_we_left_off",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def recently_dumped(payload: dict) -> bool:
    last = (payload or {}).get("lastClose") or {}
    at = last.get("at")
    if not at:
        return False
    try:
        then = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        return False
    now = datetime.now(timezone.utc)
    return (now - then).total_seconds() < 15 * 60


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    workspace = (
        payload.get("cwd")
        or payload.get("root_path")
        or payload.get("workspace_path")
        or os.environ.get("CURSOR_PROJECT_DIR")
        or os.getcwd()
    )
    reason = payload.get("reason") or "unknown"
    session_id = payload.get("session_id") or os.environ.get("ATLAS_HOOK_SESSION_ID") or ""
    token = read_token()
    if not token:
        sys.stdout.write("{}\n")
        return

    duration_ms = payload.get("duration_ms")
    try:
        if duration_ms is not None and float(duration_ms) < 45_000:
            sys.stdout.write("{}\n")
            return
    except (TypeError, ValueError):
        pass

    try:
        status = fetch_last_close(token)
        if recently_dumped(status):
            sys.stdout.write("{}\n")
            return
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        pass

    note = (
        f"Cursor session ended ({reason}) without an in-chat summary. "
        f"Workspace: {workspace}. Session: {session_id or 'unknown'}. "
        "Check git and today's inbox; this is a mechanical stub, not a full dump."
    )
    body = json.dumps(
        {
            "note": note,
            "source": "session-end",
            "workspacePath": str(workspace),
            "skipSync": True,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/agent/session_close",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            resp.read()
    except (urllib.error.URLError, TimeoutError):
        pass
    sys.stdout.write("{}\n")


if __name__ == "__main__":
    main()
