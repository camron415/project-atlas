"""One Cursor agent at a time, started from the phone call.

Flash only writes the gist. This file owns the rules, the required reads,
and when she is allowed to mention the result.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path

VOCAL = Path(
    "/Users/camront/Library/Mobile Documents/com~apple~CloudDocs/Documents/Macbook-Documents/vocalLearn"
)
READ_FIRST = (
    "docs/CONSTITUTION.md",
    "docs/NOW.md",
    "web/DECISIONS.md",
    "roles/harness.md",
    "atlas-personal-context/voice-notes/CURRENT-2026-11-18.md",
    "inbox/2026-11-18-kept-harness-tonight.md",
)

_lock = threading.Lock()
_job = {
    "phase": "idle",  # confirming, running, ready, conflict
    "gist": "",
    "heard": "",
    "report": "",
    "spoken": "",
    "mentioned": False,
    "override": False,
}


def _clean(text: str) -> str:
    cleaned = re.sub(r"[^a-z\s]", "", (text or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def affirms(text: str) -> bool:
    cleaned = _clean(text)
    words = cleaned.split()
    if not words or len(words) > 12:
        return False
    if cleaned in {
        "yes", "yeah", "yep", "yup", "sure", "do it", "go ahead", "go for it",
        "send it", "confirm", "yes please", "yeah do it", "yes send it",
        "that's right", "thats right", "correct", "ok", "okay",
    }:
        return True
    return words[0] in {"yes", "yeah", "yep", "yup", "sure", "ok", "okay"}


def denies(text: str) -> bool:
    cleaned = _clean(text)
    words = cleaned.split()
    if not words or len(words) > 12:
        return False
    if cleaned in {"no", "nope", "dont", "don't", "cancel", "never mind", "nevermind", "stop"}:
        return True
    return words[0] in {"no", "nope", "dont", "cancel", "stop"}


def wants_report(text: str) -> bool:
    return bool(
        re.search(
            r"\b(rundown|report|what happened|what did it|what did the agent|what did cursor)\b",
            (text or "").lower(),
        )
    )


def phase() -> str:
    with _lock:
        return str(_job["phase"])


def context_note() -> str:
    with _lock:
        phase_name = _job["phase"]
        gist = _job["gist"]
        spoken = _job["spoken"]
    if phase_name == "confirming":
        return (
            f"A cursor job is waiting for a clear yes or no. The job is: {gist}. "
            "Do not start another one. If this sentence is not a yes or a no, answer him "
            "and remind him that job is still waiting."
        )
    if phase_name == "running":
        return "A cursor agent is still working. Do not say it finished. If he asks, say it is still running."
    if phase_name == "conflict":
        return (
            "The cursor agent refused the job because it fights the roadmap. "
            "If he clearly says yes, call confirm_cursor. Otherwise do not start it."
        )
    if phase_name == "ready" and spoken:
        return (
            "If he asks what the cursor agent did, say only this, in your own voice, and do not add files or numbers: "
            + spoken
        )
    return ""


def propose(gist: str, heard: str) -> str:
    gist = re.sub(r"\s+", " ", (gist or "").strip())
    if not gist:
        return "I need the job in one sentence before I can send it."
    with _lock:
        if _job["phase"] == "running":
            return "A cursor job is already running. I'll tell you when it finishes."
        _job.update({
            "phase": "confirming",
            "gist": gist,
            "heard": (heard or "").strip(),
            "report": "",
            "spoken": "",
            "mentioned": False,
            "override": False,
        })
    return f"I'll send this to the cursor agent: {gist} Say yes and I'll start it."


def cancel() -> str:
    with _lock:
        if _job["phase"] not in {"confirming", "conflict"}:
            return ""
        _job["phase"] = "idle"
        _job["gist"] = ""
    return "Okay. I won't send that."


def before_reply(user_text: str) -> str | None:
    """Handle a bare yes or no before the model talks. None means let her answer."""
    with _lock:
        phase_name = _job["phase"]
    if phase_name == "confirming":
        if affirms(user_text):
            return _launch(override=False)
        if denies(user_text):
            return cancel() or "Okay. I won't send that."
        return None
    if phase_name == "conflict":
        if affirms(user_text):
            return _launch(override=True)
        if denies(user_text):
            return cancel() or "Okay. Leaving it."
        return None
    if phase_name == "ready" and (wants_report(user_text) or affirms(user_text)):
        with _lock:
            if not _job["mentioned"] and affirms(user_text) and not wants_report(user_text):
                return None
            spoken = _job["spoken"] or _job["report"]
            _job["mentioned"] = True
        if not spoken:
            return "The cursor agent finished, but the rundown did not come through."
        return spoken
    return None


def take_nudge() -> str:
    """One sentence at the end of the next reply. Empty after it has been said."""
    with _lock:
        if _job["mentioned"]:
            return ""
        if _job["phase"] == "ready":
            _job["mentioned"] = True
            return "The cursor agent finished that job. Want the rundown?"
        if _job["phase"] == "conflict":
            _job["mentioned"] = True
            return "The cursor agent stopped. That job fights the roadmap. Say yes if you want it anyway."
        return ""


def _launch(override: bool) -> str:
    with _lock:
        if _job["phase"] == "running":
            return "A cursor job is already running. I'll tell you when it finishes."
        gist = _job["gist"]
        heard = _job["heard"]
        if not gist:
            _job["phase"] = "idle"
            return "I don't have a job to send."
        if not os.environ.get("CURSOR_API_KEY", "").strip():
            _job["phase"] = "idle"
            return "I can't start the cursor agent yet. The API key is not on the Mac."
        _job["phase"] = "running"
        _job["override"] = override
        _job["mentioned"] = False
        _job["report"] = ""
        _job["spoken"] = ""
    threading.Thread(
        target=_run,
        args=(gist, heard, override),
        name="atlas-cursor",
        daemon=True,
    ).start()
    print(f"cursor launch override={int(override)} gist={gist[:160]!r}", flush=True)
    if override:
        return "Okay. Sending it anyway, even though it fights the roadmap. We can keep talking."
    return "Okay. It's running. We can keep talking."


def _fail(message: str) -> None:
    print(f"cursor failed {message}", flush=True)
    with _lock:
        _job["phase"] = "ready"
        _job["mentioned"] = False
        _job["spoken"] = message
        _job["report"] = message


def _prompt(gist: str, heard: str, override: bool) -> str:
    files = "\n".join(f"- {VOCAL / name}" for name in READ_FIRST)
    override_line = (
        "He confirmed an override. Do the job even if it conflicts with the roadmap. "
        "Still do not promote, deploy, or commit unless his job text says commit."
        if override
        else
        "If this job disagrees with the constitution, NOW, DECISIONS, or the current status note, "
        "do not edit anything. Your whole reply must start with CONFLICT: and then two plain sentences "
        "saying what he asked and what the files say."
    )
    return f"""You are the coding agent for Camron's Halo repo. You are not the phone voice. Do not role-play Atlas.

Read these files before you edit, in this order:
{files}

His latest words on the phone:
{heard or gist}

The job, curated from that:
{gist}

Rules:
- Obey the constitution, NOW, and DECISIONS. Do not break a locked line.
- Do not promote, deploy:early, or run vercel --prod.
- Do not commit unless his job text says commit.
- {override_line}
- If you do the job, finish with exactly this shape and nothing after it:
SPOKEN:
Two or three sentences he can hear on the phone. Plain English. No paths, no markdown, no lists.
"""


def _split_spoken(text: str) -> tuple[str, str]:
    match = re.search(r"SPOKEN:\s*(.*)\Z", text, re.S)
    if not match:
        compact = re.sub(r"\s+", " ", text).strip()
        return text, compact[:500]
    spoken = re.sub(r"\s+", " ", match.group(1)).strip()
    return text, spoken[:500] or "The cursor agent finished, but it did not leave a spoken rundown."


def _run(gist: str, heard: str, override: bool) -> None:
    try:
        from cursor_sdk import Agent, AgentOptions, CursorAgentError, LocalAgentOptions
    except ImportError:
        _fail("The cursor SDK is not installed on the Mac yet.")
        return
    key = os.environ.get("CURSOR_API_KEY", "").strip()
    model = os.environ.get("ATLAS_CURSOR_MODEL", "grok-4.7").strip() or "grok-4.7"
    try:
        result = Agent.prompt(
            _prompt(gist, heard, override),
            AgentOptions(
                api_key=key,
                model=model,
                local=LocalAgentOptions(cwd=str(VOCAL)),
            ),
        )
    except CursorAgentError as err:
        _fail(f"The cursor agent did not start. {err.message}")
        return
    except Exception as err:
        _fail(f"The cursor agent did not start. {err}")
        return
    text = str(getattr(result, "result", "") or "")
    status = str(getattr(result, "status", "") or "")
    if status != "finished":
        _fail(text or f"The cursor agent ended with {status or 'an error'}.")
        return
    if text.lstrip().upper().startswith("CONFLICT:"):
        spoken = re.sub(r"\s+", " ", text).strip()[:500]
        with _lock:
            _job["phase"] = "conflict"
            _job["report"] = text
            _job["spoken"] = spoken
            _job["mentioned"] = False
        print("cursor conflict", flush=True)
        return
    full, spoken = _split_spoken(text)
    with _lock:
        _job["phase"] = "ready"
        _job["report"] = full
        _job["spoken"] = spoken
        _job["mentioned"] = False
    print(f"cursor ready chars={len(full)}", flush=True)
