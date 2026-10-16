"""ThumbnailStore without a service-role key: the verified image goes to the
local (Postgres) store instead of Storage, so cards keep their image after
Instagram's signed CDN URL expires."""

import httpx
import pytest

from app.enrich.fetch import ThumbnailStore

CDN = "https://scontent.cdninstagram.com/t.jpg"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32


def client_for(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def cdn_serves(body: bytes, status: int = 200):
    def handler(request):
        if request.url.host == "scontent.cdninstagram.com":
            return httpx.Response(status, content=body)
        raise AssertionError(f"unexpected {request.url}")
    return handler


class Local:
    def __init__(self, result="db"):
        self.saved: dict[str, bytes] = {}
        self.result = result

    async def __call__(self, shortcode: str, data: bytes) -> str | None:
        self.saved[shortcode] = data
        return f"db:{shortcode}" if self.result == "db" else None


async def test_no_key_keeps_the_image_in_the_local_store():
    local = Local()
    store = ThumbnailStore(client_for(cdn_serves(JPEG)), "https://p.supabase.co", "", local=local)
    assert await store.store("SC1", CDN) == "db:SC1"
    assert local.saved == {"SC1": JPEG}


async def test_no_key_never_keeps_something_that_is_not_an_image():
    local = Local()
    store = ThumbnailStore(client_for(cdn_serves(b"<html>login</html>")), "https://p", "",
                           local=local)
    assert await store.store("SC1", CDN) is None
    assert local.saved == {}


async def test_no_key_download_failure_keeps_the_remote_url():
    local = Local()
    store = ThumbnailStore(client_for(cdn_serves(b"", status=500)), "https://p", "", local=local)
    assert await store.store("SC1", CDN) == CDN
    assert local.saved == {}


async def test_local_store_failure_keeps_the_remote_url():
    store = ThumbnailStore(client_for(cdn_serves(JPEG)), "https://p", "", local=Local(result=None))
    assert await store.store("SC1", CDN) == CDN


async def test_no_key_refuses_non_cdn_urls_without_a_request():
    store = ThumbnailStore(client_for(lambda r: pytest.fail("no request")), "https://p", "",
                           local=Local())
    assert await store.store("SC1", "https://evil.example/t.jpg") is None


async def test_verified_device_thumbnail_goes_to_the_local_store_too():
    local = Local()
    store = ThumbnailStore(client_for(cdn_serves(JPEG)), "https://p", "", local=local)
    assert await store.store_verified("SC1", CDN) == "db:SC1"
    assert local.saved == {"SC1": JPEG}


async def test_with_a_key_storage_wins_and_the_local_store_is_unused():
    local = Local()

    def handler(request):
        if request.url.host == "scontent.cdninstagram.com":
            return httpx.Response(200, content=JPEG)
        return httpx.Response(200, json={"Key": "thumbnails/SC1.jpg"})

    store = ThumbnailStore(client_for(handler), "https://proj.supabase.co", "service-key",
                           local=local)
    assert await store.store("SC1", CDN) == "SC1.jpg"
    assert local.saved == {}
