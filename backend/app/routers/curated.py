"""Curated router — GET /curated (contract CuratedFeed), built from the user's own saves.

Deterministic and cheap: one indexed query for the user's newest saves, then
plain Python grouping. No LLM, no embeddings.

Hero: the biggest cluster among enriched saves from the last 30 days (all time
when there are none). A tag shared by 2+ saves wins over a category, because
a tag is the sharper theme; ties go to the cluster saved most recently, then
alphabetically. Its `query` is the tag or the category name, which /search
matches (both are indexed in reel_content.tsv). With no enriched saves at all
the hero is just the newest saves, with an empty query; with no saves the
feed is empty.

Sections (empty ones are left out, at most 10 saves each): "Recently saved",
"No note yet", one "Revisit · <category>" row per category (biggest first),
"Forgotten gems" (saved over a month ago).
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter

from ..deps import CurrentUser, pool
from ..models import CuratedFeed, CuratedHero, CuratedSection
from ..services.saves_view import SAVE_COLUMNS, SAVE_FROM, SaveOut, to_save

router = APIRouter(prefix="/curated", tags=["curated"])

_WINDOW = 300  # newest saves considered; plenty for a feed, cheap to read
_SECTION_MAX = 10
_HERO_MAX = 20
_DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def date_label(now: datetime) -> str:
    """'Saturday, 10 Oct' — the app's curatedDate() format (server date, UTC)."""
    return f"{_DAYS[now.weekday()]}, {now.day} {_MONTHS[now.month - 1]}"


def _pick_cluster(items: Sequence[tuple[SaveOut, list[str]]]
                  ) -> tuple[str, str, list[SaveOut]] | None:
    """(kind, key, saves) of the biggest tag (2+) or category cluster."""
    def best(groups: dict[str, list[SaveOut]], min_size: int) -> tuple[str, list[SaveOut]] | None:
        ranked = sorted(
            ((k, v) for k, v in groups.items() if len(v) >= min_size),
            # saves are newest first, so v[0] is the cluster's newest save
            key=lambda kv: (-len(kv[1]), -kv[1][0].created_at.timestamp(), kv[0]))
        return ranked[0] if ranked else None

    by_tag: dict[str, list[SaveOut]] = {}
    by_cat: dict[str, list[SaveOut]] = {}
    for save, tags in items:
        for tag in dict.fromkeys(t.strip().lower() for t in tags if t and t.strip()):
            by_tag.setdefault(tag, []).append(save)
        if save.category:
            by_cat.setdefault(save.category, []).append(save)
    if tag_hit := best(by_tag, 2):
        return "tag", tag_hit[0], tag_hit[1]
    if cat_hit := best(by_cat, 1):
        return "category", cat_hit[0], cat_hit[1]
    return None


def _hero(saves: list[SaveOut], tags: dict[uuid.UUID, list[str]], now: datetime) -> CuratedHero:
    if not saves:
        return CuratedHero(label="START HERE", title="Your saves will show up here",
                           subtitle="Share a reel to Lately from Instagram to begin",
                           image_url=None, save_ids=[], query="")
    enriched = [s for s in saves if s.status == "enriched"]
    month = [s for s in enriched if s.created_at >= now - timedelta(days=30)]
    candidates = month or enriched
    cluster = _pick_cluster([(s, tags.get(s.id, [])) for s in candidates])
    if cluster is None:
        recent = saves[:_HERO_MAX]
        return CuratedHero(
            label="JUST SAVED", title=f"{len(recent)} new {'save' if len(recent) == 1 else 'saves'}",
            subtitle="Cards fill in as each reel is read",
            image_url=next((s.thumbnail_url for s in recent if s.thumbnail_url), None),
            save_ids=[s.id for s in recent], query="")
    kind, key, members = cluster
    members = members[:_HERO_MAX]
    n = len(members)
    span = "saved over the last month" if month else "from your saves"
    if kind == "tag":
        cats = Counter(s.category for s in members if s.category)
        lead = cats.most_common(1)[0][0] if cats else None
        title = f"{n} saves about {key}"
        subtitle = f"{lead} · {span}" if lead else span.capitalize()
    else:
        title = f"{n} {key} {'save' if n == 1 else 'saves'} to revisit"
        subtitle = f"{key} · {span}"
    fresh = members[0].created_at >= now - timedelta(days=7)
    return CuratedHero(
        label="THIS WEEK" if fresh else "REVISIT", title=title, subtitle=subtitle,
        image_url=next((s.thumbnail_url for s in members if s.thumbnail_url), None),
        save_ids=[s.id for s in members], query=key)


def _sections(saves: list[SaveOut], now: datetime) -> list[CuratedSection]:
    out: list[CuratedSection] = []

    def add(kind: Literal["row", "list"], title: str, subtitle: str | None,
            items: list[SaveOut]) -> None:
        if items:
            out.append(CuratedSection(kind=kind, title=title, subtitle=subtitle,
                                      saves=items[:_SECTION_MAX]))

    add("row", "Recently saved", None, saves)
    add("list", "No note yet", "Add a why so search can find them",
        [s for s in saves if s.note is None and s.status != "pending"])
    cats = Counter(s.category for s in saves if s.category)
    for cat, _ in sorted(cats.items(), key=lambda kv: (-kv[1], kv[0])):
        add("row", f"Revisit · {cat}", None, [s for s in saves if s.category == cat])
    add("list", "Forgotten gems", "Saved over a month ago",
        [s for s in saves if s.created_at < now - timedelta(days=30)])
    return out


@router.get("", response_model=CuratedFeed)
async def get_curated(user: CurrentUser) -> CuratedFeed:
    rows = await pool().fetch(
        f"""select {SAVE_COLUMNS} {SAVE_FROM}
            where r.auth_user_id = $1
            order by r.created_at desc, r.id
            limit {_WINDOW}""",
        uuid.UUID(user.id))
    saves = [to_save(r) for r in rows]
    tags: dict[uuid.UUID, list[str]] = {r["id"]: list(r["tags"] or []) for r in rows}
    now = datetime.now(UTC)
    return CuratedFeed(date_label=date_label(now), hero=_hero(saves, tags, now),
                       sections=_sections(saves, now))
