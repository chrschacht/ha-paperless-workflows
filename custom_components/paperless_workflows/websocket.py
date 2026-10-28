"""Authenticated WebSocket API for the visual Paperless workspace card."""

from __future__ import annotations

from urllib.parse import urlparse

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .api import PaperlessApiError
from .const import DOCUMENT_FIELDS, DOCUMENT_FIELD_TYPES, DOMAIN


def _coordinator(hass: HomeAssistant, entry_id: str):
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        return None
    return getattr(entry, "runtime_data", None)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/instances"})
@websocket_api.async_response
async def websocket_instances(hass, connection, msg) -> None:
    """Expose safe metadata for every configured Paperless instance."""
    instances = []
    for entry in hass.config_entries.async_entries(DOMAIN):
        coordinator = getattr(entry, "runtime_data", None)
        if coordinator is None or not coordinator.data:
            continue
        metadata = coordinator.data.get("metadata") or {}
        instances.append({
            "entry_id": entry.entry_id,
            "title": entry.title,
            "url": coordinator.client.base_url,
            "dns_name": urlparse(coordinator.client.base_url).hostname or coordinator.client.base_url,
            "default_currency": coordinator.default_currency,
            "tags": [
                {"id": tag.get("id"), "name": tag.get("name"), "color": tag.get("color")}
                for tag in metadata.get("tags", [])
                if tag.get("id") is not None
            ],
            "custom_fields": [
                {
                    "id": field.get("id"), "name": field.get("name"),
                    "data_type": field.get("data_type"),
                }
                for field in metadata.get("custom_fields", [])
                if field.get("id") is not None
            ],
            "document_fields": [
                {"key": key, "name": name, "data_type": DOCUMENT_FIELD_TYPES.get(key, "text")}
                for key, name in DOCUMENT_FIELDS.items()
                if key != "custom_fields"
            ],
        })
    connection.send_result(msg["id"], {"instances": instances})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/tag_workspace",
    vol.Required("entry_id"): str,
    vol.Required("tag_id"): vol.Coerce(int),
    vol.Optional("columns", default=[]): [str],
    vol.Optional("sum_field_id"): vol.Any(None, vol.Coerce(int)),
    vol.Optional("ordering", default="created"): str,
    vol.Optional("max_documents", default=50): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
})
@websocket_api.async_response
async def websocket_tag_workspace(hass, connection, msg) -> None:
    """Fetch a tag summary and its selected document details."""
    coordinator = _coordinator(hass, msg["entry_id"])
    if coordinator is None:
        connection.send_error(msg["id"], "entry_not_found", "Paperless instance not found")
        return
    tag_ids = {
        int(tag["id"])
        for tag in coordinator.data.get("metadata", {}).get("tags", [])
        if tag.get("id") is not None
    }
    if msg["tag_id"] not in tag_ids:
        connection.send_error(msg["id"], "tag_not_found", "Paperless tag not found")
        return
    try:
        result = await coordinator.client.fetch_tag_workspace(
            tag_id=msg["tag_id"],
            metadata=coordinator.data.get("metadata") or {},
            columns=list(msg.get("columns") or []),
            sum_field_id=msg.get("sum_field_id"),
            default_currency=coordinator.default_currency,
            ordering=msg.get("ordering", "created"),
            max_documents=msg.get("max_documents", 50),
        )
    except PaperlessApiError as err:
        connection.send_error(msg["id"], "paperless_error", str(err))
        return
    connection.send_result(msg["id"], result)


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register the frontend's read-only commands once."""
    websocket_api.async_register_command(hass, websocket_instances)
    websocket_api.async_register_command(hass, websocket_tag_workspace)
