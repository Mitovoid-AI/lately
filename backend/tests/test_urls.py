"""URL helper tests — ports of the Instagram parsing contract."""

from app.urls import (
    extract_instagram_url,
    is_share_link,
    normalize_shared_text,
    parse_shortcode,
    strip_tracking_params,
)


def test_extracts_url_from_shared_text():
    text = "check this out https://www.instagram.com/reel/Cabc123/ lol"
    assert extract_instagram_url(text) == "https://www.instagram.com/reel/Cabc123/"


def test_extract_returns_none_without_link():
    assert extract_instagram_url("no link here") is None


def test_shortcode_reel_and_reels_and_p_and_tv():
    assert parse_shortcode("https://instagram.com/reel/Cabc123/") == "Cabc123"
    assert parse_shortcode("https://www.instagram.com/reels/Dxyz_-9/") == "Dxyz_-9"
    assert parse_shortcode("https://instagram.com/p/Cpost123/") == "Cpost123"
    assert parse_shortcode("https://instagram.com/tv/Ctv12345/") == "Ctv12345"


def test_share_link_has_no_shortcode():
    assert parse_shortcode("https://instagram.com/share/AbCd12") is None
    assert is_share_link("https://instagram.com/share/AbCd12")


def test_non_instagram_returns_none():
    assert parse_shortcode("https://youtube.com/watch?v=x") is None


def test_strip_tracking_params():
    url = (
        "https://instagram.com/reel/Cabc123/"
        "?igsh=MzRlODBiNWFlZA==&utm_source=ig_web&next=y"
    )
    assert strip_tracking_params(url) == "https://instagram.com/reel/Cabc123/?next=y"


def test_normalize_shared_text_canonicalizes():
    text = "saving this https://www.instagram.com/reel/Cabc123/?igsh=xyz later"
    assert normalize_shared_text(text) == "https://www.instagram.com/reel/Cabc123/"


def test_normalize_returns_none_without_ig_link():
    assert normalize_shared_text("https://tiktok.com/@u/video/1") is None
