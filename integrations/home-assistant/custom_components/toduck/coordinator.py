"""DataUpdateCoordinator for Toduck."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import ToduckApiError, ToduckAuthError, ToduckApiClient
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class ToduckCoordinator(DataUpdateCoordinator[list[dict]]):
    """Poll the Toduck REST task API for the token's visible tasks."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: ToduckApiClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        self.client = client

    async def _async_update_data(self) -> list[dict]:
        try:
            return await self.client.get_tasks()
        except ToduckAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ToduckApiError as err:
            raise UpdateFailed(str(err)) from err
