"""Local speech and translation server. Binds to localhost via the launch scripts."""
import io
import os
import re
import threading
import wave
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Lingua Live Local")
model_lock = threading.Lock()
speech_model = None
translation_models = {}
load_error = None


class TranslationInput(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    lang: Literal["vi", "en"]
    terms: list[str] = Field(default_factory=list, max_length=100)


def load_models():
    global speech_model, load_error
    if speech_model is not None and len(translation_models) == 2:
        return
    with model_lock:
        try:
            from faster_whisper import WhisperModel
            from transformers import MarianMTModel, MarianTokenizer
            import torch

            torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
            if speech_model is None:
                speech_model = WhisperModel(
                    os.getenv("WHISPER_MODEL", "small"),
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=max(1, min(4, os.cpu_count() or 1)),
                )
            for lang, repo in {
                "vi": "Helsinki-NLP/opus-mt-vi-en",
                "en": "Helsinki-NLP/opus-mt-en-vi",
            }.items():
                if lang not in translation_models:
                    tokenizer = MarianTokenizer.from_pretrained(repo)
                    model = MarianMTModel.from_pretrained(repo)
                    model.eval()
                    translation_models[lang] = (tokenizer, model)
            load_error = None
        except Exception as exc:
            load_error = type(exc).__name__ + ": " + str(exc)
            raise


@app.get("/api/health")
def health():
    return {
        "ready": speech_model is not None and len(translation_models) == 2,
        "speechReady": speech_model is not None,
        "translationDirections": sorted(translation_models),
        "model": os.getenv("WHISPER_MODEL", "small"),
        "error": load_error,
    }


@app.post("/api/prepare")
async def prepare(request: Request):
    require_local_origin(request)
    try:
        await run_in_threadpool(load_models)
    except Exception as exc:
        raise HTTPException(503, "Không tải được mô hình. Xem cửa sổ khởi động để kiểm tra kết nối và dung lượng.") from exc
    return health()


def require_local_origin(request):
    # The frontend is served on the same origin. Other websites may not invoke inference.
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Chỉ chấp nhận yêu cầu từ website trên máy này.")


def translate_piece(text, lang):
    import torch

    if not text.strip():
        return text
    tokenizer, model = translation_models[lang]
    ids = tokenizer.encode(text.strip(), add_special_tokens=False)
    output = []
    # Long text is split by tokens to avoid silently truncating a user's sentence.
    for offset in range(0, len(ids), 350):
        part = tokenizer.decode(ids[offset:offset + 350], skip_special_tokens=True)
        encoded = tokenizer(part, return_tensors="pt", truncation=False)
        with torch.inference_mode():
            result = model.generate(**encoded, max_new_tokens=500, num_beams=3)
        output.append(tokenizer.decode(result[0], skip_special_tokens=True))
    leading = re.match(r"^\s*", text).group(0)
    trailing = re.search(r"\s*$", text).group(0)
    return leading + " ".join(output) + trailing


def translate_local(payload):
    if payload.lang not in translation_models:
        raise HTTPException(503, "Bấm Chuẩn bị mô hình trước khi dịch.")
    terms = sorted({term.strip() for term in payload.terms if term.strip()}, key=len, reverse=True)
    # Translate spans between exact proper names to guarantee the names are retained.
    pattern = None
    if terms:
        pattern = re.compile(
            r"(?<!\w)(" + "|".join(re.escape(term) for term in terms) + r")(?!\w)",
            re.IGNORECASE,
        )
    with model_lock:
        if pattern is None:
            return translate_piece(payload.text, payload.lang)
        output = []
        position = 0
        canonical = {term.casefold(): term for term in terms}
        for match in pattern.finditer(payload.text):
            output.append(translate_piece(payload.text[position:match.start()], payload.lang))
            if output[-1] and not output[-1].endswith(" "):
                output.append(" ")
            output.append(canonical[match.group(0).casefold()])
            position = match.end()
        tail = payload.text[position:]
        if tail and output and not tail[0].isspace() and tail[0] not in ".,!?;:":
            output.append(" ")
        output.append(translate_piece(tail, payload.lang))
        return "".join(output).strip()


@app.post("/api/translate")
async def translate(payload: TranslationInput, request: Request):
    require_local_origin(request)
    result = await run_in_threadpool(translate_local, payload)
    return {"text": result}


def transcribe_wav(data, lang, terms):
    import numpy as np

    if speech_model is None:
        raise HTTPException(503, "Bấm Chuẩn bị mô hình trước khi ghi âm.")
    try:
        with wave.open(io.BytesIO(data)) as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                raise ValueError("Expected mono PCM16 at 16 kHz")
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
    except (wave.Error, ValueError, EOFError) as exc:
        raise HTTPException(400, "Âm thanh phải là WAV mono 16 kHz PCM16.") from exc
    if not 0 < len(samples) <= 16000 * 20:
        raise HTTPException(400, "Mỗi đoạn âm thanh cần dài tối đa 20 giây.")
    if float(np.sqrt(np.mean(samples ** 2))) < 0.003:
        return ""
    prompt = ", ".join(terms)[:1000] or None
    with model_lock:
        segments, _ = speech_model.transcribe(
            samples, language=lang, initial_prompt=prompt,
            beam_size=3, vad_filter=True, condition_on_previous_text=False,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


@app.post("/api/transcribe")
async def transcribe(request: Request, lang: Literal["vi", "en"] = "vi"):
    require_local_origin(request)
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > 700000:
            raise HTTPException(413, "Đoạn âm thanh quá lớn.")
    try:
        import json
        from urllib.parse import unquote
        terms = json.loads(unquote(request.headers.get("x-glossary", "[]")))
        if not isinstance(terms, list) or len(terms) > 100 or any(not isinstance(term, str) or len(term) > 100 for term in terms):
            raise ValueError()
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "Từ điển không hợp lệ.") from exc
    text = await run_in_threadpool(transcribe_wav, bytes(data), lang, terms)
    return {"text": text}


app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
