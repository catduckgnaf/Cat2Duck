"""The Toduck integration.

Connects Home Assistant to a self-hosted Toduck server through its
REST task API (see selfhost/README.md). One config entry = one server +
one token (the admin token, or a registered user's personal token —
recommended, so the integration sees exactly that user's toducks plus
any shared with them).
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ToduckApiClient
from .const import CONF_BASE_URL, CONF_TOKEN
from .coordinator import ToduckCoordinator

PLATFORMS: list[Platform] = [Platform.TODO, Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Toduck from a config entry."""
    client = ToduckApiClient(
        async_get_clientsession(hass),
        entry.data[CONF_BASE_URL],
        entry.data[CONF_TOKEN],
    )
    coordinator = ToduckCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
