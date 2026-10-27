"""Toduck sensors: open and overdue toduck counts."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .coordinator import ToduckCoordinator
from .mappings import count_open, count_overdue


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the Toduck count sensors."""
    coordinator: ToduckCoordinator = entry.runtime_data
    async_add_entities(
        [
            ToduckOpenSensor(coordinator),
            ToduckOverdueSensor(coordinator),
        ]
    )


class _ToduckCountSensor(CoordinatorEntity[ToduckCoordinator], SensorEntity):
    _attr_has_entity_name = True
    _attr_icon = "mdi:duck"
    _attr_state_class = "measurement"

    def __init__(self, coordinator: ToduckCoordinator, key: str, name: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_{key}"
        self._attr_name = name


class ToduckOpenSensor(_ToduckCountSensor):
    """How many toducks are still open."""

    def __init__(self, coordinator: ToduckCoordinator) -> None:
        super().__init__(coordinator, "open", "Open toducks")

    @property
    def native_value(self) -> int:
        return count_open(self.coordinator.data or [])


class ToduckOverdueSensor(_ToduckCountSensor):
    """How many open toducks are past their date."""

    def __init__(self, coordinator: ToduckCoordinator) -> None:
        super().__init__(coordinator, "overdue", "Overdue toducks")

    @property
    def native_value(self) -> int:
        return count_overdue(self.coordinator.data or [], dt_util.now().date())
