"""Base entity for Paperless Workflows."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN


class PaperlessWorkflowEntity(CoordinatorEntity):
    """Base coordinator entity."""

    _attr_has_entity_name = True

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.entry.entry_id)},
            name="Paperless Workflows",
            manufacturer="Paperless-ngx",
            configuration_url=coordinator.client.base_url,
        )
