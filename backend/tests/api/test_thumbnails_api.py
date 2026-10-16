"""GET /thumbnails/{shortcode}.jpg serves thumbnails kept in Postgres, and save
responses point at it with the host the app called."""

import pytest

from app.config import settings
from app.services import thumbnails

pytestmark = pytest.mark.db

JPEG = b"\xff\xd8\xff\xe0" + b"1" * 64


async def test_round_trip_and_upsert(db):
    assert await thumbnails.put(db, "SC1", JPEG) == "db:SC1"
    assert await thumbnails.get(db, "SC1") == (JPEG, "image/jpeg")
    png = b"\x89PNG\r\n\x1a\n" + b"2" * 16
    await thumbnails.put(db, "SC1", png)
    assert await thumbnails.get(db, "SC1") == (png, "image/png")
    assert await thumbnails.get(db, "NOPE") is None


async def test_put_refuses_bad_shortcodes_and_non_images(db):
    with pytest.raises(ValueError):
        await thumbnails.put(db, "../etc", JPEG)
    with pytest.raises(ValueError):
        await thumbnails.put(db, "SC1", b"<html>")


async def test_route_serves_the_image(client, db):
    await thumbnails.put(db, "SC1", JPEG)
    r = await client.get("/thumbnails/SC1.jpg")
    assert r.status_code == 200
    assert r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert "max-age" in r.headers["cache-control"]


@pytest.mark.parametrize("path", ["/thumbnails/MISSING.jpg", "/thumbnails/bad%20code.jpg"])
async def test_route_404s(client, db, path):
    r = await client.get(path)
    assert r.status_code == 404


async def test_saves_point_at_the_route_on_the_called_host(client, db, make_user, jwt_for,
                                                           monkeypatch):
    monkeypatch.setattr(settings(), "public_base_url", "")
    uid = await make_user()
    await db.execute("select * from public.save_reel($1, $2, 'app_share', $2)", uid,
                     "https://www.instagram.com/reel/SC1/")
    await db.execute(
        """insert into public.reel_content (shortcode, source_url, thumbnail_path, media_status)
           values ('SC1', 'https://www.instagram.com/reel/SC1/', 'db:SC1', 'ready')""")
    r = await client.get("/saves", headers={"Authorization": f"Bearer {jwt_for(uid)}"})
    assert r.status_code == 200
    (item,) = r.json()
    assert item["thumbnail_url"] == "http://test/thumbnails/SC1.jpg"
