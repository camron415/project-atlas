"""Localhost Atlas voice loop.

Phone is the handset. Brain: Qwen Flash by default, Qwen Plus on a real lookup.
This Mac still hosts the server. Open http://127.0.0.1:8791
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
import queue
import random
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.requests import ClientDisconnect

HERE = Path(__file__).resolve().parent
ATLAS_ENV = HERE.parent / ".env"
NOW_PATH = Path(
    "/Users/camront/Library/Mobile Documents/com~apple~CloudDocs/Documents/Macbook-Documents/vocalLearn/docs/NOW.md"
)
PORT = int(os.environ.get("ATLAS_VOICE_PORT", "8791"))
GATE_PATH = Path.home() / "Library/Application Support/Atlas/voice-gate"
OPEN_PATHS = {"/health", "/manifest.webmanifest", "/icon-180.png", "/icon-512.png"}
MODEL = "grok-4.3"
QWEN_MODEL = "qwen3.7-plus"
QWEN_FLASH = "qwen3.7-flash"
QWEN_MODELS = {"plus": QWEN_MODEL, "flash": QWEN_FLASH}
QWEN_URL = "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_RESPONSES = "https://dashscope-us.aliyuncs.com/compatible-mode/v1/responses"
VOICE = os.environ.get("ATLAS_KOKORO_VOICE", "af_heart")
LANG = "b" if VOICE.startswith("b") else "a"
HOLD_LINE = "One moment."
GREETING = "Hey, what's up?"
SPEED = 1.05

app = FastAPI()
state_lock = threading.Lock()


def load_gate() -> str:
    GATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = GATE_PATH.read_text().strip() if GATE_PATH.exists() else ""
    if existing:
        return existing
    token = secrets.token_urlsafe(18)
    GATE_PATH.write_text(token + "\n")
    os.chmod(GATE_PATH, 0o600)
    return token


GATE = load_gate()


def from_desk(request: Request) -> bool:
    # Tailscale Serve adds these. A direct localhost tab does not.
    if request.headers.get("x-forwarded-for") or request.headers.get("x-forwarded-proto"):
        return False
    host = (request.headers.get("host") or "").split(":")[0]
    return host in {"127.0.0.1", "localhost"}


def gate_ok(request: Request) -> bool:
    supplied = request.headers.get("x-atlas-gate") or request.query_params.get("k") or ""
    if len(supplied) != len(GATE):
        return False
    return secrets.compare_digest(supplied, GATE)


@app.middleware("http")
async def phone_gate(request: Request, call_next):
    if request.url.path in OPEN_PATHS or from_desk(request) or gate_ok(request):
        return await call_next(request)
    if request.url.path == "/":
        page = (
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>Atlas</title><p>This call is locked. Open it from the shortcut on your phone.</p>"
        )
        return Response(page, media_type="text/html", status_code=401)
    return JSONResponse({"error": "Locked."}, status_code=401)


@app.exception_handler(ClientDisconnect)
async def phone_hung_up(_request: Request, _exc: ClientDisconnect):
    return Response(status_code=204)
mlx_jobs: queue.Queue = queue.Queue()
mlx_active = False
history: list[dict[str, str]] = []
flight = {"user": "", "open": False, "done": False, "cut": None, "full": ""}
bridge_note = None
# The first quiet probe is about 0.4s. A score of 0.85 or higher is already
# past the breath filter, so that probe can end the turn.
MIN_COMMIT_MS = 400
# Used only when Smart Turn itself is down. A low score waits until PAUSE_CAP_MS.
QUIET_COMMIT_MS = 800
mic_held = False
BARGE_LOG = Path.home() / "Library/Application Support/Atlas/barge.jsonl"
PAUSE_LOG = Path.home() / "Library/Application Support/Atlas/pauses.jsonl"
# The phone still ends a turn at this quiet cap. Rows record it so a pause
# piled against the cap is known to be cut off, not a measured full pause.
PAUSE_CAP_MS = 8000
models: dict[str, object] = {
    "stt": None,
    "tts": None,
    "hold_wav": None,
    "greet_wav": None,
    "error": None,
    "detail": "Starting…",
    "ready": False,
}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def snapshot() -> str:
    if not NOW_PATH.exists():
        return "No work-order snapshot was found."
    text = NOW_PATH.read_text(errors="replace")
    start = text.find("### 1 — The loop")
    clip = text[start : start + 1800] if start >= 0 else text[:1800]
    return clip.strip()


REPO = NOW_PATH.parents[1]
PACK = REPO / "atlas-personal-context"
CHAT_INDEX = REPO / "archive/chats/INDEX.md"
STORY_PATH = PACK / "career-planning-roadmap/career-dashboard-docs/MY_STORY.md"
LIFE_PATH = PACK / "our-story-journey/CONTENT.md"
CURRENT_STATUS = PACK / "voice-notes/CURRENT-2026-11-18.md"


def read_clip(path: Path, limit: int, start: str = "", end: str = "") -> str:
    if not path.exists():
        return ""
    text = path.read_text(errors="replace")
    if start:
        at = text.find(start)
        if at >= 0:
            text = text[at:]
    if end:
        stop = text.find(end)
        if stop > 0:
            text = text[:stop]
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:limit].strip()


def recent_chats(n: int) -> str:
    if not CHAT_INDEX.exists():
        return "No closed-chat summaries are on this Mac yet."
    rows = []
    for line in CHAT_INDEX.read_text(errors="replace").splitlines():
        if not line.startswith("| 20"):
            continue
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(parts) < 5:
            continue
        date, _chat_id, title, status, gist = parts[:5]
        gist = re.sub(r"`+", "", re.sub(r"\s+", " ", gist))[:170]
        rows.append(f"{date} — {title} ({status}). {gist}")
    if not rows:
        return "No closed-chat summaries are on this Mac yet."
    return "\n".join(rows[-n:])


ATLAS_ROOT = HERE.parent.parent
REPO_TOOL = {
    "type": "function",
    "name": "look_at_code",
        "description": (
        "Call only when Camron asked to open a file or find something in a repo. "
        "Naming Atlas, Halo, or orchestration is not a call. A story is not a call. "
        "search needs a query. read needs a path. Set spoken_ack to one short true "
        "clause that you are checking that thing."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "repo": {
                "type": "string",
                "enum": ["vocallearn", "atlas"],
                "description": "vocallearn is Halo, the learning app. atlas is this voice app.",
            },
            "kind": {
                "type": "string",
                "enum": ["map", "read", "search", "recent"],
                "description": "map is the folder outline. read is one file. search finds a phrase. recent is the latest commits.",
            },
            "path": {
                "type": "string",
                "description": "File or folder inside the repo. Required for read. Optional for search.",
            },
            "query": {
                "type": "string",
                "description": "Phrase to find. Required for search.",
            },
            "spoken_ack": {
                "type": "string",
                "description": "One short clause he will hear while the lookup runs.",
            },
        },
        "required": ["repo", "kind"],
    },
}
BLOCK_PARTS = {
    ".git", "node_modules", ".next", "dist", "build", ".harvest",
    "immigration", "i-751", "voice-venv", "deriveddata",
}
BLOCK_NAMES = {
    ".env", ".env.local", ".env.qa.local", "credentials.json",
    "voice-gate", "call-url.local",
}


def repo_root(name: str) -> Path | None:
    root = {"vocallearn": REPO, "atlas": ATLAS_ROOT}.get(name.strip().lower())
    if root is None or not root.exists():
        return None
    return root.resolve()


def blocked_path(path: Path) -> bool:
    parts = {part.lower() for part in path.parts}
    if parts & BLOCK_PARTS:
        return True
    name = path.name.lower()
    if name in BLOCK_NAMES or name.startswith(".env"):
        return True
    return False


def inside_repo(root: Path, rel: str) -> Path | None:
    cleaned = (rel or "").strip().lstrip("/")
    if not cleaned or ".." in Path(cleaned).parts:
        return None
    path = (root / cleaned).resolve()
    if path != root and root not in path.parents:
        return None
    if blocked_path(path):
        return None
    return path


def known_roots() -> list[Path]:
    roots = []
    for name in ("vocallearn", "atlas"):
        root = repo_root(name)
        if root is not None:
            roots.append(root)
    return roots


def locate_in_checkouts(preferred: Path, rel: str) -> tuple[Path, Path] | None:
    """A full Mac path is fine when it sits inside vocalLearn or Atlas.

    A short path is tried in the repo she named, then in the other checkout.
    """
    text = (rel or "").strip().strip("'\"")
    if not text:
        return None
    for root in known_roots():
        marker = root.name.lower() + "/"
        idx = text.lower().find(marker)
        if idx < 0:
            continue
        found = inside_repo(root, text[idx + len(marker):])
        if found is not None and found.exists():
            return root, found
    if text.startswith("/"):
        path = Path(text).expanduser().resolve()
        if blocked_path(path):
            return None
        for root in known_roots():
            if path == root or root in path.parents:
                return root, path
        return None
    first = inside_repo(preferred, text)
    if first is not None and first.exists():
        return preferred, first
    for root in known_roots():
        if root == preferred:
            continue
        other = inside_repo(root, text)
        if other is not None and other.exists():
            return root, other
    if first is not None:
        return preferred, first
    return None


def git_line(root: Path, args: list[str]) -> str:
    try:
        done = subprocess.run(
            ["git", "--no-optional-locks", "-C", str(root), *args],
            timeout=4,
            capture_output=True,
            text=True,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return ""
    return (done.stdout or "").strip()


def look_at_code(raw: dict) -> str:
    root = repo_root(str(raw.get("repo") or ""))
    kind = str(raw.get("kind") or "").strip().lower()
    if root is None:
        return "Unknown repo. Use vocallearn or atlas."
    label = root.name
    if kind == "recent":
        branch = git_line(root, ["rev-parse", "--abbrev-ref", "HEAD"]) or "unknown branch"
        log = git_line(root, ["log", "-8", "--pretty=format:%h %ad %s", "--date=short"])
        text = f"{label} on {branch}\n{log or 'No commits were readable.'}"
    elif kind == "read":
        located = locate_in_checkouts(root, str(raw.get("path") or ""))
        path = located[1] if located else None
        root = located[0] if located else root
        if path is None:
            text = "That path is not available."
        elif path.is_dir():
            names = []
            for child in sorted(path.iterdir()):
                if child.name.startswith(".") or blocked_path(child):
                    continue
                names.append(child.name + ("/" if child.is_dir() else ""))
                if len(names) >= 40:
                    break
            text = f"{path.relative_to(root)}/\n" + "\n".join(names)
        elif not path.is_file():
            name = Path(str(raw.get("path") or "")).name
            text = search_repo(root, name, "") if name else "That file is not in the checkout."
        elif path.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf", ".wav", ".zip", ".onnx"}:
            text = "That file is not text."
        else:
            data = path.read_bytes()[:80_000]
            if b"\0" in data:
                text = "That file is not text."
            else:
                body = data.decode("utf-8", errors="replace")
                body = re.sub(
                    r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S+",
                    r"\1: [hidden]",
                    body,
                )
                clipped = body[:6000]
                note = "\nShowing the first part of a longer file." if len(body) > 6000 else ""
                text = f"{path.relative_to(root)}\n{clipped}{note}"
    elif kind == "search":
        query = str(raw.get("query") or "").strip()
        if not query:
            text = "A search needs a phrase."
        else:
            text = search_repo(root, query, str(raw.get("path") or ""))
            if text.startswith("Nothing "):
                for other in known_roots():
                    if other == root:
                        continue
                    wider = search_repo(other, query, "")
                    if not wider.startswith("Nothing "):
                        text = wider
                        break
    elif kind == "map":
        branch = git_line(root, ["rev-parse", "--abbrev-ref", "HEAD"]) or "unknown branch"
        latest = git_line(root, ["log", "-1", "--pretty=format:%h %ad %s", "--date=short"])
        text = f"{label} on {branch}. Latest: {latest or 'unreadable'}\n{outline_repo(root)}"
    else:
        text = "Use map, read, search, or recent."
    print(f"repo {raw.get('repo')} {kind} chars={len(text)}", flush=True)
    return text[:7000]


def outline_repo(root: Path) -> str:
    lines = []
    tops = []
    deepen = {"docs", "web", "roles", "scripts", "ios", "server", "atlas-personal-context"}
    entries = sorted(child for child in root.iterdir() if not child.name.startswith("."))
    for entry in entries:
        if blocked_path(entry):
            continue
        if entry.is_dir():
            tops.append(entry.name)
            lines.append(entry.name + "/")
            if entry.name in deepen:
                shown = 0
                for child in sorted(entry.iterdir()):
                    if child.name.startswith(".") or blocked_path(child):
                        continue
                    lines.append(f"  {entry.name}/{child.name}" + ("/" if child.is_dir() else ""))
                    shown += 1
                    if shown >= 8:
                        break
        else:
            lines.append(entry.name)
        if len(lines) >= 70:
            break
    return "Top folders: " + ", ".join(tops) + "\n" + "\n".join(lines)


def rg_bin() -> str | None:
    found = shutil.which("rg")
    if found:
        return found
    for path in (
        "/opt/homebrew/bin/rg",
        "/usr/local/bin/rg",
        "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
    ):
        if os.access(path, os.X_OK):
            return path
    return None


def excerpt_around(path: Path, line_no: int) -> str:
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return ""
    start = max(0, line_no - 3)
    end = min(len(lines), line_no + 2)
    rows = []
    for number in range(start, end):
        row = lines[number].strip()
        if row:
            rows.append(row[:220])
    body = "\n".join(rows[:5])
    return re.sub(
        r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S+",
        r"\1: [hidden]",
        body,
    )


SEARCH_SKIP = {
    "model", "name", "file", "files", "look", "what", "that", "this", "with",
    "from", "your", "have", "about", "server", "voice", "code", "notes",
}


def search_hits(base: Path, phrase: str) -> list[tuple[Path, int]]:
    rg = rg_bin()
    hits: list[tuple[Path, int]] = []
    if rg:
        try:
            done = subprocess.run(
                [
                    rg, "-n", "-i", "-F", "--max-count", "4",
                    "-g", "!node_modules/**", "-g", "!.git/**",
                    "-g", "!immigration/**", "-g", "!i-751/**",
                    "-g", "!.env*", "-g", "!*.png", "-g", "!*.wav", "-g", "!*.pdf",
                    phrase, str(base),
                ],
                timeout=6,
                capture_output=True,
                text=True,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return []
        for line in (done.stdout or "").splitlines():
            if "immigration" in line.lower() or "i-751" in line.lower():
                continue
            file_part, sep, rest = line.partition(":")
            if not sep:
                continue
            number = rest.split(":", 1)[0]
            if number.isdigit():
                hits.append((Path(file_part), int(number)))
            elif file_part.isdigit() and base.is_file():
                # rg omits the path when it is given one file.
                hits.append((base, int(file_part)))
            else:
                continue
            if len(hits) >= 8:
                break
        return hits
    return walk_search(base, phrase)


def prefer_definition(path: Path, numbers: list[int]) -> int:
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return numbers[0]
    for number in numbers:
        row = lines[number - 1] if 0 < number <= len(lines) else ""
        if row.lstrip().startswith(("def ", "class ", "func ", "function ")):
            return number
    return numbers[0]


def routing_slice(root: Path) -> str:
    path = root / "server/voice-local/app.py"
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return ""
    start = next((i for i, line in enumerate(lines) if line.startswith("def qwen_events")), None)
    if start is None:
        return ""
    rows = [line.strip()[:220] for line in lines[start:start + 36] if line.strip()]
    return "server/voice-local/app.py, the model handoff:\n" + "\n".join(rows)


def search_repo(root: Path, query: str, rel: str) -> str:
    phrase = " ".join(query.split())
    if not phrase:
        return "A search needs a phrase."
    base = inside_repo(root, rel) if rel.strip() else root
    if base is None:
        return "That folder is not available."
    hits = search_hits(base, phrase)
    lead = ""
    if not hits:
        words = [
            word for word in re.findall(r"[A-Za-z0-9_.-]{4,}", phrase)
            if word.lower() not in SEARCH_SKIP
        ]
        words.sort(key=len, reverse=True)
        for word in words[:3]:
            hits = search_hits(base, word)
            if hits:
                lead = f"The exact phrase missed. These lines contain {word}. "
                break
    blocks = []
    by_file: dict[Path, list[int]] = {}
    for path, line_no in hits:
        by_file.setdefault(path, []).append(line_no)
    for path, numbers in list(by_file.items())[:4]:
        line_no = prefer_definition(path, numbers)
        try:
            shown = path.resolve().relative_to(root)
        except ValueError:
            continue
        body = excerpt_around(path, line_no)
        if body:
            blocks.append(f"{shown}, around line {line_no}:\n{body}")
    if not blocks:
        return "Nothing in the checkout matched that phrase."
    files = "file" if len(blocks) == 1 else "files"
    return (
        f"{lead}Found {len(hits)} matching lines in {len(blocks)} {files}. "
        "Summarize this for him in a few spoken sentences. Do not call the tool again.\n\n"
        + "\n\n".join(blocks)
    )


def walk_search(base: Path, phrase: str) -> list[tuple[Path, int]]:
    needle = phrase.lower()
    hits: list[tuple[Path, int]] = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            name for name in dirnames
            if not name.startswith(".") and name not in BLOCK_PARTS
        ]
        for name in filenames:
            if name.startswith(".") or name.lower() in BLOCK_NAMES:
                continue
            path = Path(dirpath) / name
            if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf", ".wav", ".zip", ".onnx"}:
                continue
            try:
                if path.stat().st_size > 300_000:
                    continue
                lines = path.read_text(errors="replace").splitlines()
            except OSError:
                continue
            for number, line in enumerate(lines, start=1):
                if needle in line.lower():
                    hits.append((path, number))
                    break
            if len(hits) >= 8:
                return hits
    return hits


def function_calls(event: dict) -> list[dict]:
    found = []

    def take(item: object) -> None:
        if not isinstance(item, dict):
            return
        if item.get("type") == "function_call" and item.get("call_id"):
            found.append(item)

    take(event.get("item"))
    take(event.get("output_item"))
    response = event.get("response")
    if isinstance(response, dict):
        for item in response.get("output") or []:
            take(item)
    return found


def response_identity(event: dict) -> str:
    response = event.get("response")
    if isinstance(response, dict) and response.get("id"):
        return str(response["id"])
    return ""


def response_output(event: dict) -> list:
    response = event.get("response")
    if isinstance(response, dict) and isinstance(response.get("output"), list):
        return response["output"]
    return []


HARD = re.compile(r"\b(think (it |this )?through|reason (about|through)|in detail|step by step)\b", re.I)
CALL_LOG = Path.home() / "Library/Application Support/Atlas/calls.jsonl"
TURN_MODEL = Path.home() / "Library/Application Support/Atlas/models/smart-turn-v3.2-cpu.onnx"
turn_state: dict[str, object] = {"session": None, "feat": None, "error": None}
active_turn = {"id": ""}
stopped_turns: set[str] = set()
turn_lock = threading.Lock()


def practice_layer(slot: str) -> str:
    if slot != "1":
        return ""
    return """
PRACTICE MODE — Daniel 1–7 youth Sunday School (Come Follow Me, week of November 9–15, 2026). Title: There Is No Other God That Can Deliver.
You are Camron's lesson tutor for about twenty minutes with youth who participate lightly. This is not Jeremiah or a game night. Help him rehearse out loud.
Center the lesson on Daniel 3:16–18 (Shadrach, Meshach, Abed-nego before the furnace). Close with Daniel 7:13–14 (Son of Man) if time allows. Chapters 4–5 only as a short bridge if he is ahead. If time is tight, pick either the lions' den (chapter 6) or the stone kingdom (chapter 2), not both.
Suggest real discussion questions, story order, and transitions. Quote scripture briefly when it helps; do not invent verses or chapter-and-verse you are unsure of. If he asks for exact wording, give the sense in plain speech unless you are confident.
Do not use look_at_code or web search on this call unless he clearly asks you to look something up online or in his files. No Halo, career, or personal notes unless he switches off practice.
Stay phone-spoken: short turns, invite him to try lines, push back gently if the arc is weak, celebrate clear youth-friendly language.
"""


def current_status() -> str:
    """Short standing truth. Loaded every call so GitHub updates reach the phone after a voice restart."""
    if not CURRENT_STATUS.exists():
        return ""
    text = re.sub(r"\n{3,}", "\n\n", CURRENT_STATUS.read_text(errors="replace")).strip()
    return text[:1800]


def system_prompt(user_text: str, brain: str = "grok", practice_slot: str = "") -> str:
    # Day only, so the standing prompt can stay cached across a conversation.
    today = time.strftime("%A, %B %-d, %Y", time.localtime())
    if brain == "flash":
        judge = (
            "Judgment for this call is Qwen Flash through Alibaba, with web search and the code lookup. "
            "He can switch to Plus or Grok from the call screen."
        )
    elif brain == "plus":
        judge = (
            "Judgment for this call is Qwen Plus through Alibaba, with web search and the code lookup. "
            "He can switch to Flash or Grok from the call screen."
        )
    else:
        judge = "Judgment is Grok 4.3 through the xAI API, not a local model."
    status = current_status()
    prompt = f"""You are Atlas, Camron's phone voice. He lives in Salt Lake City with Camila and is building Halo, a learning app, and you. Do not invent his job or private facts.
You can hear him. Today is {today}, Mountain time. {judge}
What is true right now, from GitHub. If an older file disagrees, this wins:
{status}
Answer from this brief and ordinary knowledge. You do not hold his files, live weather, or the news.
A story is not a request. Rain, his work, the market, orchestration, and the repo come up in stories. Answer him, and do not look or offer.
If he asks for a live fact or a file this brief cannot answer, look it up. If you are unsure he wants that, offer once and wait. In Sunday School rehearsal, offer or look only if he clearly asks.
Friendly and natural. Do not call him sir.
Match your length to the question. A small question gets one or two sentences. A decision, a plan, or an explanation can run four to six sentences, then one short question if you need something from him. Do not monologue.
If he only says hello, hey, what's up, good morning, or checks that you are there, greet him back and stop. Do not bring up the last topic, Halo, his money, or a previous chat until he names it.
If he interrupts, he heard only part of your last reply. The words he never heard are gone. Answer the conversation as it stands. His earlier point and the words he just added both count when they are still relevant together. If the new words replace that answer, follow the new words and do not finish the sentence he cut off. If he wants you to keep going, continue from the last words he heard. Do not recite his words back.
Say it the way you would on a phone call. No markdown, no lists, no links, no brackets, no citation numbers, no URLs, and no source names.
"""
    greeting = re.sub(r"[^a-z'\s]", "", user_text.lower())
    greeting = re.sub(r"\s+", " ", greeting).strip()
    if greeting in {
        "hey", "hi", "hello", "yo", "hey atlas", "hi atlas", "hello atlas",
        "what's up", "whats up", "hey what's up", "hey whats up",
        "you there", "are you there", "hey you there",
        "good morning", "good evening", "morning",
    }:
        if not practice_slot:
            prompt += "\nHe only greeted you. Greet him back in one short line. Do not name a topic.\n"
        else:
            prompt += (
                "\nHe only greeted you. Greet him back briefly, then ask what part of "
                "the Daniel lesson he wants to rehearse first.\n"
            )
    layer = practice_layer(practice_slot)
    if layer:
        prompt += layer
    return prompt


def stop_turn(turn_id: str) -> None:
    with turn_lock:
        if not turn_id:
            return
        print(f"cancel turn id={turn_id}", flush=True)
        stopped_turns.add(turn_id)
        if len(stopped_turns) > 40:
            stopped_turns.clear()
            stopped_turns.add(turn_id)
        # Only the cancelled turn. A late cancel for the probe must not blank the reply that just started.
        if active_turn["id"] == turn_id:
            active_turn["id"] = ""


def claim_turn(turn_id: str) -> bool:
    with turn_lock:
        if turn_id and turn_id in stopped_turns:
            return False
        active_turn["id"] = turn_id
        return True


def turn_stopped(turn_id: str) -> bool:
    with turn_lock:
        if turn_id and turn_id in stopped_turns:
            return True
        return bool(turn_id) and active_turn["id"] != turn_id


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def speakable(text: str) -> str:
    text = re.sub(r"\[\[?\d+\]\]?\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\[{1,2}\d+\]{0,2}\(?", " ", text)
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"\s+", " ", text).strip(" \t-")
    return text


def peel_spoken(buf: str) -> tuple[str, str]:
    """Hold a citation or URL that is still arriving so it is not read aloud."""
    cut = len(buf)
    for match in re.finditer(r"\[\[|https?://", buf):
        rest = buf[match.start() :]
        unfinished = ")" not in rest if match.group() == "[[" else bool(re.match(r"https?://\S*$", rest))
        if unfinished:
            cut = min(cut, match.start())
    dangling = re.search(r"\[[^\]]*$", buf[:cut])
    if dangling:
        cut = dangling.start()
    return buf[:cut], buf[cut:]


def record_turn(
    heard: str,
    said: str,
    timing: dict,
    searched: bool,
    caption: str = "",
    pause: dict | None = None,
    brain: str = "plus",
) -> None:
    CALL_LOG.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "brain": brain,
        "search": searched,
        "stt_ms": timing.get("stt_ms", 0),
        "asr_ms": timing.get("asr_ms", 0),
        "first_token_ms": timing.get("first_token_ms", 0),
        "first_audio_ms": timing.get("first_audio_ms", 0),
        "ours_ms": timing.get("ours_ms", 0),
        "hold_ms": timing.get("hold_ms", 0),
        "theirs_ms": timing.get("theirs_ms", 0),
        "heard": heard,
        "said": said,
    }
    if timing.get("worker"):
        row["worker"] = timing["worker"]
    if caption:
        row["caption"] = caption
    if pause and pause.get("decision"):
        row["silence_ms"] = pause.get("silence_ms", 0)
        row["speech_ms"] = pause.get("speech_ms", 0)
        row["route"] = pause.get("route", "")
        row["pause_p"] = pause.get("p")
        row["pause"] = pause.get("decision")
    with CALL_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


# Said alone. "Hold on, the market…" is a sentence and must not mute.
HOLD_PHRASES = {
    "hold on",
    "hold on one second",
    "hold on a second",
    "hold on one sec",
    "hold on a sec",
}


def command_word(text: str) -> str | None:
    """A whole turn that is only a command. Never a phrase inside a sentence."""
    cleaned = re.sub(r"[^a-z\s]", "", text.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned in HOLD_PHRASES:
        return "mute"
    if cleaned in {"unmute", "un mute"}:
        return "unmute"
    return None


def set_held(name: str) -> None:
    global mic_held
    if name == "mute":
        mic_held = True
    elif name == "unmute":
        mic_held = False


def log_barge(row: dict) -> None:
    BARGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    row["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with BARGE_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def log_pause(row: dict) -> None:
    """One row per pause event. resume = he kept talking. hold = model said wait. send = we ended the turn."""
    PAUSE_LOG.parent.mkdir(parents=True, exist_ok=True)
    out = dict(row)
    out.setdefault("cap_ms", PAUSE_CAP_MS)
    out["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with PAUSE_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(out, ensure_ascii=False) + "\n")


def remember_locked(user: str, assistant: str) -> None:
    pair = (
        len(history) >= 2
        and history[-1].get("role") == "assistant"
        and history[-2].get("role") == "user"
        and history[-2].get("content") == user
    )
    if not assistant:
        if pair:
            history.pop()
        return
    if pair:
        history[-1]["content"] = assistant
        return
    history.append({"role": "user", "content": user})
    history.append({"role": "assistant", "content": assistant})
    del history[:-20]


def begin_flight(user: str) -> None:
    with state_lock:
        flight["user"] = user
        flight["open"] = True
        flight["done"] = False
        flight["cut"] = None
        flight["full"] = ""


def bridge_from(user: str, heard: str, full: str) -> None:
    """What he asked, what he heard, and the rest she had not reached. Frontier truncate keeps only the heard line in history."""
    global bridge_note
    heard_s = " ".join(heard.split())
    full_s = " ".join(full.split())
    unheard = full_s
    if heard_s and full_s.startswith(heard_s):
        unheard = full_s[len(heard_s) :].strip()
    bridge_note = {"user": user, "heard": heard_s, "unheard": unheard[:900]}


def take_bridge():
    global bridge_note
    note = bridge_note
    bridge_note = None
    return note


def note_cut(text: str) -> None:
    spoken = " ".join(text.split())
    with state_lock:
        if not flight["open"]:
            return
        flight["cut"] = spoken
        if flight["done"]:
            bridge_from(str(flight["user"]), spoken, str(flight.get("full") or ""))
            remember_locked(str(flight["user"]), spoken)


def finish_flight(full: str, stopped: bool) -> str:
    with state_lock:
        if not flight["open"] or flight["done"]:
            return ""
        flight["done"] = True
        flight["full"] = full
        cut = flight["cut"]
        if cut is None:
            text = "" if stopped else full
        else:
            bridge_from(str(flight["user"]), str(cut), full)
            text = str(cut)
        if flight["user"] and text:
            remember_locked(str(flight["user"]), text)
        elif flight["user"] and cut is not None:
            history.append({"role": "user", "content": str(flight["user"])})
            del history[:-20]
        return text


def next_cut(buf: str, first: bool) -> int | None:
    """Cut at a sentence end, or at the first breath if nothing has been spoken yet."""
    for match in re.finditer(r"([.!?])(\s+|$)|([,;:—])(\s+)|(\s[-–—]\s)", buf):
        end = match.end()
        if match.group(1):
            if end >= 2:
                return end
            continue
        if first and len(buf[:end].split()) >= 8:
            return end
    return None


def take_pieces(buf: str, final: bool = False, first: bool = False) -> tuple[list[str], str]:
    pieces: list[str] = []
    while True:
        cut = next_cut(buf, first and not pieces)
        if cut is None:
            break
        piece = buf[:cut].strip()
        buf = buf[cut:]
        if piece:
            pieces.append(piece)
    if final and buf.strip():
        pieces.append(buf.strip())
        buf = ""
    return pieces, buf


def wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    audio = np.clip(audio, -1.0, 1.0)
    buf = io.BytesIO()
    import soundfile as sf

    sf.write(buf, audio, sample_rate, format="WAV")
    return buf.getvalue()


def samples_of(result) -> tuple[np.ndarray, int]:
    import mlx.core as mx

    audio = result.audio
    if hasattr(audio, "astype"):
        audio = np.array(audio.astype(mx.float32))
    else:
        audio = np.array(audio, dtype=np.float32)
    rate = int(getattr(result, "sample_rate", 24000) or 24000)
    return audio, rate


def on_mlx(fn):
    """MLX streams belong to the thread that loaded the models."""
    done: queue.Queue = queue.Queue()
    mlx_jobs.put((fn, done))
    ok, value = done.get()
    if not ok:
        raise value
    return value


def synth_chunks(text: str):
    """One clip per phrase, so the phone does not join audio mid-sentence."""
    text = speakable(text)
    if not text:
        return
    tts = models["tts"]
    kwargs = {"text": text, "voice": VOICE, "speed": SPEED, "lang_code": LANG}
    try:
        generated = tts.generate(**kwargs)
    except TypeError:
        generated = tts.generate(**kwargs, stream=False)
    parts = []
    rate = 24000
    try:
        results = generated if isinstance(generated, list) else list(generated)
    except TypeError:
        results = [generated]
    for result in results:
        audio, rate = samples_of(result)
        if audio.size:
            parts.append(audio)
    if parts:
        yield wav_bytes(np.concatenate(parts), rate)


def synthesize_impl(text: str) -> bytes:
    parts = list(synth_chunks(text))
    if not parts:
        return b""
    if len(parts) == 1:
        return parts[0]
    samples = []
    rate = 24000
    import soundfile as sf

    for part in parts:
        data, rate = sf.read(io.BytesIO(part), dtype="float32")
        samples.append(np.asarray(data, dtype=np.float32))
    return wav_bytes(np.concatenate(samples), rate)


def stream_synth(text: str):
    """Yield wav chunks while Kokoro is still speaking the rest of the line."""
    out: queue.Queue = queue.Queue()

    def run():
        try:
            for wav in synth_chunks(text):
                out.put(wav)
            out.put(None)
        except Exception as err:
            out.put(err)

    done: queue.Queue = queue.Queue()
    mlx_jobs.put((run, done))
    while True:
        item = out.get()
        if item is None:
            done.get()
            return
        if isinstance(item, Exception):
            done.get()
            raise item
        yield item


def transcribe_impl(path: str) -> str:
    result = models["stt"].transcribe(path)
    return speakable(getattr(result, "text", "") or "")


def to_wav_file(raw: bytes, suffix: str) -> str:
    src = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    src.write(raw)
    src.close()
    dst = src.name + ".wav"
    try:
        subprocess.run(
            [
                "/opt/homebrew/bin/ffmpeg",
                "-y",
                "-i",
                src.name,
                "-ac",
                "1",
                "-ar",
                "16000",
                dst,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as err:
        detail = (err.stderr or b"").decode("utf-8", errors="replace")[-300:]
        if os.path.exists(dst):
            os.unlink(dst)
        raise RuntimeError(f"Could not read that audio ({suffix}). {detail}") from err
    finally:
        if os.path.exists(src.name):
            os.unlink(src.name)
    return dst


def silence_wav() -> str:
    path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    with wave.open(path, "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 16000)
    return path


def iter_sse(response):
    buffer = ""
    while True:
        chunk = response.read(4096)
        if not chunk:
            break
        buffer += chunk.decode("utf-8", errors="replace")
        parts = buffer.split("\n\n")
        buffer = parts.pop()
        for part in parts:
            data = "\n".join(
                line[5:].lstrip()
                for line in part.split("\n")
                if line.startswith("data:")
            ).strip()
            if not data or data == "[DONE]":
                continue
            try:
                yield json.loads(data)
            except json.JSONDecodeError:
                continue


def output_delta(event: dict) -> str:
    kind = str(event.get("type") or "")
    if kind not in {"response.output_text.delta", "response.content_part.delta"} and not kind.endswith(
        "output_text.delta"
    ):
        return ""
    delta = event.get("delta")
    if isinstance(delta, str):
        return delta
    if isinstance(delta, dict):
        return str(delta.get("text") or delta.get("content") or "")
    return ""


def is_search(event: dict) -> bool:
    kind = str(event.get("type") or "").lower()
    if "web_search" in kind:
        return True
    item = event.get("item") or event.get("output_item") or {}
    if isinstance(item, dict) and "web_search" in str(item.get("type") or "").lower():
        return True
    return False


def open_grok(body: dict):
    load_env(ATLAS_ENV)
    key = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
    if not key:
        raise RuntimeError("XAI_API_KEY is missing from the Atlas server env.")
    base = os.environ.get("XAI_API_URL") or os.environ.get("GROK_API_URL") or "https://api.x.ai/v1"
    req = urllib.request.Request(
        f"{base.rstrip('/')}/responses",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        return urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:800]
        detail = re.sub(r"Bearer\s+\S+", "Bearer …", detail)
        raise RuntimeError(f"Grok error ({err.code}): {detail}") from err


def grok_events(user_text: str, bridge: dict | None = None, practice_slot: str = ""):
    if bridge:
        user_text = (
            "He cut in while you were answering. The words he never heard are not part of the conversation.\n"
            f"Earlier he said: {bridge.get('user') or ''}\n"
            f"He heard you say: {bridge.get('heard') or 'nothing yet'}\n"
            f"He then said: {user_text}\n"
            "Answer the conversation as it stands. Use the earlier point and these new words when both are still relevant. "
            "If the new words replace that answer, follow them and do not finish the cut-off sentence. "
            "If he wants you to keep going, continue from the last words he heard. "
            "Do not recite his words back."
        )
    # store stays off, so a lookup is continued by replaying her tool call
    # with the file text. Ordinary turns still stream straight through.
    carried: list = [
        {"role": "system", "content": system_prompt(user_text, "grok", practice_slot)},
        *history[-16:],
        {"role": "user", "content": user_text},
    ]
    follow = False
    for _round in range(3):
        body = {
            "model": MODEL,
            "input": carried,
            "temperature": 0.4,
            "max_output_tokens": 420,
            "reasoning": {"effort": "low" if HARD.search(user_text) else "none"},
            # Voice turns skip the default queue. Billed at 2x only when the reply says priority.
            "service_tier": "priority",
            "store": False,
            "stream": True,
            "include": ["reasoning.encrypted_content"],
            "tools": [{"type": "web_search"}, REPO_TOOL],
            "max_tool_calls": 3,
        }
        yield {"type": "clock", "mark": "open"}
        resp = open_grok(body)
        content_type = resp.headers.get("Content-Type", "")
        calls: list[dict] = []
        seen: set[str] = set()
        output: list = []
        announced_repo = False
        if "text/event-stream" not in content_type:
            payload = json.loads(resp.read().decode())
            output = payload.get("output") or []
            for item in output:
                if item.get("type") == "function_call" and item.get("call_id") and item["call_id"] not in seen:
                    seen.add(item["call_id"])
                    calls.append(item)
            if not calls:
                text = payload.get("output_text") or ""
                if not text:
                    for item in output:
                        if item.get("type") != "message":
                            continue
                        for part in item.get("content") or []:
                            if part.get("type") in {"output_text", "text"}:
                                text += part.get("text") or ""
                if text:
                    yield {"type": "text", "text": text}
                return
        else:
            for event in iter_sse(resp):
                chunk = response_output(event)
                if chunk:
                    output = chunk
                fresh = []
                for item in function_calls(event):
                    prior = next((row for row in calls if row.get("call_id") == item["call_id"]), None)
                    if prior:
                        if item.get("name"):
                            prior["name"] = item["name"]
                        if item.get("arguments"):
                            prior["arguments"] = item["arguments"]
                        continue
                    seen.add(item["call_id"])
                    fresh.append(item)
                if fresh:
                    calls.extend(fresh)
                    if not announced_repo:
                        announced_repo = True
                        yield {"type": "repo"}
                    continue
                if calls:
                    continue
                if follow:
                    yield event
                    continue
                yield event
        if not calls:
            return
        finished = [
            item for item in output
            if isinstance(item, dict) and item.get("type") == "function_call" and item.get("call_id")
        ]
        if finished:
            calls = finished
        if not announced_repo:
            yield {"type": "repo"}
        if not output:
            output = [
                {
                    "type": "function_call",
                    "call_id": item.get("call_id") or "",
                    "name": item.get("name") or "",
                    "arguments": item.get("arguments") or "{}",
                }
                for item in calls
            ]
        results = []
        for item in calls:
            try:
                args = json.loads(item.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            name = item.get("name") or ""
            print(f"tool {name or 'unnamed'} {args.get('repo', '')} {args.get('kind', '')}", flush=True)
            if name != "look_at_code":
                result = "That lookup is not available."
            else:
                result = look_at_code(args)
            results.append({
                "type": "function_call_output",
                "call_id": item.get("call_id") or "",
                "output": result,
            })
        carried = carried + output + results
        follow = True
    yield {"type": "text", "text": "I looked at the code, but the answer didn't come back."}


def normalize_brain(name: str) -> str:
    raw = (name or "").strip().lower()
    if raw in {"grok", "plus", "flash"}:
        return raw
    return ""


BRAIN_PATH = Path.home() / "Library/Application Support/Atlas/voice-brain"


def load_live_brain() -> dict:
    try:
        name = normalize_brain(BRAIN_PATH.read_text())
    except OSError:
        name = ""
    if name:
        return {"name": name, "from_page": True}
    return {"name": "plus", "from_page": False}


live_brain = load_live_brain()

PRACTICE_PATH = Path.home() / "Library/Application Support/Atlas/voice-practice"


def normalize_practice(slot: str) -> str:
    raw = (slot or "").strip()
    if raw == "1":
        return raw
    return ""


def load_live_practice() -> dict:
    try:
        slot = normalize_practice(PRACTICE_PATH.read_text())
    except OSError:
        slot = ""
    if slot:
        return {"slot": slot, "from_page": True}
    return {"slot": "", "from_page": False}


live_practice = load_live_practice()


def chosen_practice(request: Request) -> str:
    if live_practice.get("from_page"):
        picked = normalize_practice(str(live_practice.get("slot") or ""))
        if picked:
            return picked
    return normalize_practice(request.headers.get("x-atlas-practice") or "")


END_PATH = Path.home() / "Library/Application Support/Atlas/voice-end"


def normalize_end(mode: str) -> str:
    raw = (mode or "").strip().lower()
    if raw in {"mac", "phone", "manual"}:
        return raw
    return ""


def load_live_end() -> dict:
    try:
        mode = normalize_end(END_PATH.read_text())
    except OSError:
        mode = ""
    if mode:
        return {"mode": mode, "from_page": True}
    return {"mode": "mac", "from_page": False}


live_end = load_live_end()


def chosen_end(request: Request) -> str:
    if live_end.get("from_page"):
        picked = normalize_end(str(live_end.get("mode") or ""))
        if picked:
            return picked
    return normalize_end(request.headers.get("x-atlas-end") or "") or "mac"


def chosen_brain(request: Request) -> str:
    # A tap on the call page wins. An older phone build only sends grok or plus
    # and would otherwise overwrite Flash.
    if live_brain.get("from_page"):
        picked = normalize_brain(str(live_brain.get("name") or ""))
        if picked:
            return picked
    header = normalize_brain(request.headers.get("x-atlas-brain") or "")
    return header or "plus"


def open_qwen(body: dict, url: str = QWEN_URL):
    load_env(ATLAS_ENV)
    key = os.environ.get("DASHSCOPE_API_KEY")
    if not key:
        raise RuntimeError("DASHSCOPE_API_KEY is missing from the Atlas server env.")
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        return urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:800]
        detail = re.sub(r"Bearer\s+\S+", "Bearer …", detail)
        raise RuntimeError(f"Qwen error ({err.code}): {detail}") from err


def qwen_body(messages: list, search: str | None, model: str) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 420,
        "stream": True,
        "enable_thinking": False,
        "tools": [qwen_tool()],
    }
    # Agent search rejects a request that also carries look_at_code.
    # Turbo keeps the lookup and still lets her search.
    if search:
        body["enable_search"] = True
        # Without forced_search the model skips the web and talks about its context.
        body["search_options"] = {
            "search_strategy": search,
            "forced_search": True,
            "enable_source": True,
        }
    return body


ROUTING_ASK = re.compile(r"\b(routing|orchestration)\b", re.I)
WHERE_ASK = re.compile(r"\b(where|find|specifically|routing|orchestration|how we)\b", re.I)
FOLLOW_LOOKUP = re.compile(
    r"\b(look into|find where|where specifically|where do we|where is|where are|"
    r"routing|orchestration|how we handle|yourself|dig into|take a minute|the models)\b",
    re.I,
)
PRIOR_REPO = re.compile(r"\b(repo|folder|folders|file|files|checkout|structure)\b", re.I)


# The first sound after a lookup. Same shape, different words, and not the
# line he just heard. "One moment" can come back after a few minutes.
ACK_PATTERNS = (
    "One moment while I look into {focus}.",
    "Got it. I'll check {focus}.",
    "Okay. Looking into {focus}.",
    "Sure. Give me a second on {focus}.",
    "Alright, I'll see what I can find on {focus}.",
    "On it. Checking {focus}.",
    "Yep. I'll look into {focus}.",
    "Right. Let me check {focus}.",
    "Sounds good. I'll take a look at {focus}.",
    "Okay. I'll find the latest on {focus}.",
)
_recent_acks: list[tuple[float, str]] = []
ACK_REPEAT_S = 240


def ack_focus(mode: str, user_text: str) -> str:
    if mode == "code":
        if ROUTING_ASK.search(user_text):
            return "the model routing"
        if re.search(r"\b(notes|story|camila)\b", user_text, re.I):
            return "your notes"
        return "the repo"
    if re.search(r"\b(roads?|highway|interstate|driving|drive|passes|i-?70|i-?80)\b", user_text, re.I):
        return "the roads"
    if re.search(r"\b(weather|snow\w*|storm|forecast|rain\w*)\b", user_text, re.I):
        return "the weather"
    if re.search(r"\b(prices?|stocks?|markets?)\b", user_text, re.I):
        return "the market"
    if re.search(r"\bnews\b", user_text, re.I):
        return "the news"
    if re.search(r"\b(score|scores|game)\b", user_text, re.I):
        return "the score"
    return "that"


def preface_line(mode: str, user_text: str = "") -> str:
    if mode not in {"code", "search"}:
        return ""
    focus = ack_focus(mode, user_text)
    now = time.monotonic()
    _recent_acks[:] = [(stamp, line) for stamp, line in _recent_acks if now - stamp < ACK_REPEAT_S]
    used = {line for _, line in _recent_acks}
    last = _recent_acks[-1][1] if _recent_acks else ""
    choices = [pattern.format(focus=focus) for pattern in ACK_PATTERNS]
    fresh = [line for line in choices if line not in used and line != last]
    if not fresh:
        fresh = [line for line in choices if line != last] or choices
    line = random.choice(fresh)
    _recent_acks.append((now, line))
    print(f"ack {line!r}", flush=True)
    return line


def shape_lookup(args: dict, user_text: str) -> dict:
    """A where-question should search. A folder map already failed that ask once."""
    kind = str(args.get("kind") or "").strip().lower()
    if kind != "map" or not WHERE_ASK.search(user_text):
        return args
    query = str(args.get("query") or "").strip()
    if not query:
        query = "qwen_events" if ROUTING_ASK.search(user_text) else ""
    if not query:
        skip = SEARCH_SKIP | {
            "where", "find", "specifically", "into", "them", "yourself",
            "minute", "certain", "things", "such", "look", "take", "while",
        }
        words = [
            word for word in re.findall(r"[A-Za-z0-9_]{4,}", user_text)
            if word.lower() not in skip
        ]
        query = " ".join(words[:4])
    if not query:
        return args
    shaped = dict(args)
    shaped["kind"] = "search"
    shaped["query"] = query
    if ROUTING_ASK.search(user_text) and str(shaped.get("repo") or "atlas").lower() == "atlas":
        shaped["path"] = "server/voice-local"
    print(f"tool nudged map to search {query!r}", flush=True)
    return shaped


def deepen_routing(user_text: str, args: dict, result: str) -> str:
    if not ROUTING_ASK.search(user_text):
        return result
    if str(args.get("repo") or "atlas").strip().lower() not in {"atlas", ""}:
        return result
    if "def qwen_events" in result:
        return result
    root = repo_root("atlas")
    if root is None:
        return result
    found = routing_slice(root)
    if not found:
        return result
    print("tool deepened to model routing", flush=True)
    return "These lines are the model routing in the voice server.\n" + found


def plus_mode(user_text: str, practice_slot: str = "") -> str:
    if practice_slot == "1":
        if re.search(
            r"\b(look up|look it up|look that up|search the web|check online|google)\b",
            user_text,
            re.I,
        ):
            return "search"
        return "plain"
    # Agent web search cannot sit on the same request as look_at_code.
    # A live question gets search. Mentioning today or the market does not.
    files = re.search(
        r"\b(code|file|files|repo|repos|harness|commit|commits|function|source|timeout|look at|grep|notes|camila|my story|about me|who i am|invest|investing|brokerage|resume|career|left off|last time|my notes|my wife|routing|orchestration|where specifically|find where)\b",
        user_text,
        re.I,
    )
    live = wants_live(user_text)
    if files and not live:
        return "code"
    if live:
        return "search"
    prior = ""
    if history:
        prior = str(history[-1].get("content") or "")
    if PRIOR_REPO.search(prior) and FOLLOW_LOOKUP.search(user_text) and not live:
        return "code"
    if re.search(r"\b(yes|sure|go ahead|do it|please)\b", user_text, re.I) and re.search(
        r"\b(i'll look|i will look|let me look|want me to look)\b", prior, re.I
    ):
        return "search"
    if re.search(r"\b(code|file|repo|timeout|source)\b", prior, re.I) and re.search(
        r"\b(go ahead|yes|sure|do it|check)\b", user_text, re.I
    ):
        return "code"
    return "plain"


LIVE_HARD = re.compile(
    r"\b(news|weather|snow\w*|storm|forecast|rain\w*|prices?|stocks?|score|scores|schedule|who won)\b",
    re.I,
)
LIVE_SOFT = re.compile(r"\b(today|tonight|tomorrow|markets?)\b", re.I)
LIVE_ASK = re.compile(
    r"\b(what|what's|whats|how|when|where|who|tell me|give me|summary|happened|check|look up|look that|forecast|expecting|price|worth)\b",
    re.I,
)
# A breath before the filler line. The lookup itself is already running.
ACK_BEAT_S = 0.7


def wants_live(user_text: str) -> bool:
    if re.search(
        r"\b(look up|look it up|look that up|lift it up|could you check|can you check|search the web|check online|google)\b",
        user_text,
        re.I,
    ):
        return True
    if LIVE_HARD.search(user_text):
        return True
    return bool(LIVE_SOFT.search(user_text) and LIVE_ASK.search(user_text))


def open_paced(opener, ack: dict | None):
    """Run the request immediately. Speak the filler only after a short beat."""
    box: dict = {}

    def run() -> None:
        try:
            box["out"] = opener()
        except Exception as err:
            box["err"] = err

    started = time.perf_counter()
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(ACK_BEAT_S)
    if "err" in box and not thread.is_alive():
        raise box["err"]
    remain = ACK_BEAT_S - (time.perf_counter() - started)
    if remain > 0:
        time.sleep(remain)
    if ack and "err" not in box:
        yield ack
    thread.join()
    if "err" in box:
        raise box["err"]
    yield {"type": "_open", "out": box.get("out")}


def open_qwen_round(messages: list, mode: str, model: str, strategy: str = "agent"):
    if mode == "answer":
        body = qwen_body(messages, None, model)
        body.pop("tools", None)
        return open_qwen(body), "answer"
    if mode in {"code", "plain"}:
        body = qwen_body(messages, None, model)
        if mode == "plain":
            body.pop("tools", None)
        return open_qwen(body), mode
    body = qwen_body(messages, strategy, model)
    body.pop("tools", None)
    try:
        return open_qwen(body), "agent"
    except RuntimeError as err:
        if "Qwen error (400)" not in str(err):
            raise
        # Agent refused. Turbo still searches, and it can sit next to the code tool.
        body = qwen_body(messages, "turbo", model)
        return open_qwen(body), "turbo"


def qwen_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "look_at_code",
            "description": REPO_TOOL["description"],
            "parameters": REPO_TOOL["parameters"],
        },
    }


def search_stall(text: str) -> bool:
    return bool(re.search(
        r"\b(not in (my |the )?(current )?context|do not have access|don't have access|"
        r"can't provide|cannot provide|real-time news|let me look|i'll look|i will look|"
        r"want to make sure i give you accurate)\b",
        text,
        re.I,
    ))


def spoken_answer(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [
        part for part in parts
        if part and not re.search(
            r"\b(look (that |it |this )?up|let me look|let me check|i'll look|i will look|i'll check|one moment|while i look)\b",
            part,
            re.I,
        )
    ]
    return " ".join(kept).strip()


def response_text(event: dict) -> str:
    found = output_delta(event)
    if found:
        return found
    delta = event.get("delta")
    if isinstance(delta, str) and "text" in str(event.get("type") or ""):
        return delta
    return ""


def saw_web_search(event: dict) -> bool:
    if "web_search" in str(event.get("type") or "").lower():
        return True
    item = event.get("item") or event.get("output_item") or {}
    if isinstance(item, dict) and "web_search" in str(item.get("type") or "").lower():
        return True
    return False


def qwen_live_search(messages: list, model: str, ack: dict | None = None):
    body = {
        "model": model,
        "input": messages,
        "tools": [{"type": "web_search"}],
        "tool_choice": "required",
        "temperature": 0.4,
        "max_output_tokens": 420,
        "stream": True,
        "store": False,
        "enable_thinking": False,
    }
    # The request starts now. The filler waits a beat so it does not step on
    # the end of his sentence. The answer is not held for that beat.
    yield {"type": "clock", "mark": "open"}
    resp = None
    try:
        for event in open_paced(lambda: open_qwen(body, QWEN_RESPONSES), ack):
            if event.get("type") == "_open":
                resp = event.get("out")
            else:
                yield event
    except RuntimeError as err:
        print(f"qwen search failed {err}", flush=True)
        yield {"type": "text", "text": "I can't check that live right now."}
        return
    text: list[str] = []
    searched = False
    kinds: set[str] = set()
    try:
        content_type = resp.headers.get("Content-Type", "")
        events = []
        if "text/event-stream" not in content_type:
            payload = json.loads(resp.read().decode("utf-8", "replace") or "{}")
            events = [payload]
            for item in payload.get("output") or []:
                if isinstance(item, dict) and "web_search" in str(item.get("type") or ""):
                    searched = True
                if item.get("type") == "message":
                    for part in item.get("content") or []:
                        if isinstance(part, dict) and part.get("text"):
                            text.append(part["text"])
            if payload.get("output_text"):
                text.append(str(payload["output_text"]))
        else:
            events = iter_sse(resp)
        for event in events:
            kinds.add(str(event.get("type") or "")[:48])
            response = event.get("response") if isinstance(event.get("response"), dict) else {}
            for item in response.get("output") or []:
                if isinstance(item, dict) and "web_search" in str(item.get("type") or ""):
                    if not searched:
                        searched = True
                        yield {"type": "web_search"}
            if not searched and saw_web_search(event):
                searched = True
                yield {"type": "web_search"}
            piece = response_text(event)
            if piece:
                text.append(piece)
    except Exception as err:
        print(f"qwen search stream {err}", flush=True)
    spoken = spoken_answer("".join(text))
    print(
        f"qwen search model={model} looked={int(searched)} chars={len(spoken)} said={spoken[:120]!r} kinds={','.join(sorted(kinds))[:180]}",
        flush=True,
    )
    if not searched or search_stall(spoken) or not spoken:
        yield {"type": "text", "text": "I can't check that live right now."}
        return
    yield {"type": "text", "text": spoken}


CHOICE_NOTE = (
    "Call web_search or look_at_code only when he asked for a live fact, a file, or a check "
    "this brief cannot answer. web_search is for weather, news, prices, and scores. "
    "look_at_code must name a repo and a real query or path. "
    "Do not call because a word appeared, to be helpful, or with an empty target. "
    "A story is not a call. On a call, set spoken_ack to one short true clause. Otherwise call nothing."
)
PLUS_NOTE = (
    "The lookup already ran. He has heard one short line that you are checking. "
    "Answer from the result in a few spoken sentences. If it is empty, say so. "
    "Do not say you are about to look. Do not repeat that short line. "
    "Do not invent a file, a path, or a number that is not in the result."
)


def choice_tools() -> list:
    web = {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Call only when his latest sentence asks for a live fact: weather, news, "
                "a price, or a score. A story that mentions rain, today, or the market is not a call. "
                "If you are unsure, do not call. Offer in your reply instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The live fact he asked for."},
                    "spoken_ack": {
                        "type": "string",
                        "description": "One short clause he will hear while you check.",
                    },
                },
                "required": ["query", "spoken_ack"],
            },
        },
    }
    return [web, qwen_tool()]


def accepted_call(name: str, args: dict) -> bool:
    if name == "web_search":
        return bool(str(args.get("query") or "").strip())
    if name != "look_at_code":
        return False
    repo = str(args.get("repo") or "").strip().lower()
    kind = str(args.get("kind") or "").strip().lower()
    if repo not in {"vocallearn", "atlas"} or kind not in {"map", "read", "search", "recent"}:
        return False
    if kind == "search" and not str(args.get("query") or "").strip():
        return False
    if kind == "read" and not str(args.get("path") or "").strip():
        return False
    return True


def ack_clause(args: dict) -> str:
    line = speakable(str(args.get("spoken_ack") or ""))
    line = line.split(".")[0].strip()
    if len(line) > 140:
        line = line[:140].rsplit(" ", 1)[0]
    if not line:
        return "Okay, I'll check."
    if line[-1] not in ".!?":
        line += "."
    return line


def read_choice(resp) -> tuple[str, list[dict]]:
    text_parts: list[str] = []
    tool_acc: dict[int, dict] = {}
    for event in iter_sse(resp):
        choices = event.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        for call in delta.get("tool_calls") or []:
            idx = int(call.get("index") or 0)
            slot = tool_acc.setdefault(idx, {"name": "", "arguments": ""})
            fn = call.get("function") or {}
            if fn.get("name"):
                slot["name"] += fn["name"]
            if fn.get("arguments"):
                slot["arguments"] += fn["arguments"]
        content = delta.get("content") or ""
        if content:
            text_parts.append(content)
    calls = []
    for idx in sorted(tool_acc):
        slot = tool_acc[idx]
        try:
            args = json.loads(slot["arguments"] or "{}")
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        calls.append({"name": slot["name"], "args": args})
    return spoken_answer("".join(text_parts)), calls


def chat_text(resp) -> str:
    parts: list[str] = []
    for event in iter_sse(resp):
        choices = event.get("choices") or []
        if not choices:
            continue
        content = (choices[0].get("delta") or {}).get("content") or ""
        if content:
            parts.append(content)
    return spoken_answer("".join(parts))


def qwen_choice(user_text: str, content: str, brain: str, practice_slot: str):
    """Flash decides. Plus speaks only after a real tool call."""
    decider = "flash" if brain == "flash" else brain
    model = QWEN_MODELS.get(decider, QWEN_FLASH)
    messages: list = [
        {"role": "system", "content": system_prompt(user_text, decider, practice_slot) + "\n" + CHOICE_NOTE},
        *history[-16:],
        {"role": "user", "content": content},
    ]
    body = qwen_body(messages, None, model)
    body["tools"] = choice_tools()
    body["tool_choice"] = "auto"
    yield {"type": "clock", "mark": "open"}
    try:
        text, calls = read_choice(open_qwen(body))
    except RuntimeError as err:
        print(f"qwen choice failed {err}", flush=True)
        yield {"type": "text", "text": "I lost that. Say it once more."}
        return
    chosen = next((call for call in calls if accepted_call(call["name"], call["args"])), None)
    if chosen is None:
        print(f"qwen {brain} worker={decider} choice=chat", flush=True)
        if text:
            yield {"type": "text", "text": text}
        return
    name = chosen["name"]
    args = chosen["args"]
    clause = ack_clause(args)
    ack = {
        "type": "preface",
        "sentence": clause,
        "detail": "Looking at the code…" if name == "look_at_code" else "Looking that up…",
        "worker": "plus",
    }
    print(f"qwen {brain} worker=plus choice={name} ack={clause!r}", flush=True)
    plus_messages = [
        {"role": "system", "content": system_prompt(user_text, "plus", practice_slot) + "\n" + PLUS_NOTE},
        *history[-16:],
        {"role": "user", "content": content},
    ]
    if name == "web_search":
        plus_messages.append({
            "role": "user",
            "content": f"He asked for this live fact: {str(args.get('query') or '').strip()}",
        })
        yield from qwen_live_search(plus_messages, QWEN_MODEL, ack)
        return
    result = look_at_code(args)
    plus_messages.append({
        "role": "user",
        "content": "Lookup result:\n" + result + "\n\nSummarize that for him in a few spoken sentences.",
    })

    def opener():
        answer = qwen_body(plus_messages, None, QWEN_MODEL)
        answer.pop("tools", None)
        return open_qwen(answer)

    resp = None
    try:
        for event in open_paced(opener, ack):
            if event.get("type") == "_open":
                resp = event.get("out")
            else:
                yield event
    except RuntimeError as err:
        print(f"qwen plus file failed {err}", flush=True)
        yield {"type": "text", "text": "I found the file, but the summary did not come through."}
        return
    summary = chat_text(resp) if resp is not None else ""
    yield {"type": "text", "text": summary or "I found the file, but the summary did not come through."}


def qwen_events(
    user_text: str,
    bridge: dict | None = None,
    brain: str = "plus",
    practice_slot: str = "",
    cut: bool = False,
):
    spoken = user_text
    if bridge:
        user_text = (
            "He cut in while you were answering. The words he never heard are not part of the conversation.\n"
            f"Earlier he said: {bridge.get('user') or ''}\n"
            f"He heard you say: {bridge.get('heard') or 'nothing yet'}\n"
            f"He then said: {user_text}\n"
            "Answer the conversation as it stands. Use the earlier point and these new words when both are still relevant. "
            "If the new words replace that answer, follow them and do not finish the cut-off sentence. "
            "If he wants you to keep going, continue from the last words he heard. "
            "Do not recite his words back."
        )
    mode = plus_mode(user_text, practice_slot)
    # Flash talks. Plus does the lookup. Plain turns stay on whichever brain he picked.
    worker = "plus" if mode in {"code", "search"} and brain == "flash" else brain
    model = QWEN_MODELS.get(worker, QWEN_MODEL)
    if mode == "search":
        note = (
            "Web search is already running for this turn. He has already heard a short line that you are looking. "
            "Answer with the result in a few sentences. Do not say the fact is missing from your context. "
            "Do not say you are about to look it up. Do not repeat that short line."
        )
    elif mode == "code":
        note = (
            "This turn has the file lookup and not web search. He has already heard a short line that you are looking. "
            "If he asks where something is, how it works, or about routing or models, call look_at_code with kind search "
            "and a short query that would appear in the code. For Atlas model routing, search qwen_events in "
            "server/voice-local/app.py. Use kind map only for a folder outline. "
            "Summarize only what came back. Do not repeat an earlier folder list. Do not repeat that short line."
        )
    else:
        note = "This turn is ordinary conversation. No web search and no file lookup."
    content = user_text
    if cut:
        content += " The quiet timer ended this turn. He may have been cut off. Answer what is here and do not invent the rest."
    if practice_slot != "1":
        yield from qwen_choice(user_text, content, brain, practice_slot)
        return
    messages: list = [
        {"role": "system", "content": system_prompt(user_text, worker, practice_slot) + "\n" + note},
        *history[-16:],
        {"role": "user", "content": content},
    ]
    looked = False
    ack = None
    if mode in {"code", "search"}:
        ack = {
            "type": "preface",
            "sentence": preface_line(mode, spoken),
            "detail": "Looking at the code…" if mode == "code" else "Looking that up…",
            "worker": worker,
        }
    if mode == "search":
        # Chat completions accept enable_search and then answer from memory.
        # These models search through the responses web_search tool.
        yield from qwen_live_search(messages, model, ack)
        return
    for _round in range(3):
        yield {"type": "clock", "mark": "open"}
        resp = None
        search_used = mode
        try:
            for event in open_paced(lambda: open_qwen_round(messages, mode, model), ack):
                if event.get("type") == "_open":
                    resp, search_used = event.get("out")
                else:
                    yield event
        finally:
            ack = None
        print(f"qwen {brain} worker={worker} search={search_used}", flush=True)
        text_parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        searched = False
        for event in iter_sse(resp):
            if not searched and (event.get("search_info") or event.get("search_results")):
                searched = True
                yield {"type": "web_search"}
            choices = event.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if not searched and (delta.get("search_info") or delta.get("search_results")):
                searched = True
                yield {"type": "web_search"}
            for call in delta.get("tool_calls") or []:
                idx = int(call.get("index") or 0)
                slot = tool_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if call.get("id"):
                    slot["id"] = call["id"]
                fn = call.get("function") or {}
                if fn.get("name"):
                    slot["name"] += fn["name"]
                if fn.get("arguments"):
                    slot["arguments"] += fn["arguments"]
            content = delta.get("content") or ""
            if content:
                text_parts.append(content)
        if searched:
            print("search_info yes", flush=True)
        if not tool_acc:
            spoken = spoken_answer("".join(text_parts))
            if spoken and not (mode == "search" and search_stall(spoken)):
                yield {"type": "text", "text": spoken}
                return
            if mode == "search" and _round == 0:
                strategy = "turbo"
                messages = [
                    *messages,
                    {"role": "assistant", "content": spoken or "I would need to look that up."},
                    {
                        "role": "user",
                        "content": "The web result is in. Give him only that result. Do not mention your context.",
                    },
                ]
                continue
            if mode == "search":
                yield {"type": "text", "text": "I looked, but nothing usable came back."}
                return
            if mode == "answer":
                break
            return
        looked = True
        yield {"type": "repo"}
        assistant_calls = []
        tool_msgs = []
        for idx in sorted(tool_acc):
            slot = tool_acc[idx]
            name = slot["name"] or ""
            raw_args = slot["arguments"] or "{}"
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {}
            if name != "look_at_code" or not isinstance(args, dict):
                result = "That lookup is not available."
            else:
                args = shape_lookup(args, user_text)
                print(f"tool {name} {args.get('repo', '')} {args.get('kind', '')}", flush=True)
                result = deepen_routing(user_text, args, look_at_code(args))
            cid = slot["id"] or f"call_{idx}"
            assistant_calls.append({
                "id": cid,
                "type": "function",
                "function": {"name": name, "arguments": raw_args},
            })
            tool_msgs.append({"role": "tool", "tool_call_id": cid, "content": result})
        messages = [
            *messages,
            {"role": "assistant", "content": "".join(text_parts) or "Looking.", "tool_calls": assistant_calls},
            *tool_msgs,
            {
                "role": "user",
                "content": "Summarize those excerpts for him in a few spoken sentences. Do not call the tool again.",
            },
        ]
        mode = "answer"
    if not looked:
        return
    yield {"type": "text", "text": "I found the files, but the summary did not come through. Ask me to read one of them."}


def load_turn_model() -> None:
    if not TURN_MODEL.exists():
        turn_state["error"] = "Smart Turn model is missing."
        return
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    turn_state["session"] = ort.InferenceSession(
        str(TURN_MODEL),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    turn_state["error"] = None


def endpoint_complete(wav_path: str) -> tuple[bool, float]:
    """True when the pause sounds like the end of his thought."""
    session = turn_state.get("session")
    if session is None:
        return True, 1.0
    import soundfile as sf

    from turn_mel import compute_whisper_log_mel_features

    audio, rate = sf.read(wav_path, dtype="float32", always_2d=False)
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != 16000 and len(audio):
        target = int(len(audio) * 16000 / rate)
        audio = np.interp(np.linspace(0, len(audio) - 1, target), np.arange(len(audio)), audio).astype(np.float32)
    cap = 16000 * 8
    if len(audio) > cap:
        audio = audio[-cap:]
    if len(audio) < 16000 // 4:
        return False, 0.0
    # The model reads the end of an 8 second window, so pad silence in front.
    if len(audio) < cap:
        audio = np.pad(audio, (cap - len(audio), 0))
    features = np.expand_dims(compute_whisper_log_mel_features(audio, do_normalize=True), axis=0)
    raw = np.asarray(session.run(None, {"input_features": features})[0], dtype=np.float32).reshape(-1)
    probability = float(raw[0])
    # 0.5 called his work breaths finished. This morning 68 of 90 model ends
    # fired under 0.7s of quiet. A clearer score still ends immediately.
    return probability >= 0.85, probability


def warm() -> None:
    try:
        models["detail"] = "Loading turn detection…"
        try:
            load_turn_model()
        except Exception as err:
            turn_state["error"] = str(err)
            print(f"Smart Turn unavailable, pauses use the timer: {err}", flush=True)
        models["detail"] = "Loading Kokoro…"
        from mlx_audio.tts.utils import load_model

        models["tts"] = load_model("mlx-community/Kokoro-82M-bf16")
        models["detail"] = "Loading Parakeet…"
        from parakeet_mlx import from_pretrained

        models["stt"] = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
        models["detail"] = "Warming the voice…"
        models["hold_wav"] = synthesize_impl(HOLD_LINE)
        models["greet_wav"] = synthesize_impl(GREETING)
        silence = silence_wav()
        try:
            transcribe_impl(silence)
        finally:
            os.unlink(silence)
        models["ready"] = True
        models["detail"] = f"Kokoro {VOICE} · Parakeet · Plus · {QWEN_MODEL}"
        print(f"Atlas voice ready on http://127.0.0.1:{PORT}", flush=True)
        print(f"Phone gate file: {GATE_PATH}", flush=True)
    except Exception as err:
        models["error"] = str(err)
        models["detail"] = str(err)
        print(f"Atlas voice failed to load: {err}", flush=True)
        return
    while True:
        fn, done = mlx_jobs.get()
        global mlx_active
        mlx_active = True
        try:
            done.put((True, fn()))
        except Exception as err:
            done.put((False, err))
        finally:
            mlx_active = False


@app.on_event("startup")
def startup() -> None:
    load_env(ATLAS_ENV)
    threading.Thread(target=warm, name="atlas-mlx", daemon=True).start()


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(
        HERE / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/icon-180.png")
def icon_180():
    return FileResponse(HERE / "icon-180.png", media_type="image/png")


@app.get("/icon-512.png")
def icon_512():
    return FileResponse(HERE / "icon-512.png", media_type="image/png")


@app.get("/")
def index():
    return FileResponse(HERE / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/greeting")
def greeting():
    wav = models.get("greet_wav")
    if not wav:
        return JSONResponse({"error": models["detail"]}, status_code=503)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/health")
def health():
    return {
        "ok": models["error"] is None,
        "ready": bool(models["ready"]),
        "detail": models["detail"],
        "brain_default": "plus",
        "model": QWEN_MODEL,
        "model_flash": QWEN_FLASH,
        "model_grok": MODEL,
        "voice": VOICE,
    }


@app.post("/brain")
async def set_brain(request: Request):
    body = await request.json()
    name = normalize_brain(str(body.get("name") or ""))
    if not name:
        return JSONResponse({"error": "Use grok, plus, or flash."}, status_code=400)
    live_brain["name"] = name
    live_brain["from_page"] = True
    try:
        BRAIN_PATH.write_text(name + "\n")
    except OSError:
        pass
    print(f"brain {name}", flush=True)
    return {"ok": True, "brain": name}


@app.post("/practice")
async def set_practice(request: Request):
    body = await request.json()
    slot = normalize_practice(str(body.get("slot") or ""))
    live_practice["slot"] = slot
    live_practice["from_page"] = True
    try:
        PRACTICE_PATH.parent.mkdir(parents=True, exist_ok=True)
        if slot:
            PRACTICE_PATH.write_text(slot + "\n")
        elif PRACTICE_PATH.exists():
            PRACTICE_PATH.unlink()
    except OSError:
        pass
    print(f"practice slot={slot or 'off'}", flush=True)
    return {"ok": True, "slot": slot}


@app.post("/end-mode")
async def set_end_mode(request: Request):
    body = await request.json()
    mode = normalize_end(str(body.get("mode") or ""))
    if not mode:
        return JSONResponse({"error": "Use mac, phone, or manual."}, status_code=400)
    live_end["mode"] = mode
    live_end["from_page"] = True
    try:
        END_PATH.parent.mkdir(parents=True, exist_ok=True)
        END_PATH.write_text(mode + "\n")
    except OSError:
        pass
    print(f"end mode={mode}", flush=True)
    return {"ok": True, "mode": mode}


@app.post("/clear")
def clear():
    history.clear()
    return {"ok": True}


@app.post("/cancel")
async def cancel(request: Request):
    stop_turn(request.headers.get("x-atlas-turn") or "")
    return {"ok": True}


@app.post("/pause")
async def pause_route(request: Request):
    body = await request.json()
    if body.get("peak") is not None:
        log_pause(
            {
                "kind": "bleed",
                "decision": "bleed",
                "peak": round(float(body.get("peak") or 0), 3),
                "loud_ms": int(body.get("loud_ms") or 0),
                "route": str(body.get("route") or ""),
                "p": None,
            }
        )
        return {"ok": True}
    log_pause(
        {
            "kind": "resume",
            "decision": "resume",
            "silence_ms": int(body.get("silence_ms") or 0),
            "speech_ms": int(body.get("speech_ms") or 0),
            "route": str(body.get("route") or ""),
            "p": None,
        }
    )
    return {"ok": True}


@app.post("/command")
async def command_route(request: Request):
    body = await request.json()
    name = str(body.get("name") or "")
    if name in {"mute", "unmute"}:
        set_held(name)
        log_barge({"kind": "button", "name": name})
    return {"ok": True}


@app.post("/cut")
async def cut(request: Request):
    body = await request.json()
    heard = str(body.get("heard") or "")
    note_cut(heard)
    log_barge(
        {
            "kind": "interrupt",
            "route": str(body.get("route") or ""),
            "played_ms": int(body.get("played_ms") or 0),
            "fraction": body.get("fraction") or 0,
            "sentence": str(body.get("sentence") or ""),
            "heard": heard,
            "queued": int(body.get("queued") or 0),
            "reply_ms": int(body.get("reply_ms") or 0),
            "after_force": bool(body.get("after_force")),
        }
    )
    return {"ok": True}


@app.post("/hear")
async def hear(request: Request):
    """Live caption only — does not start a turn or touch history."""
    if not models["ready"]:
        return JSONResponse({"error": models["detail"]}, status_code=503)
    with turn_lock:
        if active_turn.get("id"):
            return JSONResponse({"text": "", "busy": True})
    form = await request.form()
    upload = form.get("audio")
    if upload is None:
        return JSONResponse({"error": "Send audio."}, status_code=400)
    raw = await upload.read()
    if len(raw) < 1200:
        return JSONResponse({"text": ""})
    name = getattr(upload, "filename", "") or "hear.wav"
    suffix = Path(name).suffix or ".wav"
    try:
        wav_path = await asyncio.to_thread(to_wav_file, raw, suffix)
    except Exception as err:
        print(f"hear skipped: {err}", flush=True)
        return JSONResponse({"text": ""})
    try:
        if mlx_active or not mlx_jobs.empty():
            return JSONResponse({"text": "", "busy": True})
        text = await asyncio.to_thread(lambda: on_mlx(lambda: transcribe_impl(wav_path)))
        return JSONResponse({"text": text})
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


@app.post("/turn")
async def turn(request: Request):
    if not models["ready"]:
        return JSONResponse({"error": models["detail"]}, status_code=503)
    content_type = request.headers.get("content-type", "")
    user_text = ""
    wav_path = ""
    probe = False
    caption = ""
    pause = {"silence_ms": 0, "speech_ms": 0, "route": "", "decision": "", "p": None, "cap_ms": PAUSE_CAP_MS}
    turn_id = request.headers.get("x-atlas-turn") or ""
    started = time.perf_counter()
    # Phone ears/mouth. Requests without this header keep the Mac pipeline.
    mouth = request.headers.get("x-atlas-mouth") == "phone"
    practice_slot = chosen_practice(request)
    brain = chosen_brain(request)
    if practice_slot == "1":
        brain = "plus"
    phone_stt = 0
    cut = False
    if "application/json" in content_type:
        payload = await request.json()
        user_text = speakable(str(payload.get("text") or ""))
        commit = str(payload.get("commit") or "") == "1" or request.headers.get("x-atlas-commit") == "1"
        cut = str(payload.get("cut") or "") == "1"
        if chosen_end(request) == "manual" and not commit:
            print("turn held for manual end", flush=True)
            return JSONResponse({"complete": False, "hold": True})
        if mouth:
            try:
                phone_stt = int(payload.get("stt_ms") or 0)
            except (TypeError, ValueError):
                phone_stt = 0
            try:
                pause["silence_ms"] = int(payload.get("silence_ms") or 0)
            except (TypeError, ValueError):
                pause["silence_ms"] = 0
            try:
                pause["speech_ms"] = int(payload.get("speech_ms") or 0)
            except (TypeError, ValueError):
                pause["speech_ms"] = 0
            pause["route"] = str(payload.get("route") or "")
            decision = str(payload.get("pause") or "")
            if decision:
                pause["decision"] = decision
            if payload.get("pause_p") is not None:
                try:
                    pause["p"] = round(float(payload.get("pause_p")), 3)
                except (TypeError, ValueError):
                    pass
    else:
        form = await request.form()
        probe = str(form.get("probe") or "") == "1"
        caption = str(form.get("caption") or "")
        def form_int(key: str) -> int:
            try:
                return int(float(form.get(key) or 0))
            except (TypeError, ValueError):
                return 0
        pause["silence_ms"] = form_int("silence_ms")
        pause["speech_ms"] = form_int("speech_ms")
        pause["route"] = str(form.get("route") or "")
        pause["decision"] = "force" if str(form.get("force") or "") == "1" else ""
        commit = str(form.get("commit") or "") == "1" or request.headers.get("x-atlas-commit") == "1"
        if chosen_end(request) == "manual" and not commit:
            upload = form.get("audio")
            if upload is not None:
                try:
                    await upload.read()
                except Exception:
                    pass
            print("turn held for manual end", flush=True)
            return JSONResponse({"complete": False, "hold": True})
        upload = form.get("audio")
        if upload is None:
            return JSONResponse({"error": "Send audio or text."}, status_code=400)
        raw = await upload.read()
        name = getattr(upload, "filename", "") or "turn.wav"
        suffix = Path(name).suffix or ".wav"
        try:
            wav_path = await asyncio.to_thread(to_wav_file, raw, suffix)
        except Exception as err:
            print(f"turn audio skipped: {err}", flush=True)
            if probe:
                return JSONResponse({"complete": False, "probability": 0})
            return JSONResponse({"error": "I couldn't read that audio."}, status_code=400)
        if probe:
            model_down = turn_state.get("session") is None or bool(turn_state.get("error"))
            probability = 0.0
            complete = False
            if not model_down:
                try:
                    complete, probability = await asyncio.to_thread(endpoint_complete, wav_path)
                except Exception as err:
                    print(f"endpoint failed, timer will end the turn: {err}", flush=True)
                    model_down = True
                    complete, probability = False, 0.0
            pause["p"] = round(probability, 3)
            if complete and pause["silence_ms"] < MIN_COMMIT_MS:
                complete = False
            if model_down and pause["silence_ms"] >= QUIET_COMMIT_MS:
                complete = True
                pause["decision"] = "timer"
            elif not complete and pause["silence_ms"] >= PAUSE_CAP_MS:
                complete = True
                pause["decision"] = "cap"
            if not complete:
                pause["decision"] = "hold"
                log_pause({"kind": "hold", **pause})
                print(
                    f"probe hold p={probability:.2f} silence={pause['silence_ms']}ms",
                    flush=True,
                )
                if os.path.exists(wav_path):
                    os.unlink(wav_path)
                return JSONResponse({
                    "complete": False,
                    "probability": round(probability, 3),
                    "decision": "hold",
                })
            if not pause["decision"]:
                pause["decision"] = "model"
            if mouth:
                if wav_path and os.path.exists(wav_path):
                    os.unlink(wav_path)
                print(
                    f"probe send p={probability:.2f} silence={pause['silence_ms']}ms decision={pause['decision']}",
                    flush=True,
                )
                return JSONResponse({
                    "complete": True,
                    "probability": round(probability, 3),
                    "decision": pause["decision"],
                })
        elif wav_path:
            try:
                _, probability = await asyncio.to_thread(endpoint_complete, wav_path)
                pause["p"] = round(probability, 3)
            except Exception as err:
                print(f"pause score skipped: {err}", flush=True)
            if not pause["decision"]:
                pause["decision"] = "send"

    if not claim_turn(turn_id):
        print(f"turn dropped before hearing id={turn_id}", flush=True)
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)
        return JSONResponse({"dropped": True})

    def generate():
        nonlocal user_text
        timing = {"stt_ms": phone_stt if mouth else 0, "first_token_ms": 0, "first_audio_ms": None}
        if mouth and phone_stt:
            timing["asr_ms"] = phone_stt
        spoken_hold = False
        try:
            if wav_path:
                yield sse("status", {"stage": "hearing", "detail": "Hearing you…"})
                heard_at = time.perf_counter()
                user_text = on_mlx(lambda: transcribe_impl(wav_path))
                timing["stt_ms"] = int((time.perf_counter() - started) * 1000)
                timing["asr_ms"] = int((time.perf_counter() - heard_at) * 1000)
            cmd = command_word(user_text)
            if cmd:
                set_held(cmd)
                log_barge({"kind": "command", "name": cmd})
                print(f"command {cmd}", flush=True)
                yield sse("command", {"name": cmd})
                yield sse("done", {"text": "", "timing": timing})
                return
            if mic_held:
                print("command hold", flush=True)
                yield sse("command", {"name": "hold"})
                yield sse("done", {"text": "", "timing": timing})
                return
            if wav_path:
                yield sse("transcript", {"text": user_text})
            if turn_stopped(turn_id):
                print(f"turn dropped after hearing id={turn_id}", flush=True)
                return
            if not user_text:
                yield sse("error", {"message": "I didn't catch that."})
                yield sse("done", {"text": "", "timing": timing})
                return

            if pause.get("decision"):
                log_pause({"kind": "send", "heard": " ".join(user_text.split())[:400], **pause})
            bridge = take_bridge()
            begin_flight(user_text)
            yield sse("status", {"stage": "thinking", "detail": "Thinking…"})
            answer = ""
            pending = ""
            announced = False
            looked = False

            def speak_piece(piece: str):
                nonlocal announced
                if turn_stopped(turn_id):
                    return
                cleaned = speakable(piece)
                if not cleaned:
                    return
                yield sse("delta", {"text": cleaned + " "})
                if mouth:
                    if not announced:
                        announced = True
                    yield sse("say", {"sentence": cleaned})
                    return
                for audio in stream_synth(cleaned):
                    if turn_stopped(turn_id):
                        return
                    if not announced:
                        if timing["first_audio_ms"] is None:
                            timing["first_audio_ms"] = int((time.perf_counter() - started) * 1000)
                        announced = True
                    yield sse(
                        "audio",
                        {"sentence": cleaned, "wav_b64": base64.b64encode(audio).decode()},
                    )

            def absorb(delta: str):
                nonlocal answer, pending
                if turn_stopped(turn_id) or not delta:
                    return
                if not timing["first_token_ms"]:
                    timing["first_token_ms"] = int((time.perf_counter() - started) * 1000)
                answer += delta
                pending += delta
                safe, pending = peel_spoken(pending)
                pieces, rest = take_pieces(safe, first=not announced)
                pending = rest + pending
                for piece in pieces:
                    yield from speak_piece(piece)

            def begin_search(detail: str = "Looking that up…", sentence: str = ""):
                nonlocal spoken_hold, pending, answer, announced
                spoken_hold = True
                line = sentence or HOLD_LINE
                pending = ""
                answer = ""
                if "hold_ms" not in timing:
                    timing["hold_ms"] = int((time.perf_counter() - started) * 1000)
                if announced:
                    announced = False
                    timing["first_audio_ms"] = None
                    yield sse("restart", {})
                yield sse("status", {"stage": "searching", "detail": detail})
                if mouth:
                    yield sse("say", {"sentence": line})
                elif line == HOLD_LINE and models["hold_wav"]:
                    timing["first_audio_ms"] = int((time.perf_counter() - started) * 1000)
                    yield sse(
                        "audio",
                        {
                            "sentence": line,
                            "wav_b64": base64.b64encode(models["hold_wav"]).decode(),
                        },
                    )
                else:
                    for audio in stream_synth(line):
                        if turn_stopped(turn_id):
                            return
                        if timing["first_audio_ms"] is None:
                            timing["first_audio_ms"] = int((time.perf_counter() - started) * 1000)
                        yield sse(
                            "audio",
                            {
                                "sentence": line,
                                "wav_b64": base64.b64encode(audio).decode(),
                            },
                        )

            worker_name = brain
            if brain == "grok":
                source = grok_events(user_text, bridge, practice_slot)
            else:
                source = qwen_events(user_text, bridge, brain, practice_slot, cut)
            for event in source:
                if turn_stopped(turn_id):
                    break
                if event.get("type") == "preface":
                    worker_name = str(event.get("worker") or worker_name)
                    if not spoken_hold:
                        yield from begin_search(
                            str(event.get("detail") or "Looking that up…"),
                            str(event.get("sentence") or ""),
                        )
                    continue
                if event.get("type") == "clock" and event.get("mark") == "open" and "ours_ms" not in timing:
                    timing["ours_ms"] = int((time.perf_counter() - started) * 1000)
                    continue
                if event.get("type") == "text":
                    yield from absorb(event.get("text") or "")
                    continue
                if event.get("type") == "repo":
                    looked = True
                    if not spoken_hold:
                        yield from begin_search("Looking at the code…")
                    continue
                if is_search(event):
                    if not spoken_hold:
                        yield from begin_search()
                    continue
                yield from absorb(output_delta(event))

            if not turn_stopped(turn_id):
                pieces, _rest = take_pieces(speakable(pending), final=True, first=not announced)
                for piece in pieces:
                    yield from speak_piece(piece)

            final = speakable(answer)
            stored = finish_flight(final, turn_stopped(turn_id))
            timing["worker"] = worker_name
            yield sse("done", {"text": stored, "timing": timing})
            heard = " ".join(user_text.split())
            said = " ".join(stored.split())
            clip_s = 0.0
            if wav_path and os.path.exists(wav_path):
                clip_s = max(0, os.path.getsize(wav_path) - 44) / 32000
            if "ours_ms" in timing and "theirs_ms" not in timing:
                timing["theirs_ms"] = max(0, timing.get("first_token_ms", 0) - timing["ours_ms"])
            record_turn(heard, said, timing, spoken_hold, caption, pause, brain=brain)
            print(
                "turn"
                f" brain={brain}"
                f" worker={worker_name}"
                f" search={int(spoken_hold)}"
                f" repo={int(looked)}"
                f"{' mouth=phone' if mouth else ''}"
                f" quiet={pause.get('silence_ms', 0)}ms"
                f" ours={timing.get('ours_ms', 0)}ms"
                f" hold={timing.get('hold_ms', 0)}ms"
                f" theirs={timing.get('theirs_ms', 0)}ms"
                f" stt={timing['stt_ms']}ms"
                f" asr={timing.get('asr_ms', 0)}ms"
                f" clip={clip_s:.1f}s"
                f" token={timing['first_token_ms']}ms"
                f" audio={(timing['first_audio_ms'] or 0)}ms"
                f" heard={heard[:240]!r}"
                f" said={said[:240]!r}",
                flush=True,
            )
        except Exception as err:
            record_turn(user_text, f"ERROR {err}", timing, spoken_hold, brain=brain)
            yield sse("error", {"message": str(err)})
        finally:
            if wav_path and os.path.exists(wav_path):
                os.unlink(wav_path)

    return StreamingResponse(generate(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
