"""Name normalization used for Paperless metadata lookups."""

from __future__ import annotations

import unicodedata


def normalize_lookup_name(value: str) -> str:
    """Normalize case and common German umlaut transliterations."""
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    return (
        normalized.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
    )
