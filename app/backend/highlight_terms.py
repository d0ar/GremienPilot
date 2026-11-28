"""Global list of terms that are shown in bold in transcripts.

The list is shared by all workstations. Saving uses an optimistic revision so
the UI can warn when someone else changed the list in the meantime.
"""

from __future__ import annotations

import re
from typing import Any, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StrictInt

from persistence import SettingConflictError, load_setting, save_setting


SETTING_KEY = "highlight_terms"
MAX_TERMS = 200
MAX_TERM_LENGTH = 100
_WHITESPACE = re.compile(r"\s+")

router = APIRouter()


class HighlightTermsResponse(BaseModel):
    terms: List[str]
    revision: int


class HighlightTermsSaveRequest(BaseModel):
    terms: List[str] = Field(..., max_length=MAX_TERMS * 5)
    revision: StrictInt = Field(..., ge=0)


def normalize_highlight_terms(raw_terms: list[str]) -> list[str]:
    """Trim, collapse whitespace, drop empties and case-insensitive duplicates.

    Raises ValueError with a German message when limits are exceeded.
    """
    terms: list[str] = []
    seen: set[str] = set()
    for raw in raw_terms:
        term = _WHITESPACE.sub(" ", raw).strip()
        # A bare wildcard would match every word; treat it like an empty line.
        if not term.replace("*", "").strip():
            continue
        if len(term) > MAX_TERM_LENGTH:
            raise ValueError(
                f"Begriff ist länger als {MAX_TERM_LENGTH} Zeichen: {term[:40]}…"
            )
        # lower() rather than casefold(): the UI matches case-insensitively but
        # does not treat "ß" and "ss" as equal, so neither does the dedupe.
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        terms.append(term)
    if len(terms) > MAX_TERMS:
        raise ValueError(f"Höchstens {MAX_TERMS} Begriffe erlaubt")
    return terms


def _payload(setting: dict[str, Any]) -> dict[str, Any]:
    value = setting.get("value")
    terms = [term for term in value if isinstance(term, str)] if isinstance(value, list) else []
    return {"terms": terms, "revision": int(setting.get("revision") or 0)}


@router.get("/api/settings/highlight-terms", response_model=HighlightTermsResponse)
async def get_highlight_terms():
    """Return the shared highlight terms and their revision."""
    return _payload(load_setting(SETTING_KEY))


@router.put("/api/settings/highlight-terms", response_model=HighlightTermsResponse)
async def put_highlight_terms(request: HighlightTermsSaveRequest):
    """Replace the shared highlight terms if the revision is still current."""
    try:
        terms = normalize_highlight_terms(request.terms)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        saved = save_setting(SETTING_KEY, terms, expected_revision=request.revision)
    except SettingConflictError as exc:
        current = _payload(exc.current)
        return JSONResponse(
            status_code=409,
            content={
                "detail": {
                    "message": (
                        "Die Liste wurde zwischenzeitlich geändert. "
                        "Bitte prüfen Sie den aktuellen Stand."
                    ),
                    **current,
                }
            },
        )
    return _payload(saved)
