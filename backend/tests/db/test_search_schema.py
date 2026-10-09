import pytest

from app.search.seed import seed_card
from tests.fixtures import CARDS

pytestmark = pytest.mark.db

TSV = "(select tsv from public.reel_content where shortcode = 'MANALI1')"


async def test_refresh_puts_title_in_weight_a_and_transcript_in_d(db, make_user):
    uid = await make_user()
    await seed_card(db, uid, CARDS["MANALI1"], None)
    assert await db.fetchval(f"select ts_filter({TSV}, '{{a}}') @@ to_tsquery('english','hampta')")
    assert not await db.fetchval(
        f"select ts_filter({TSV}, '{{a}}') @@ to_tsquery('english','jobra')")
    assert await db.fetchval(f"select ts_filter({TSV}, '{{d}}') @@ to_tsquery('english','jobra')")


async def test_refresh_indexes_entity_parents(db, make_user):
    await seed_card(db, await make_user(), CARDS["MANALI1"], None)
    assert await db.fetchval(f"select {TSV} @@ to_tsquery('english','himachal')")


async def test_match_text_has_title_tags_entities(db, make_user):
    await seed_card(db, await make_user(), CARDS["MANALI1"], None)
    mt = await db.fetchval("select match_text from public.reel_content where shortcode='MANALI1'")
    assert "Hampta Pass" in mt and "trek" in mt and "Himachal Pradesh" in mt


async def test_note_tsv_follows_note_updates(db, make_user):
    rid = await seed_card(db, await make_user(), CARDS["MANALI1"], None)
    q = "select ts_filter(note_tsv, '{a}') @@ to_tsquery('english','college') from public.reels where id=$1"
    assert await db.fetchval(q, rid)
    await db.execute("update public.reels set note = null where id = $1", rid)
    assert await db.fetchval("select note_tsv = ''::tsvector from public.reels where id=$1", rid)


async def test_refresh_is_not_callable_by_clients(db):
    assert not await db.fetchval(
        "select has_function_privilege('authenticated', "
        "'public.refresh_search_columns(text)', 'execute')")


async def test_thumbnails_bucket_is_public(db):
    assert await db.fetchval("select public from storage.buckets where id='thumbnails'") is True
