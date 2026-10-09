import pytest

from app.search.seed import seed_card
from app.services.saves_view import fetch_save_detail, fetch_saves, thumbnail_url
from tests.fixtures import CARDS

pytestmark = pytest.mark.db


async def test_fetch_saves_keeps_order_and_drops_foreign_ids(db, make_user):
    a, b = await make_user(), await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    g = await seed_card(db, a, CARDS["GOA1"], None)
    other = await seed_card(db, b, CARDS["PASTA1"], None)
    saves = await fetch_saves(db, a, [g, other, m])
    assert [s.id for s in saves] == [g, m]
    assert saves[1].title.startswith("Hampta Pass") and saves[1].channel == "app_share"
    assert saves[1].thumbnail_url.endswith("/storage/v1/object/public/thumbnails/MANALI1.jpg")


async def test_fetch_save_detail_is_scoped(db, make_user):
    a, b = await make_user(), await make_user()
    m = await seed_card(db, a, CARDS["MANALI1"], None)
    d = await fetch_save_detail(db, a, m)
    assert d is not None and d.tags == ["trek", "himalaya", "itinerary"] and d.media_status == "ready"
    assert await fetch_save_detail(db, b, m) is None


def test_thumbnail_url_passes_absolute_urls_through():
    assert thumbnail_url(None) is None
    assert thumbnail_url("https://cdn.example/x.jpg") == "https://cdn.example/x.jpg"
