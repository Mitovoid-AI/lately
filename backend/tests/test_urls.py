"""URL helper tests — ports of the Instagram parsing contract."""

import pytest

from app.urls import (
    extract_instagram_url,
    is_saveable_link,
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


# ------------------------------------------- which links are saves (GitHub #3)

def test_links_without_a_scheme_get_https():
    assert normalize_shared_text("instagram.com/reel/Cabc123/") == "https://instagram.com/reel/Cabc123/"
    assert normalize_shared_text("look www.instagram.com/p/Cpost1/?igsh=x") ==         "https://www.instagram.com/p/Cpost1/"
    assert normalize_shared_text("http://www.instagram.com/reel/Cabc123/") ==         "https://www.instagram.com/reel/Cabc123/"


@pytest.mark.parametrize("text", [
    "https://notinstagram.com/reel/Cabc123/",
    "notinstagram.com/reel/Cabc123/",
    "https://instagram.com.evil.example/reel/Cabc123/",
    "https://evil.example/instagram.com/reel/Cabc123/",
    "me@instagram.com/reel/Cabc123",
])
def test_look_alike_hosts_are_not_instagram(text):
    assert normalize_shared_text(text) is None
    assert parse_shortcode(text) is None


def test_username_permalink_has_a_shortcode():
    url = "https://www.instagram.com/delhi.foodtrails/reel/Cabc123/?igsh=x"
    assert is_saveable_link(url) and parse_shortcode(url) == "Cabc123"
    assert parse_shortcode("https://www.instagram.com/some_user/p/Cpost123/") == "Cpost123"


@pytest.mark.parametrize("url", [
    "https://www.instagram.com/reels/audio/123456/",   # audio page
    "https://www.instagram.com/delhi.foodtrails/",      # profile
    "https://www.instagram.com/stories/delhi.foodtrails/3456789/",
    "https://www.instagram.com/explore/tags/momos/",
    "https://www.instagram.com/reel/",
    "https://www.instagram.com",
])
def test_other_instagram_pages_are_not_saves(url):
    assert extract_instagram_url(url) is not None
    assert not is_saveable_link(url)
    assert parse_shortcode(url) is None


def test_share_links_are_saves_without_a_shortcode():
    for url in ("https://www.instagram.com/share/AbCd12", "instagram.com/share/reel/BAabc12/"):
        assert is_saveable_link(url) and is_share_link(url)
        assert parse_shortcode(url) is None  # not "BAabc12": share codes are not shortcodes


def test_first_reel_link_wins_over_a_profile_link():
    text = "follow instagram.com/delhi.foodtrails for more: instagram.com/reel/Cabc123/"
    assert normalize_shared_text(text) == "https://instagram.com/reel/Cabc123/"
    assert normalize_shared_text("instagram.com/delhi.foodtrails") ==         "https://instagram.com/delhi.foodtrails"  # a link, but not a save
