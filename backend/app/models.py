"""Pydantic request/response models for the Part 1 API surface."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SaveRequest(BaseModel):
    """Door 1 (Android share sheet) sends the raw shared text."""

    text: str = Field(min_length=1, max_length=4096)
    channel: str = Field(default="app_share", pattern="^(app_share|web|meta_dm)$")


class SaveResponse(BaseModel):
    reel_id: UUID
    deduped: bool
    status: str = "pending"


class ReelOut(BaseModel):
    id: UUID
    auth_user_id: UUID | None = None
    source_url: str
    shortcode: str | None = None
    shortcode_key: str | None = None
    status: str
    note: str | None = None
    created_at: datetime


class NoteRequest(BaseModel):
    """The follow-up "why?" note (PIPELINE.md §3 step 6). Skippable."""

    note: str = Field(min_length=1, max_length=500)


class ErrorResponse(BaseModel):
    error: dict[str, str]
