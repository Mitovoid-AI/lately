"""Pydantic request/response models for the API surface (frontend/src/api/contract.ts)."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from .services.saves_view import SaveOut
from .services.text import clean_text


def api_error(status: int, code: str, message: str) -> HTTPException:
    """An HTTPException carrying the spec's error body (codes: contract ApiErrorCode)."""
    return HTTPException(status, {"error": {"code": code, "message": message}})


class SaveRequest(BaseModel):
    """Door 1 (Android share sheet) sends the raw shared text."""

    text: str = Field(min_length=1, max_length=4096)
    channel: str = Field(default="app_share", pattern="^(app_share|web|meta_dm)$")

    @field_validator("text")
    @classmethod
    def _clean(cls, v: str) -> str:
        return clean_text(v)


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
    """The follow-up "why?" note (PIPELINE.md §3 step 6). Skippable; blank clears it."""

    note: str = Field(max_length=500)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str) -> str:
        return clean_text(v).strip()


class ConnectedAccount(BaseModel):
    """A sign-in method linked to the account (Supabase Auth identity)."""

    provider: str
    label: str
    status: str


class MeOut(BaseModel):
    """GET /me — the app's `Me` contract (frontend/src/api/contract.ts)."""

    id: UUID
    email: str
    name: str
    handle: str
    avatar_url: str | None = None
    plan: str
    saves_this_month: int
    saves_limit: int
    resets_on: date
    total_saves: int
    stacks_count: int
    member_since: date
    connected_accounts: list[ConnectedAccount]


ReadingFont = Literal["newsreader", "inter", "lora"]
TextSize = Literal[14, 16, 18, 20]
Theme = Literal["light", "dark", "system"]


class PreferencesOut(BaseModel):
    """Contract `Preferences`; defaults = DEFAULT_PREFERENCES."""

    reading_font: ReadingFont = "newsreader"
    text_size: TextSize = 16
    theme: Theme = "light"
    push_digests: bool = True
    offline_reading: bool = True


class PreferencesPatch(BaseModel):
    """PATCH /me/preferences — any subset; values must be exactly the contract's."""

    model_config = ConfigDict(strict=True, extra="forbid")

    reading_font: ReadingFont | None = None
    text_size: TextSize | None = None
    theme: Theme | None = None
    push_digests: StrictBool | None = None
    offline_reading: StrictBool | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls(cls, data: Any) -> Any:
        if isinstance(data, dict) and any(v is None for v in data.values()):
            raise ValueError("preference values cannot be null")
        return data


class StackCreate(BaseModel):
    name: str = Field(max_length=80)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = clean_text(v).strip()
        if not v:
            raise ValueError("name is required")
        return v


class StackAdd(BaseModel):
    save_id: UUID


class StackOut(BaseModel):
    """Contract `Stack`."""

    id: UUID
    name: str
    category: str | None
    save_count: int
    updated_at: datetime
    cover_urls: list[str]


class StackDetailOut(StackOut):
    """Contract `StackDetail`."""

    saves: list[SaveOut]


class CuratedHero(BaseModel):
    label: str
    title: str
    subtitle: str
    image_url: str | None
    save_ids: list[UUID]
    query: str


class CuratedSection(BaseModel):
    kind: Literal["row", "list"]
    title: str
    subtitle: str | None
    saves: list[SaveOut]


class CuratedFeed(BaseModel):
    """Contract `CuratedFeed`."""

    date_label: str
    hero: CuratedHero
    sections: list[CuratedSection]


class ErrorResponse(BaseModel):
    error: dict[str, str]
