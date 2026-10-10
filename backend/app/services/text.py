"""Make text safe for Postgres: `text`/`jsonb` reject NUL (0x00), and asyncpg
can't encode lone UTF-16 surrogates. Applied to request input and to anything
fetched from Instagram or returned by an LLM before it is written."""

from __future__ import annotations

from typing import Any


def clean_text(s: str) -> str:
    if "\x00" in s:
        s = s.replace("\x00", "")
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        s = s.encode("utf-8", "replace").decode("utf-8")
    return s


def clean(value: Any) -> Any:
    """`clean_text` applied through dicts, lists and tuples; other values pass through."""
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, dict):
        return {clean(k): clean(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return type(value)(clean(v) for v in value)
    return value
