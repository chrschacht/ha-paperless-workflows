"""Coordinator for Paperless Workflows."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PaperlessApiError, PaperlessWorkflowClient
from .const import (
    CONF_API_KEY, CONF_DEFAULT_CURRENCY, CONF_SCAN_INTERVAL, CONF_VERIFY_SSL, CONF_VIEWS,
    DEFAULT_CURRENCY, DEFAULT_SCAN_INTERVAL, DOMAIN, default_views,
)

_LOGGER = logging.getLogger(__name__)


class PaperlessWorkflowCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Poll and aggregate all configured Paperless views."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        config = {**entry.data, **entry.options}
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(seconds=config.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)))
        self.entry = entry
        self.client = PaperlessWorkflowClient(async_get_clientsession(hass), config["url"], config[CONF_API_KEY], config.get(CONF_VERIFY_SSL, True))
        self.views = config.get(CONF_VIEWS, default_views())
        self.default_currency = config.get(CONF_DEFAULT_CURRENCY, DEFAULT_CURRENCY).upper()

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.client.fetch_views(self.views, self.default_currency)
        except PaperlessApiError as err:
            raise UpdateFailed(str(err)) from err
