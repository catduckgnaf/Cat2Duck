"""Constants for the Toduck integration."""

from datetime import timedelta

DOMAIN = "toduck"

CONF_BASE_URL = "base_url"
CONF_TOKEN = "token"

DEFAULT_SCAN_INTERVAL = timedelta(minutes=1)

PLATFORMS = ["todo", "sensor"]
