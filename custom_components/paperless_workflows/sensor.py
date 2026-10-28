"""Dynamic sensors for configurable Paperless views."""

from __future__ import annotations

from decimal import Decimal

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import MAX_ATTRIBUTE_BYTES
from .entity import PaperlessWorkflowEntity
from .normalization import normalize_lookup_name
from .views import bounded_documents, render_document, view_tag_colors


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    entities: list[SensorEntity] = []
    for view in coordinator.views:
        if not view.get("enabled", True):
            continue
        if view.get("count", True) or view.get("display_documents") or view.get("group_by", "none") != "none":
            entities.append(ViewSummarySensor(coordinator, view))
        entities.extend(ViewAggregateSensor(coordinator, view, name) for name in view.get("aggregate_fields", []))
    async_add_entities(entities)


class ViewSummarySensor(PaperlessWorkflowEntity, SensorEntity):
    """Count plus optional document and grouping details for one view."""

    _attr_native_unit_of_measurement = "Dokumente"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, view) -> None:
        super().__init__(coordinator)
        self._view = view
        self._attr_name = view["name"]
        self._attr_icon = view.get("icon", "mdi:file-document-multiple-outline")
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{view['id']}_summary"

    @property
    def _data(self):
        return self.coordinator.data["views"][self._view["id"]]

    @property
    def native_value(self):
        return self._data["count"]

    @property
    def extra_state_attributes(self):
        data = self._data
        attributes = {
            "view_id": self._view["id"], "paperless_url": self.coordinator.client.base_url,
            "missing_configuration": data["missing"],
        }
        attributes.update(view_tag_colors(self._view, self.coordinator.data["metadata"]))
        if self._view.get("group_by", "none") != "none":
            attributes["group_by"] = self._view["group_by"]
            attributes["secondary_group_by"] = self._view.get("secondary_group_by", "none")
            attributes["groups"] = data["groups"]
        if self._view.get("display_documents"):
            rendered = [
                render_document(
                    document, self._view.get("document_fields", []), self.coordinator.data["maps"],
                    self.coordinator.client.base_url, self._view.get("document_custom_fields", []),
                )
                for document in data["documents"]
            ]
            documents, truncated = bounded_documents(rendered, self._view.get("max_documents", 25), MAX_ATTRIBUTE_BYTES)
            attributes["documents"] = documents
            attributes["documents_shown"] = len(documents)
            attributes["documents_truncated"] = truncated
        return attributes


class ViewAggregateSensor(PaperlessWorkflowEntity, SensorEntity):
    """A selected numeric or monetary custom-field aggregate."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:sigma"

    def __init__(self, coordinator, view, field_name: str) -> None:
        super().__init__(coordinator)
        self._view = view
        self._field_name = field_name
        slug = normalize_lookup_name(field_name).replace(" ", "_")
        self._attr_name = f"{view['name']} · Summe {field_name}"
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{view['id']}_sum_{slug}"

    @property
    def _aggregate(self):
        aggregates = self.coordinator.data["views"][self._view["id"]]["aggregates"]
        return next((value for value in aggregates.values() if normalize_lookup_name(value["name"]) == normalize_lookup_name(self._field_name)), None)

    @property
    def available(self) -> bool:
        return super().available and self._aggregate is not None

    @property
    def device_class(self):
        return SensorDeviceClass.MONETARY if self._aggregate and self._aggregate["type"] == "monetary" else None

    @property
    def native_unit_of_measurement(self):
        return self.coordinator.default_currency if self._aggregate and self._aggregate["type"] == "monetary" else None

    @property
    def native_value(self):
        if not self._aggregate:
            return None
        key = self.coordinator.default_currency if self._aggregate["type"] == "monetary" else ""
        total: Decimal = self._aggregate["totals"].get(key, Decimal("0"))
        return float(total)

    @property
    def extra_state_attributes(self):
        if not self._aggregate:
            return {"custom_field": self._field_name, "missing": True}
        return {
            "custom_field": self._field_name,
            "sums_by_currency": {currency or "numeric": float(value) for currency, value in self._aggregate["totals"].items()},
            "invalid_values": self._aggregate["invalid_values"],
        }
