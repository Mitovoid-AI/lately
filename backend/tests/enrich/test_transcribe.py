"""TRANSCRIBE: the skip rule and the Groq Whisper client (fake Groq)."""

import httpx
import pytest

from app.enrich.fetch import FetchResult
from app.enrich.transcribe import GroqTranscriber, TranscribeError, should_transcribe

MEDIA = FetchResult(source="ytdlp", audio_url="https://cdn.example/a.m4a", duration_s=40)


def test_should_transcribe_when_all_conditions_hold():
    assert should_transcribe(MEDIA, "short caption", has_key=True) == (True, "ok")


@pytest.mark.parametrize(("fetch", "caption", "key", "reason"), [
    (MEDIA, "x", False, "no_key"),
    (FetchResult(source="embed_page"), "x", True, "no_audio"),
    (FetchResult(source="ytdlp", audio_url="u", duration_s=181), "x", True, "too_long"),
    (MEDIA, " ".join(["word"] * 45), True, "caption_strong"),
    (FetchResult(source=None), None, True, "no_audio"),
])
def test_should_transcribe_skips(fetch, caption, key, reason):
    assert should_transcribe(fetch, caption, has_key=key) == (False, reason)


def test_unknown_duration_is_allowed():
    f = FetchResult(source="embed_page", video_url="https://cdn.example/v.mp4")
    assert should_transcribe(f, None, has_key=True)[0] is True


def groq(handler, max_bytes=25_000_000):
    return GroqTranscriber(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                           api_key="gsk_test", base_url="https://api.groq.com/openai/v1",
                           model="whisper-large-v3-turbo", max_bytes=max_bytes)


async def test_transcribe_downloads_audio_and_posts_multipart():
    posted = []

    def handler(request):
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"AUDIO")
        posted.append(request)
        return httpx.Response(200, json={"text": " Aaj hum momos banayenge. ", "duration": 40.2})

    t = await groq(handler).transcribe("https://cdn.example/a.m4a")
    assert t.text == "Aaj hum momos banayenge." and t.duration_s == 40.2
    (req,) = posted
    assert str(req.url) == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert req.headers["authorization"] == "Bearer gsk_test"
    body = req.content
    assert b"whisper-large-v3-turbo" in body and b"AUDIO" in body and b'filename="a.m4a"' in body


async def test_transcribe_audio_too_large_raises_skip():
    def handler(request):
        return httpx.Response(200, content=b"x" * 50)

    with pytest.raises(TranscribeError, match="too large"):
        await groq(handler, max_bytes=10).transcribe("https://cdn.example/a.m4a")


async def test_transcribe_groq_error_raises():
    def handler(request):
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"A")
        return httpx.Response(429, json={"error": {"message": "rate limit"}})

    with pytest.raises(TranscribeError, match="429"):
        await groq(handler).transcribe("https://cdn.example/a.m4a")
