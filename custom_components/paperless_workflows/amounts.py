"""Pure helpers for Paperless monetary custom fields."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any

_MONEY_RE = re.compile(
    r"^\s*(?:(?P<currency>[A-Za-z]{3})\s*)?(?P<amount>-?\d+(?:[.,]\d+)?)\s*$"
)


def parse_monetary(value: Any, default_currency: str) -> tuple[str, Decimal] | None:
    """Parse Paperless monetary values such as EUR12.30 or 12.30."""
    if value is None or isinstance(value, bool):
        return None
    match = _MONEY_RE.match(str(value))
    if match is None:
        return None
    currency = (match.group("currency") or default_currency).upper()
    try:
        amount = Decimal(match.group("amount").replace(",", "."))
    except InvalidOperation:
        return None
    return currency, amount


def sum_monetary(
    documents: list[dict[str, Any]], field_id: int, default_currency: str
) -> tuple[dict[str, Decimal], int]:
    """Sum a custom field across documents and count malformed values."""
    totals: dict[str, Decimal] = {}
    invalid = 0
    for document in documents:
        for custom_field in document.get("custom_fields") or []:
            if custom_field.get("field") != field_id:
                continue
            parsed = parse_monetary(custom_field.get("value"), default_currency)
            if parsed is None:
                if custom_field.get("value") is not None:
                    invalid += 1
                break
            currency, amount = parsed
            totals[currency] = totals.get(currency, Decimal("0")) + amount
            break
    return totals, invalid
