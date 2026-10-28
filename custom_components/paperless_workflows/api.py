"""Async Paperless API client for configurable document views."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any
from urllib.parse import urljoin, urlparse, urlunsplit

from aiohttp import ClientResponseError, ClientSession

from .normalization import normalize_lookup_name
from .views import aggregate_field, build_query, group_documents, metadata_maps
from .views import render_document


class PaperlessApiError(Exception):
    """Raised when Paperless cannot be queried safely."""


class PaperlessAuthError(PaperlessApiError):
    """Raised when the API key is rejected."""


class PaperlessWorkflowClient:
    """Authenticated Paperless client with origin-safe pagination."""

    def __init__(self, session: ClientSession, base_url: str, api_key: str, verify_ssl: bool) -> None:
        self._session = session
        self.base_url = base_url.rstrip("/")
        self._origin = urlparse(self.base_url)
        self._headers = {"Authorization": f"Token {api_key}", "Accept": "application/json"}
        self._ssl: bool | None = None if verify_ssl else False

    def _safe_url(self, endpoint_or_url: str) -> str:
        url = urljoin(f"{self.base_url}/", endpoint_or_url)
        parsed = urlparse(url)
        if (parsed.scheme, parsed.netloc) != (self._origin.scheme, self._origin.netloc):
            raise PaperlessApiError("Paperless pagination attempted to leave the configured origin")
        return url

    def _pagination_url(self, candidate: str) -> str:
        """Keep Paperless pagination on the configured public origin.

        Reverse proxies sometimes make Paperless emit an internal host or HTTP
        scheme in ``next``. Only its API path and query are retained, so the
        token can never be forwarded to that reported origin.
        """
        parsed = urlparse(urljoin(f"{self.base_url}/", candidate))
        if not parsed.path.startswith("/api/"):
            raise PaperlessApiError("Paperless returned an invalid pagination path")
        return urlunsplit((self._origin.scheme, self._origin.netloc, parsed.path, parsed.query, ""))

    async def _get_json(self, endpoint_or_url: str, params: Mapping[str, Any] | None = None) -> dict[str, Any]:
        try:
            async with self._session.get(
                self._safe_url(endpoint_or_url), headers=self._headers, params=params,
                ssl=self._ssl, timeout=30,
            ) as response:
                if response.status in (401, 403):
                    raise PaperlessAuthError("Paperless rejected the API key")
                response.raise_for_status()
                payload = await response.json()
        except PaperlessApiError:
            raise
        except ClientResponseError as err:
            raise PaperlessApiError(f"Paperless returned HTTP {err.status}") from err
        except Exception as err:
            raise PaperlessApiError(str(err)) from err
        if not isinstance(payload, dict):
            raise PaperlessApiError("Paperless returned an unexpected response")
        return payload

    async def _get_all(self, endpoint: str, params: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
        query = {"page_size": 100, **dict(params or {})}
        next_url: str | None = endpoint
        results: list[dict[str, Any]] = []
        first = True
        while next_url:
            payload = await self._get_json(next_url, query if first else None)
            first = False
            page = payload.get("results") or []
            if not isinstance(page, list):
                raise PaperlessApiError("Paperless returned an invalid result page")
            results.extend(item for item in page if isinstance(item, dict))
            next_url = self._pagination_url(str(payload["next"])) if payload.get("next") else None
        return results

    async def validate(self) -> None:
        await self._get_json("api/tags/", {"page_size": 1})

    async def fetch_metadata(self) -> dict[str, list[dict[str, Any]]]:
        """Fetch selectable Paperless metadata in parallel."""
        keys = ("tags", "correspondents", "document_types", "storage_paths", "custom_fields")
        endpoints = (
            "api/tags/", "api/correspondents/", "api/document_types/", "api/storage_paths/",
            "api/custom_fields/",
        )
        values = await asyncio.gather(*(self._get_all(endpoint) for endpoint in endpoints))
        metadata = dict(zip(keys, values, strict=True))
        try:
            metadata["users"] = await self._get_all("api/users/")
        except PaperlessApiError:
            # Owner ids remain groupable even when the token cannot list users.
            metadata["users"] = []
        return metadata

    async def fetch_views(self, views: list[dict[str, Any]], default_currency: str) -> dict[str, Any]:
        """Fetch and aggregate every enabled view."""
        metadata = await self.fetch_metadata()
        maps = metadata_maps(metadata)
        enabled = [view for view in views if view.get("enabled", True)]
        queries = [build_query(view, metadata) for view in enabled]
        document_sets = await asyncio.gather(*(self._get_all("api/documents/", query) for query, _missing in queries))
        fields_by_name = {
            normalize_lookup_name(str(field.get("name", ""))): field for field in metadata["custom_fields"]
        }
        result: dict[str, Any] = {}
        all_missing: list[str] = []
        for view, documents, (_query, missing) in zip(enabled, document_sets, queries, strict=True):
            aggregates: dict[str, Any] = {}
            for configured_name in view.get("aggregate_fields", []):
                field = fields_by_name.get(normalize_lookup_name(configured_name))
                if field is None:
                    missing.append(f"aggregate_field: {configured_name}")
                    continue
                totals, invalid = aggregate_field(documents, field, default_currency)
                aggregates[str(field["id"])] = {
                    "name": field.get("name"), "type": field.get("data_type"),
                    "totals": totals, "invalid_values": invalid,
                }
            primary = view.get("group_by", "none")
            secondary = view.get("secondary_group_by", "none")
            result[view["id"]] = {
                "view": view, "documents": documents, "count": len(documents), "aggregates": aggregates,
                "groups": group_documents(
                    documents, primary, secondary, maps,
                    [fields_by_name[normalize_lookup_name(name)] for name in view.get("aggregate_fields", []) if normalize_lookup_name(name) in fields_by_name],
                    default_currency,
                ) if primary != "none" else {},
                "missing": missing,
            }
            all_missing.extend(f"{view['name']}: {item}" for item in missing)
        return {"views": result, "metadata": metadata, "maps": maps, "missing": all_missing}

    async def fetch_tag_workspace(
        self,
        *,
        tag_id: int,
        metadata: dict[str, list[dict[str, Any]]],
        columns: list[str],
        sum_field_id: int | None,
        default_currency: str,
        ordering: str = "created",
        max_documents: int = 50,
    ) -> dict[str, Any]:
        """Return one tag summary and optional documents for the dashboard card.

        The frontend only sends stable Paperless ids.  The API token stays in
        the config entry and never becomes part of Lovelace configuration.
        """
        documents = await self._get_all(
            "api/documents/",
            {"tags__id__all": str(tag_id), "ordering": ordering},
        )
        maps = metadata_maps(metadata)
        custom_by_id = {
            int(field["id"]): field
            for field in metadata.get("custom_fields", [])
            if field.get("id") is not None
        }
        standard_fields: list[str] = []
        custom_field_names: list[str] = []
        for column in columns:
            if column.startswith("standard:"):
                standard_fields.append(column.split(":", 1)[1])
            elif column.startswith("custom:"):
                try:
                    field = custom_by_id.get(int(column.split(":", 1)[1]))
                except ValueError:
                    field = None
                if field is not None:
                    custom_field_names.append(str(field.get("name") or field["id"]))
        if custom_field_names:
            standard_fields.append("custom_fields")

        rendered = [
            render_document(
                document,
                standard_fields,
                maps,
                self.base_url,
                custom_field_names,
            )
            for document in documents[:max_documents]
        ] if max_documents else []

        aggregate = None
        if sum_field_id is not None and (field := custom_by_id.get(sum_field_id)) is not None:
            totals, invalid = aggregate_field(documents, field, default_currency)
            aggregate = {
                "field_id": sum_field_id,
                "name": str(field.get("name") or sum_field_id),
                "type": field.get("data_type"),
                "totals": {currency or default_currency: float(value) for currency, value in totals.items()},
                "invalid_values": invalid,
            }

        return {
            "tag_id": tag_id,
            "count": len(documents),
            "documents": rendered,
            "documents_shown": len(rendered),
            "documents_truncated": len(documents) > len(rendered),
            "aggregate": aggregate,
        }
