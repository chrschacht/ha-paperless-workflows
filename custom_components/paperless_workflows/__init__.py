"""Paperless Workflows integration."""

from __future__ import annotations

from copy import deepcopy

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import PLATFORMS
from .coordinator import PaperlessWorkflowCoordinator


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate the original three fixed workflows to configurable views."""
    version = entry.version
    if version == 1:
        from .const import CONF_VIEWS, default_views

        views = default_views()
        legacy = entry.data
        views[0]["filters"]["tags_all"] = [legacy.get("pay_tag", "Bezahlen")]
        views[0]["aggregate_fields"] = [legacy.get("amount_field", "Betrag")]
        views[1]["filters"]["tags_all"] = [legacy.get("ai_tag", "KI-prüfen")]
        views[2]["filters"]["tags_all"] = [legacy.get("ocr_tag", "ocrpruefen")]
        data = {**entry.data, CONF_VIEWS: views}
        hass.config_entries.async_update_entry(entry, data=data, version=2)
        version = 2
    if version == 2:
        from .const import CONF_VIEWS, default_views

        data = deepcopy(dict(entry.data))
        options = deepcopy(dict(entry.options))
        source = options if CONF_VIEWS in options else data
        views = deepcopy(source.get(CONF_VIEWS, default_views()))
        for view in views:
            if view.get("id") != "payments":
                continue
            fields = list(view.get("document_fields", []))
            if "created" not in fields:
                fields.append("created")
            if "custom_fields" not in fields:
                fields.append("custom_fields")
            custom_fields = list(view.get("document_custom_fields", []))
            if "Fälligkeitsdatum" not in custom_fields:
                custom_fields.append("Fälligkeitsdatum")
            view["document_fields"] = fields
            view["document_custom_fields"] = custom_fields
        source[CONF_VIEWS] = views
        hass.config_entries.async_update_entry(
            entry, data=data, options=options, version=3
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Paperless Workflows from a config entry."""
    coordinator = PaperlessWorkflowCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Paperless Workflows."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload after options change."""
    await hass.config_entries.async_reload(entry.entry_id)
