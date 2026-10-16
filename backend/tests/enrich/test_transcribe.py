"""TRANSCRIBE: the skip rule and the Groq Whisper client (fake Groq)."""

import httpx
import pytest

from app.enrich.fetch import FetchResult
from app.enrich.transcribe import GroqTranscriber, TranscribeError, should_transcribe

MEDIA = FetchResult(source="ytdlp", audio_url="https://scontent.cdninstagram.com/a.m4a", duration_s=40)


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
    f = FetchResult(source="embed_page", video_url="https://scontent.cdninstagram.com/v.mp4")
    assert should_transcribe(f, None, has_key=True)[0] is True


def groq(handler, max_bytes=25_000_000):
    return GroqTranscriber(httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                           api_key="gsk_test", base_url="https://api.groq.com/openai/v1",
                           model="whisper-large-v3-turbo", max_bytes=max_bytes)


def url_mode(request) -> bool:
    return b'name="url"' in request.content


async def test_groq_fetches_the_media_url_itself():
    # No video passes through the worker: 8 concurrent 5 MB uploads from a home
    # connection timed out and starved every other stage (live run 2026-10-17).
    posted = []

    def handler(request):
        assert request.url.host != "scontent.cdninstagram.com", "must not download"
        posted.append(request)
        return httpx.Response(200, json={"text": " Aaj hum momos banayenge. ", "duration": 40.2})

    t = await groq(handler).transcribe("https://scontent.cdninstagram.com/a.m4a")
    assert t.text == "Aaj hum momos banayenge." and t.duration_s == 40.2
    (req,) = posted
    assert str(req.url) == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert req.headers["authorization"] == "Bearer gsk_test"
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert url_mode(req) and b"https://scontent.cdninstagram.com/a.m4a" in req.content
    assert b"whisper-large-v3-turbo" in req.content


async def test_url_refused_falls_back_to_download_and_upload():
    posted = []

    def handler(request):
        if request.url.host == "scontent.cdninstagram.com":
            return httpx.Response(200, content=b"AUDIO")
        posted.append(request)
        if url_mode(request):
            return httpx.Response(400, json={"error": {"message": "failed to retrieve media"}})
        return httpx.Response(200, json={"text": "hello", "duration": 3.0})

    t = await groq(handler).transcribe("https://scontent.cdninstagram.com/a.m4a")
    assert t.text == "hello"
    assert [url_mode(r) for r in posted] == [True, False]
    assert b"AUDIO" in posted[1].content and b'filename="a.m4a"' in posted[1].content


async def test_upload_fallback_audio_too_large_raises():
    def handler(request):
        if request.url.host == "scontent.cdninstagram.com":
            return httpx.Response(200, content=b"x" * 50)
        return httpx.Response(400, json={"error": {"message": "failed to retrieve media"}})

    with pytest.raises(TranscribeError, match="too large"):
        await groq(handler, max_bytes=10).transcribe("https://scontent.cdninstagram.com/a.m4a")


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_auth_rate_limit_and_server_errors_do_not_fall_back(status):
    def handler(request):
        assert request.url.host != "scontent.cdninstagram.com", "must not download"
        return httpx.Response(status, json={"error": {"message": "nope"}})

    with pytest.raises(TranscribeError, match=str(status)):
        await groq(handler).transcribe("https://scontent.cdninstagram.com/a.m4a")


async def test_timeout_error_names_the_exception():
    def handler(request):
        raise httpx.ReadTimeout("", request=request)

    with pytest.raises(TranscribeError, match="ReadTimeout"):
        await groq(handler).transcribe("https://scontent.cdninstagram.com/a.m4a")


async def test_non_cdn_media_url_is_refused_without_a_request():
    def handler(request):
        raise AssertionError(f"unexpected {request.url}")

    with pytest.raises(TranscribeError, match="not an Instagram CDN"):
        await groq(handler).transcribe("https://evil.example/a.m4a")
