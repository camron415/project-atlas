"""Localhost Atlas voice loop.

Ears: Parakeet on this Mac. Brain: Grok 4.3. Mouth: Kokoro, first sentence first.
Open http://127.0.0.1:8791
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
import queue
import secrets
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

HERE = Path(__file__).resolve().parent
ATLAS_ENV = HERE.parent / ".env"
NOW_PATH = Path(
    "/Users/camront/Library/Mobile Documents/com~apple~CloudDocs/Documents/Macbook-Documents/vocalLearn/docs/NOW.md"
)
PORT = int(os.environ.get("ATLAS_VOICE_PORT", "8791"))
GATE_PATH = Path.home() / "Library/Application Support/Atlas/voice-gate"
OPEN_PATHS = {"/health", "/manifest.webmanifest", "/icon-180.png", "/icon-512.png"}
MODEL = "grok-4.3"
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
mlx_jobs: queue.Queue = queue.Queue()
history: list[dict[str, str]] = []
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


HARD = re.compile(r"\b(think (it |this )?through|reason (about|through)|in detail|step by step)\b", re.I)
CALL_LOG = Path.home() / "Library/Application Support/Atlas/calls.jsonl"
TURN_MODEL = Path.home() / "Library/Application Support/Atlas/models/smart-turn-v3.2-cpu.onnx"
turn_state: dict[str, object] = {"session": None, "feat": None, "error": None}
active_turn = {"id": ""}
stopped_turns: set[str] = set()
turn_lock = threading.Lock()


def system_prompt(user_text: str) -> str:
    # Day only, so the standing prompt can stay cached across a conversation.
    today = time.strftime("%A, %B %-d, %Y", time.localtime())
    prompt = f"""You are Atlas, talking with Camron out loud.
Friendly and natural. Do not call him sir.
You can hear him. Today is {today} in Denver.
Match your length to the question. A small question gets one or two sentences. A decision, a plan, or an explanation can run four to six sentences, then one short question if you need something from him. Do not monologue.
You can search the web. Use it for facts, numbers, news, weather, prices, and anything you are not sure about. If he asks you to look something up, look it up. Say only the final answer.
Say it the way you would on a phone call. No markdown, no lists, no links, no brackets, no citation numbers, no URLs, and no source names.
Do not say you are unable to look things up.
You do not see his latest commits. These notes are the background, not a live reading of the repo.

Background:
Camron is building Halo, a learning app, in the vocalLearn repo. The live work is the learning loop: ask about something, harvest the facts onto Keep, and review them. GitHub issues will later carry one role, a priority from P0 to P3, and an autonomy of ask, plan, or go. Low-autonomy work waits for his yes or no.
This call is Atlas, the voice in front of that. Ears and mouth run on his Mac. Judgment is Grok 4.3 through the xAI API, not a local model. The phone reaches the Mac over Tailscale. The phone is for talking and, later, for a yes or no when an agent is stuck. Orchestration of Cursor agents comes after the learning loop is worth opening. He lives in Denver.
"""
    if re.search(r"\b(work on|halo|ticket|vocallearn|harvest|atlas|repo|agent)\b", user_text, re.I):
        prompt += "\nHe asked about the current work. Use these notes if they answer it:\n" + snapshot()[:900]
    return prompt


def stop_turn(turn_id: str) -> None:
    with turn_lock:
        if turn_id:
            stopped_turns.add(turn_id)
            if len(stopped_turns) > 40:
                stopped_turns.clear()
                stopped_turns.add(turn_id)
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


def record_turn(heard: str, said: str, timing: dict, searched: bool) -> None:
    CALL_LOG.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "search": searched,
        "stt_ms": timing.get("stt_ms", 0),
        "first_token_ms": timing.get("first_token_ms", 0),
        "first_audio_ms": timing.get("first_audio_ms", 0),
        "heard": heard,
        "said": said,
    }
    with CALL_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


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


def grok_events(user_text: str):
    load_env(ATLAS_ENV)
    key = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
    if not key:
        raise RuntimeError("XAI_API_KEY is missing from the Atlas server env.")
    base = os.environ.get("XAI_API_URL") or os.environ.get("GROK_API_URL") or "https://api.x.ai/v1"
    messages = [
        {"role": "system", "content": system_prompt(user_text)},
        *history[-16:],
        {"role": "user", "content": user_text},
    ]
    body = {
        "model": MODEL,
        "input": messages,
        "temperature": 0.4,
        "max_output_tokens": 420,
        "reasoning": {"effort": "low" if HARD.search(user_text) else "none"},
        # Voice turns skip the default queue. Billed at 2x only when the reply says priority.
        "service_tier": "priority",
        "store": False,
        "stream": True,
        "tools": [{"type": "web_search"}],
        "max_tool_calls": 3,
    }
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
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Grok error ({err.code}): {detail}") from err
    content_type = resp.headers.get("Content-Type", "")
    if "text/event-stream" not in content_type:
        payload = json.loads(resp.read().decode())
        text = payload.get("output_text") or ""
        if not text:
            for item in payload.get("output") or []:
                if item.get("type") != "message":
                    continue
                for part in item.get("content") or []:
                    if part.get("type") in {"output_text", "text"}:
                        text += part.get("text") or ""
        yield {"type": "text", "text": text}
        return
    for event in iter_sse(resp):
        yield event


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
    return probability > 0.5, probability


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
        models["detail"] = f"Kokoro {VOICE} · Parakeet · {MODEL}"
        print(f"Atlas voice ready on http://127.0.0.1:{PORT}", flush=True)
        print(f"Phone gate file: {GATE_PATH}", flush=True)
    except Exception as err:
        models["error"] = str(err)
        models["detail"] = str(err)
        print(f"Atlas voice failed to load: {err}", flush=True)
        return
    while True:
        fn, done = mlx_jobs.get()
        try:
            done.put((True, fn()))
        except Exception as err:
            done.put((False, err))


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
        "model": MODEL,
        "voice": VOICE,
    }


@app.post("/clear")
def clear():
    history.clear()
    return {"ok": True}


@app.post("/cancel")
async def cancel(request: Request):
    stop_turn(request.headers.get("x-atlas-turn") or "")
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
    turn_id = request.headers.get("x-atlas-turn") or ""
    started = time.perf_counter()
    if "application/json" in content_type:
        payload = await request.json()
        user_text = speakable(str(payload.get("text") or ""))
    else:
        form = await request.form()
        probe = str(form.get("probe") or "") == "1"
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
            try:
                complete, probability = await asyncio.to_thread(endpoint_complete, wav_path)
            except Exception as err:
                print(f"endpoint failed, sending the turn: {err}", flush=True)
                complete, probability = True, 1.0
            if not complete:
                if os.path.exists(wav_path):
                    os.unlink(wav_path)
                return JSONResponse({"complete": False, "probability": round(probability, 3)})

    def generate():
        nonlocal user_text
        timing = {"stt_ms": 0, "first_token_ms": 0, "first_audio_ms": 0}
        spoken_hold = False
        try:
            if not claim_turn(turn_id):
                return
            if wav_path:
                yield sse("status", {"stage": "hearing", "detail": "Hearing you…"})
                user_text = on_mlx(lambda: transcribe_impl(wav_path))
                timing["stt_ms"] = int((time.perf_counter() - started) * 1000)
                yield sse("transcript", {"text": user_text})
            if turn_stopped(turn_id):
                return
            if not user_text:
                yield sse("error", {"message": "I didn't catch that."})
                yield sse("done", {"text": "", "timing": timing})
                return

            yield sse("status", {"stage": "thinking", "detail": "Thinking…"})
            answer = ""
            pending = ""
            announced = False

            def speak_piece(piece: str):
                nonlocal announced
                if turn_stopped(turn_id):
                    return
                cleaned = speakable(piece)
                if not cleaned:
                    return
                yield sse("delta", {"text": cleaned + " "})
                for audio in stream_synth(cleaned):
                    if turn_stopped(turn_id):
                        return
                    if not announced:
                        if not timing["first_audio_ms"]:
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

            def begin_search():
                nonlocal spoken_hold, pending, answer, announced
                spoken_hold = True
                pending = ""
                answer = ""
                if announced:
                    announced = False
                    timing["first_audio_ms"] = 0
                    yield sse("restart", {})
                yield sse("status", {"stage": "searching", "detail": "Looking that up…"})
                if models["hold_wav"]:
                    timing["first_audio_ms"] = int((time.perf_counter() - started) * 1000)
                    yield sse(
                        "audio",
                        {
                            "sentence": HOLD_LINE,
                            "wav_b64": base64.b64encode(models["hold_wav"]).decode(),
                        },
                    )

            for event in grok_events(user_text):
                if turn_stopped(turn_id):
                    break
                if event.get("type") == "text":
                    yield from absorb(event.get("text") or "")
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
            if final:
                with state_lock:
                    history.append({"role": "user", "content": user_text})
                    history.append({"role": "assistant", "content": final})
                    del history[:-20]
            yield sse("done", {"text": final, "timing": timing})
            heard = " ".join(user_text.split())
            said = " ".join(final.split())
            record_turn(heard, said, timing, spoken_hold)
            print(
                "turn"
                f" search={int(spoken_hold)}"
                f" stt={timing['stt_ms']}ms"
                f" token={timing['first_token_ms']}ms"
                f" audio={timing['first_audio_ms']}ms"
                f" heard={heard[:240]!r}"
                f" said={said[:240]!r}",
                flush=True,
            )
        except Exception as err:
            record_turn(user_text, f"ERROR {err}", timing, spoken_hold)
            yield sse("error", {"message": str(err)})
        finally:
            if wav_path and os.path.exists(wav_path):
                os.unlink(wav_path)

    return StreamingResponse(generate(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
