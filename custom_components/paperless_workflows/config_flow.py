"""Config flow for flexible Paperless document views."""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_URL
from homeassistant.core import callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PaperlessApiError, PaperlessAuthError, PaperlessWorkflowClient
from .const import (
    CONF_API_KEY, CONF_DEFAULT_CURRENCY, CONF_SCAN_INTERVAL, CONF_VERIFY_SSL, CONF_VIEWS,
    DEFAULT_CURRENCY, DEFAULT_SCAN_INTERVAL, DOCUMENT_FIELDS, DOMAIN, GROUP_DIMENSIONS,
    MAX_DOCUMENTS_IN_ATTRIBUTES, MIN_SCAN_INTERVAL, default_views,
)


def _connection_schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema({
        vol.Required(CONF_URL, default=defaults.get(CONF_URL, "")): str,
        vol.Required(CONF_API_KEY, default=defaults.get(CONF_API_KEY, "")): str,
        vol.Required(CONF_VERIFY_SSL, default=defaults.get(CONF_VERIFY_SSL, True)): bool,
        vol.Required(CONF_SCAN_INTERVAL, default=defaults.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL)),
        vol.Required(CONF_DEFAULT_CURRENCY, default=defaults.get(CONF_DEFAULT_CURRENCY, DEFAULT_CURRENCY)): vol.All(str, vol.Length(min=3, max=3)),
    })


async def _validate(hass, data: dict[str, Any]) -> str | None:
    parsed = urlparse(data[CONF_URL])
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return "invalid_url"
    client = PaperlessWorkflowClient(async_get_clientsession(hass), data[CONF_URL], data[CONF_API_KEY], data[CONF_VERIFY_SSL])
    try:
        await client.validate()
    except PaperlessAuthError:
        return "invalid_auth"
    except PaperlessApiError:
        return "cannot_connect"
    return None


class PaperlessWorkflowsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure the Paperless connection."""

    VERSION = 2

    async def async_step_user(self, user_input=None):
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_URL] = user_input[CONF_URL].rstrip("/")
            user_input[CONF_DEFAULT_CURRENCY] = user_input[CONF_DEFAULT_CURRENCY].upper()
            if error := await _validate(self.hass, user_input):
                errors["base"] = error
            else:
                await self.async_set_unique_id(user_input[CONF_URL].casefold())
                self._abort_if_unique_id_configured()
                user_input[CONF_VIEWS] = default_views()
                return self.async_create_entry(title="Paperless Workflows", data=user_input)
        return self.async_show_form(step_id="user", data_schema=_connection_schema(user_input or {}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return PaperlessWorkflowsOptionsFlow(config_entry)


class PaperlessWorkflowsOptionsFlow(config_entries.OptionsFlow):
    """Manage any number of configurable document views."""

    def __init__(self, config_entry) -> None:
        self._entry = config_entry
        self._views = deepcopy(config_entry.options.get(CONF_VIEWS, config_entry.data.get(CONF_VIEWS, default_views())))
        self._view: dict[str, Any] = {}
        self._edit_index: int | None = None
        self._metadata: dict[str, list[dict[str, Any]]] | None = None

    def _save(self):
        current = {**self._entry.data, **self._entry.options}
        return self.async_create_entry(title="", data={
            CONF_SCAN_INTERVAL: current.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
            CONF_DEFAULT_CURRENCY: current.get(CONF_DEFAULT_CURRENCY, DEFAULT_CURRENCY),
            CONF_VIEWS: self._views,
        })

    async def _async_metadata(self) -> dict[str, list[dict[str, Any]]]:
        if self._metadata is None:
            runtime = getattr(self._entry, "runtime_data", None)
            if runtime is not None and runtime.data:
                self._metadata = runtime.data.get("metadata")
            if self._metadata is None:
                config = {**self._entry.data, **self._entry.options}
                client = PaperlessWorkflowClient(async_get_clientsession(self.hass), config[CONF_URL], config[CONF_API_KEY], config.get(CONF_VERIFY_SSL, True))
                self._metadata = await client.fetch_metadata()
        return self._metadata

    async def async_step_init(self, user_input=None):
        return self.async_show_menu(step_id="init", menu_options=["general", "add_view", "edit_view", "delete_view"])

    async def async_step_general(self, user_input=None):
        current = {**self._entry.data, **self._entry.options}
        schema = vol.Schema({
            vol.Required(CONF_SCAN_INTERVAL, default=current.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL)),
            vol.Required(CONF_DEFAULT_CURRENCY, default=current.get(CONF_DEFAULT_CURRENCY, DEFAULT_CURRENCY)): vol.All(str, vol.Length(min=3, max=3)),
        })
        if user_input is not None:
            current.update(user_input)
            current[CONF_DEFAULT_CURRENCY] = current[CONF_DEFAULT_CURRENCY].upper()
            return self.async_create_entry(title="", data={CONF_SCAN_INTERVAL: current[CONF_SCAN_INTERVAL], CONF_DEFAULT_CURRENCY: current[CONF_DEFAULT_CURRENCY], CONF_VIEWS: self._views})
        return self.async_show_form(step_id="general", data_schema=schema)

    async def async_step_add_view(self, user_input=None):
        self._edit_index = None
        self._view = {
            "id": uuid4().hex[:12], "name": "Neue Ansicht", "icon": "mdi:file-document-multiple-outline",
            "enabled": True, "filters": {}, "display_documents": True,
            "document_fields": ["title", "correspondent", "document_type", "tags"],
            "max_documents": 25, "count": True, "attention": False, "attention_threshold": 1,
            "aggregate_fields": [], "group_by": "none", "secondary_group_by": "none",
            "advanced_filters": {}, "ordering": "-created",
        }
        return await self.async_step_view_basic()

    async def async_step_edit_view(self, user_input=None):
        if not self._views:
            return self.async_abort(reason="no_views")
        choices = {str(index): view["name"] for index, view in enumerate(self._views)}
        if user_input is not None:
            self._edit_index = int(user_input["view"])
            self._view = deepcopy(self._views[self._edit_index])
            return await self.async_step_view_basic()
        return self.async_show_form(step_id="edit_view", data_schema=vol.Schema({vol.Required("view"): vol.In(choices)}))

    async def async_step_delete_view(self, user_input=None):
        if not self._views:
            return self.async_abort(reason="no_views")
        choices = {str(index): view["name"] for index, view in enumerate(self._views)}
        if user_input is not None:
            self._views.pop(int(user_input["view"]))
            return self._save()
        return self.async_show_form(step_id="delete_view", data_schema=vol.Schema({vol.Required("view"): vol.In(choices)}))

    async def async_step_view_basic(self, user_input=None):
        if user_input is not None:
            self._view.update(user_input)
            return await self.async_step_view_tags()
        return self.async_show_form(step_id="view_basic", data_schema=vol.Schema({
            vol.Required("name", default=self._view.get("name", "")): str,
            vol.Required("icon", default=self._view.get("icon", "mdi:file-document-multiple-outline")): str,
            vol.Required("enabled", default=self._view.get("enabled", True)): bool,
        }))

    async def async_step_view_tags(self, user_input=None):
        metadata = await self._async_metadata()
        options = {str(item["name"]): str(item["name"]) for item in metadata["tags"]}
        filters = self._view.setdefault("filters", {})
        if user_input is not None:
            filters.update(user_input)
            return await self.async_step_view_metadata()
        return self.async_show_form(step_id="view_tags", data_schema=vol.Schema({
            vol.Optional("tags_any", default=filters.get("tags_any", [])): cv.multi_select(options),
            vol.Optional("tags_all", default=filters.get("tags_all", [])): cv.multi_select(options),
            vol.Optional("tags_none", default=filters.get("tags_none", [])): cv.multi_select(options),
        }))

    async def async_step_view_metadata(self, user_input=None):
        metadata = await self._async_metadata()
        filters = self._view.setdefault("filters", {})
        if user_input is not None:
            filters.update(user_input)
            return await self.async_step_view_exclusions()
        def choices(key):
            return {str(item.get("name") or item.get("username") or item["id"]): str(item.get("name") or item.get("username") or item["id"]) for item in metadata[key]}
        return self.async_show_form(step_id="view_metadata", data_schema=vol.Schema({
            vol.Optional("correspondents", default=filters.get("correspondents", [])): cv.multi_select(choices("correspondents")),
            vol.Optional("document_types", default=filters.get("document_types", [])): cv.multi_select(choices("document_types")),
            vol.Optional("storage_paths", default=filters.get("storage_paths", [])): cv.multi_select(choices("storage_paths")),
            vol.Optional("owners", default=filters.get("owners", [])): cv.multi_select(choices("users")),
        }))

    async def async_step_view_exclusions(self, user_input=None):
        metadata = await self._async_metadata()
        filters = self._view.setdefault("filters", {})
        if user_input is not None:
            filters.update(user_input)
            return await self.async_step_view_search()
        def choices(key):
            return {str(item.get("name") or item.get("username") or item["id"]): str(item.get("name") or item.get("username") or item["id"]) for item in metadata[key]}
        return self.async_show_form(step_id="view_exclusions", data_schema=vol.Schema({
            vol.Optional("correspondents_none", default=filters.get("correspondents_none", [])): cv.multi_select(choices("correspondents")),
            vol.Optional("document_types_none", default=filters.get("document_types_none", [])): cv.multi_select(choices("document_types")),
            vol.Optional("storage_paths_none", default=filters.get("storage_paths_none", [])): cv.multi_select(choices("storage_paths")),
            vol.Optional("owners_none", default=filters.get("owners_none", [])): cv.multi_select(choices("users")),
        }))

    async def async_step_view_search(self, user_input=None):
        filters = self._view.setdefault("filters", {})
        errors = {}
        if user_input is not None:
            try:
                advanced = json.loads(user_input.pop("advanced_filters_json") or "{}")
                if not isinstance(advanced, dict):
                    raise ValueError
            except (ValueError, json.JSONDecodeError):
                errors["advanced_filters_json"] = "invalid_json"
            else:
                filters.update(user_input)
                self._view["advanced_filters"] = advanced
                return await self.async_step_view_presentation()
        return self.async_show_form(step_id="view_search", data_schema=vol.Schema({
            vol.Optional("search", default=filters.get("search", "")): str,
            vol.Optional("mime_type", default=filters.get("mime_type", "")): str,
            vol.Optional("created_after", default=filters.get("created_after", "")): str,
            vol.Optional("created_before", default=filters.get("created_before", "")): str,
            vol.Optional("advanced_filters_json", default=json.dumps(self._view.get("advanced_filters", {}), ensure_ascii=False)): str,
        }), errors=errors)

    async def async_step_view_presentation(self, user_input=None):
        metadata = await self._async_metadata()
        if user_input is not None:
            self._view.update(user_input)
            return await self.async_step_view_metrics()
        return self.async_show_form(step_id="view_presentation", data_schema=vol.Schema({
            vol.Required("display_documents", default=self._view.get("display_documents", True)): bool,
            vol.Optional("document_fields", default=self._view.get("document_fields", ["title"])): cv.multi_select(DOCUMENT_FIELDS),
            vol.Optional("document_custom_fields", default=self._view.get("document_custom_fields", [])): cv.multi_select({str(field["name"]): str(field["name"]) for field in metadata["custom_fields"]}),
            vol.Required("max_documents", default=self._view.get("max_documents", 25)): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_DOCUMENTS_IN_ATTRIBUTES)),
            vol.Required("ordering", default=self._view.get("ordering", "-created")): vol.In({"-created": "Neueste zuerst", "created": "Älteste zuerst", "title": "Titel A–Z", "-modified": "Zuletzt geändert"}),
        }))

    async def async_step_view_metrics(self, user_input=None):
        metadata = await self._async_metadata()
        custom_fields = {
            str(field["name"]): str(field["name"]) for field in metadata["custom_fields"]
            if field.get("data_type") in {"monetary", "integer", "float"}
        }
        dimensions = dict(GROUP_DIMENSIONS)
        dimensions.update({f"custom_field:{field['id']}": f"Custom Field: {field['name']}" for field in metadata["custom_fields"]})
        if user_input is not None:
            self._view.update(user_input)
            if self._edit_index is None:
                self._views.append(self._view)
            else:
                self._views[self._edit_index] = self._view
            return self._save()
        return self.async_show_form(step_id="view_metrics", data_schema=vol.Schema({
            vol.Required("count", default=self._view.get("count", True)): bool,
            vol.Required("attention", default=self._view.get("attention", False)): bool,
            vol.Required("attention_threshold", default=self._view.get("attention_threshold", 1)): vol.All(vol.Coerce(int), vol.Range(min=1)),
            vol.Optional("aggregate_fields", default=self._view.get("aggregate_fields", [])): cv.multi_select(custom_fields),
            vol.Required("group_by", default=self._view.get("group_by", "none")): vol.In(dimensions),
            vol.Required("secondary_group_by", default=self._view.get("secondary_group_by", "none")): vol.In(dimensions),
        }))
