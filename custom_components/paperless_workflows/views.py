"""Pure helpers for flexible Paperless document views."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Any

from .amounts import parse_monetary
from .normalization import normalize_lookup_name

ENTITY_FILTERS = {
    "tags_any": "tags__id__in", "tags_all": "tags__id__all", "tags_none": "tags__id__none",
    "correspondents": "correspondent__id__in", "correspondents_none": "correspondent__id__none",
    "document_types": "document_type__id__in", "document_types_none": "document_type__id__none",
    "storage_paths": "storage_path__id__in", "storage_paths_none": "storage_path__id__none",
    "owners": "owner__id__in", "owners_none": "owner__id__none",
}
ADVANCED_FILTER_PREFIXES = (
    "added__", "archive_serial_number", "checksum__", "content__", "correspondent__", "created__",
    "custom_field_query", "custom_fields__", "document_type__", "has_", "id__", "is_in_inbox",
    "is_tagged", "mime_type", "modified__", "original_file_name__", "owner__", "query", "search",
    "shared_by__", "storage_path__", "tags__", "title__",
)

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def metadata_maps(metadata: Mapping[str, list[dict[str, Any]]]) -> dict[str, dict[Any, str]]:
    """Build id/name maps for document rendering and grouping."""
    result: dict[str, dict[Any, str]] = {}
    for key in ("tags", "correspondents", "document_types", "storage_paths", "users", "custom_fields"):
        result[key] = {item.get("id"): str(item.get("name") or item.get("username") or item.get("id")) for item in metadata.get(key, [])}
    return result


def view_tag_colors(
    view: Mapping[str, Any], metadata: Mapping[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """Return the live Paperless colors for tags used by a view.

    The first positive tag filter becomes the accent. ``tags_all`` takes
    precedence over ``tags_any`` so a view with one required workflow tag and
    additional optional tags keeps the required tag's visual identity.
    """
    filters = view.get("filters") or {}
    configured_names = [
        str(name)
        for key in ("tags_all", "tags_any")
        for name in filters.get(key, [])
        if str(name)
    ]
    tags_by_name = {
        normalize_lookup_name(str(tag.get("name", ""))): tag
        for tag in metadata.get("tags", [])
    }
    colors: dict[str, str] = {}
    accent_tag: str | None = None
    for configured_name in configured_names:
        tag = tags_by_name.get(normalize_lookup_name(configured_name))
        if tag is None:
            continue
        color = str(tag.get("color") or "").strip()
        if not _HEX_COLOR.fullmatch(color):
            continue
        tag_name = str(tag.get("name") or configured_name)
        if tag_name not in colors:
            colors[tag_name] = color.lower()
        if accent_tag is None:
            accent_tag = tag_name
    return {
        "accent_tag": accent_tag,
        "accent_color": colors.get(accent_tag) if accent_tag else None,
        "tag_colors": colors,
    }


def _resolve_names(names: Iterable[str], items: list[dict[str, Any]]) -> list[int]:
    lookup = {normalize_lookup_name(str(item.get("name") or item.get("username") or "")): item.get("id") for item in items}
    return [int(lookup[normalize_lookup_name(name)]) for name in names if normalize_lookup_name(name) in lookup]


def build_query(view: Mapping[str, Any], metadata: Mapping[str, list[dict[str, Any]]]) -> tuple[dict[str, Any], list[str]]:
    """Translate friendly filters into Paperless query parameters."""
    filters = view.get("filters") or {}
    query: dict[str, Any] = {}
    missing: list[str] = []
    collections = {
        "tags_any": "tags", "tags_all": "tags", "tags_none": "tags",
        "correspondents": "correspondents", "correspondents_none": "correspondents",
        "document_types": "document_types", "document_types_none": "document_types",
        "storage_paths": "storage_paths", "storage_paths_none": "storage_paths",
        "owners": "users", "owners_none": "users",
    }
    for source, target in ENTITY_FILTERS.items():
        names = [str(value) for value in filters.get(source, []) if str(value)]
        if not names:
            continue
        ids = _resolve_names(names, metadata.get(collections[source], []))
        found = {normalize_lookup_name(str(item.get("name") or item.get("username") or "")) for item in metadata.get(collections[source], [])}
        missing.extend(f"{source}: {name}" for name in names if normalize_lookup_name(name) not in found)
        if ids:
            query[target] = ",".join(str(value) for value in ids)
    direct = {
        "search": "query", "mime_type": "mime_type", "is_in_inbox": "is_in_inbox",
        "is_tagged": "is_tagged", "has_duplicates": "has_duplicates",
        "created_after": "created__date__gte", "created_before": "created__date__lte",
        "added_after": "added__date__gte", "added_before": "added__date__lte",
        "modified_after": "modified__date__gte", "modified_before": "modified__date__lte",
    }
    for source, target in direct.items():
        value = filters.get(source)
        if value not in (None, "", []):
            query[target] = value
    for key, value in (view.get("advanced_filters") or {}).items():
        if key in {"page", "page_size", "fields"}:
            continue
        if any(key == prefix or key.startswith(prefix) for prefix in ADVANCED_FILTER_PREFIXES):
            query[key] = value
    query["ordering"] = view.get("ordering", "-created")
    return query, missing


def custom_field_values(document: Mapping[str, Any]) -> dict[int, Any]:
    values: dict[int, Any] = {}
    for item in document.get("custom_fields") or []:
        if isinstance(item, Mapping) and item.get("field") is not None:
            values[int(item["field"])] = item.get("value")
    return values


def _entity_name(value: Any, mapping: Mapping[Any, str]) -> str:
    if value in (None, ""):
        return "Nicht gesetzt"
    return mapping.get(value, f"#{value}")


def render_document(
    document: Mapping[str, Any], selected: Iterable[str], maps: Mapping[str, Mapping[Any, str]],
    base_url: str, selected_custom_fields: Iterable[str] = (),
) -> dict[str, Any]:
    """Render only explicitly selected document details."""
    result: dict[str, Any] = {"id": document.get("id"), "url": f"{base_url}/documents/{document.get('id')}/details"}
    selected_set = set(selected)
    scalar_fields = {"title", "created", "added", "modified", "archive_serial_number", "original_file_name", "mime_type", "page_count"}
    for field in scalar_fields & selected_set:
        result[field] = document.get(field)
    for field, collection in (("correspondent", "correspondents"), ("document_type", "document_types"), ("storage_path", "storage_paths"), ("owner", "users")):
        if field in selected_set:
            result[field] = _entity_name(document.get(field), maps.get(collection, {}))
    if "tags" in selected_set:
        result["tags"] = [_entity_name(value, maps.get("tags", {})) for value in document.get("tags") or []]
    if "custom_fields" in selected_set:
        requested = {normalize_lookup_name(name) for name in selected_custom_fields}
        visible_custom_fields = {}
        for field_id, value in custom_field_values(document).items():
            name = maps.get("custom_fields", {}).get(field_id, f"#{field_id}")
            if not requested or normalize_lookup_name(name) in requested:
                visible_custom_fields[name] = value
        result["custom_fields"] = visible_custom_fields
    return result


def aggregate_field(documents: Iterable[Mapping[str, Any]], field: Mapping[str, Any], default_currency: str) -> tuple[dict[str, Decimal], int]:
    field_id = int(field["id"])
    totals: dict[str, Decimal] = defaultdict(Decimal)
    invalid = 0
    for document in documents:
        value = custom_field_values(document).get(field_id)
        if value in (None, ""):
            continue
        try:
            if field.get("data_type") == "monetary":
                parsed = parse_monetary(value, default_currency)
                if parsed is None:
                    raise ValueError("invalid monetary value")
                currency, amount = parsed
                totals[currency] += amount
            else:
                totals[""] += Decimal(str(value).replace(",", "."))
        except (InvalidOperation, TypeError, ValueError):
            invalid += 1
    return dict(totals), invalid


def _date_bucket(value: Any, length: int) -> str:
    if not value:
        return "Nicht gesetzt"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()[:length]
    except ValueError:
        return str(value)[:length]


def group_values(document: Mapping[str, Any], dimension: str, maps: Mapping[str, Mapping[Any, str]]) -> list[str]:
    if dimension == "tags":
        return [_entity_name(value, maps.get("tags", {})) for value in document.get("tags") or []] or ["Nicht gesetzt"]
    entities = {"correspondent": "correspondents", "document_type": "document_types", "storage_path": "storage_paths", "owner": "users"}
    if dimension in entities:
        return [_entity_name(document.get(dimension), maps.get(entities[dimension], {}))]
    if dimension == "mime_type":
        return [str(document.get("mime_type") or "Nicht gesetzt")]
    if dimension in ("created_month", "created_year", "added_month", "added_year"):
        field, period = dimension.split("_", 1)
        return [_date_bucket(document.get(field), 7 if period == "month" else 4)]
    if dimension.startswith("custom_field:"):
        field_id = int(dimension.split(":", 1)[1])
        value = custom_field_values(document).get(field_id)
        if isinstance(value, list):
            return [str(item) for item in value] or ["Nicht gesetzt"]
        return [str(value) if value not in (None, "") else "Nicht gesetzt"]
    return ["Alle"]


def _bucket_add(bucket: dict[str, Any], document: Mapping[str, Any], fields: Iterable[Mapping[str, Any]], default_currency: str) -> None:
    bucket["count"] = bucket.get("count", 0) + 1
    sums = bucket.setdefault("sums", {})
    values = custom_field_values(document)
    for field in fields:
        value = values.get(int(field["id"]))
        if value in (None, ""):
            continue
        name = str(field.get("name"))
        if field.get("data_type") == "monetary":
            parsed = parse_monetary(value, default_currency)
            if parsed is None:
                continue
            currency, amount = parsed
            field_sums = sums.setdefault(name, {})
            field_sums[currency] = round(float(field_sums.get(currency, 0)) + float(amount), 6)
        else:
            try:
                sums[name] = round(float(sums.get(name, 0)) + float(str(value).replace(",", ".")), 6)
            except (TypeError, ValueError):
                continue


def group_documents(
    documents: Iterable[Mapping[str, Any]], primary: str, secondary: str,
    maps: Mapping[str, Mapping[Any, str]], aggregate_fields: Iterable[Mapping[str, Any]] = (),
    default_currency: str = "EUR",
) -> dict[str, Any]:
    groups: dict[str, Any] = {}
    for document in documents:
        for first in group_values(document, primary, maps):
            if secondary and secondary != "none":
                bucket = groups.setdefault(first, {})
                for second in group_values(document, secondary, maps):
                    _bucket_add(bucket.setdefault(second, {}), document, aggregate_fields, default_currency)
            else:
                _bucket_add(groups.setdefault(first, {}), document, aggregate_fields, default_currency)
    return groups


def bounded_documents(documents: list[dict[str, Any]], maximum: int, byte_limit: int) -> tuple[list[dict[str, Any]], bool]:
    result: list[dict[str, Any]] = []
    for document in documents[:maximum]:
        candidate = [*result, document]
        if len(json.dumps(candidate, ensure_ascii=False, default=str).encode()) > byte_limit:
            return result, True
        result.append(document)
    return result, len(documents) > maximum
