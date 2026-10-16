"""thumbnail_path → the URL the app loads (saves_view.thumbnail_url)."""

import pytest

from app.config import settings
from app.services import thumbnails
from app.services.saves_view import thumbnail_url


@pytest.fixture
def no_public_base(monkeypatch):
    monkeypatch.setattr(settings(), "public_base_url", "")


def test_remote_and_storage_paths_are_unchanged(no_public_base):
    assert thumbnail_url(None) is None
    assert thumbnail_url("") is None
    assert thumbnail_url("https://cdn.example/x.jpg") == "https://cdn.example/x.jpg"
    assert thumbnail_url("SC1.jpg").endswith("/storage/v1/object/public/thumbnails/SC1.jpg")


def test_local_path_uses_the_host_the_request_came_in_on(no_public_base):
    token = thumbnails.request_base_url.set("http://192.168.1.5:8001")
    try:
        assert thumbnail_url("db:SC1") == "http://192.168.1.5:8001/thumbnails/SC1.jpg"
    finally:
        thumbnails.request_base_url.reset(token)


def test_local_path_outside_a_request_is_api_relative(no_public_base):
    assert thumbnail_url("db:SC1") == "/thumbnails/SC1.jpg"


def test_public_base_url_setting_wins(monkeypatch):
    monkeypatch.setattr(settings(), "public_base_url", "https://api.lately.app/")
    token = thumbnails.request_base_url.set("http://10.0.0.2:8001")
    try:
        assert thumbnail_url("db:SC1") == "https://api.lately.app/thumbnails/SC1.jpg"
    finally:
        thumbnails.request_base_url.reset(token)


@pytest.mark.parametrize("data,kind", [
    (b"\xff\xd8\xff\xe0rest", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\nrest", "image/png"),
    (b"GIF89arest", "image/gif"),
    (b"RIFF\x00\x00\x00\x00WEBPrest", "image/webp"),
])
def test_content_type_is_sniffed(data, kind):
    assert thumbnails.content_type_of(data) == kind
