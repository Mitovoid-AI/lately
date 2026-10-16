"""GET /thumbnails/{shortcode}.jpg — thumbnails kept in Postgres (migration 0011).

Public, like the Storage bucket it stands in for: a thumbnail is the reel's
public cover image, shared by every save of that reel.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from ..deps import pool
from ..models import api_error
from ..services import thumbnails

router = APIRouter(prefix="/thumbnails", tags=["thumbnails"])


@router.get("/{shortcode}.jpg")
async def get_thumbnail(shortcode: str) -> Response:
    found = await thumbnails.get(pool(), shortcode)
    if found is None:
        raise api_error(404, "NOT_FOUND", "No thumbnail for this reel.")
    data, kind = found
    return Response(content=data, media_type=kind,
                    headers={"Cache-Control": "public, max-age=86400"})
