"""Config flow for Toduck."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig, TextSelectorType

from .api import ToduckApiError, ToduckAuthError, ToduckApiClient
from .const import CONF_BASE_URL, CONF_TOKEN, DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_BASE_URL): TextSelector(TextSelectorConfig(type=TextSelectorType.URL)),
        vol.Required(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
    }
)


class ToduckConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Toduck."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for the server URL and a token, then validate both."""
        errors: dict[str, str] = {}
        if user_input is not None:
            base_url = str(user_input[CONF_BASE_URL]).rstrip("/")
            token = str(user_input[CONF_TOKEN])
            client = ToduckApiClient(async_get_clientsession(self.hass), base_url, token)
            try:
                await client.get_tasks()
            except ToduckAuthError:
                errors["base"] = "invalid_auth"
            except ToduckApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(base_url)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="Toduck",
                    data={CONF_BASE_URL: base_url, CONF_TOKEN: token},
                )
        return self.async_show_form(step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors)
