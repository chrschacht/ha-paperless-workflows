"""Attention indicators for configurable Paperless views."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import PaperlessWorkflowEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    entities: list[BinarySensorEntity] = [
        ViewAttentionSensor(coordinator, view)
        for view in coordinator.views if view.get("enabled", True) and view.get("attention")
    ]
    entities.append(ConfigurationIssueSensor(coordinator))
    async_add_entities(entities)


class ViewAttentionSensor(PaperlessWorkflowEntity, BinarySensorEntity):
    """On when a view reaches its configured document threshold."""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator, view) -> None:
        super().__init__(coordinator)
        self._view = view
        self._attr_name = f"{view['name']} · Hinweis"
        self._attr_icon = view.get("icon", "mdi:alert-circle-outline")
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{view['id']}_attention"

    @property
    def is_on(self) -> bool:
        return self.coordinator.data["views"][self._view["id"]]["count"] >= self._view.get("attention_threshold", 1)

    @property
    def extra_state_attributes(self):
        count = self.coordinator.data["views"][self._view["id"]]["count"]
        return {"count": count, "threshold": self._view.get("attention_threshold", 1), "view_id": self._view["id"]}


class ConfigurationIssueSensor(PaperlessWorkflowEntity, BinarySensorEntity):
    """On when configured Paperless metadata cannot be found."""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_name = "Konfigurationshinweis"
    _attr_icon = "mdi:cog-alert-outline"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_configuration_issue"

    @property
    def is_on(self) -> bool:
        return bool(self.coordinator.data["missing"])

    @property
    def extra_state_attributes(self):
        return {"missing": self.coordinator.data["missing"]}
