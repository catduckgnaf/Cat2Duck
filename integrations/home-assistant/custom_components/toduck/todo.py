"""Toduck toducks as a Home Assistant todo list."""

from __future__ import annotations

from datetime import date, datetime

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .coordinator import ToduckCoordinator
from .mappings import todo_item_values


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the Toduck todo list entity."""
    coordinator: ToduckCoordinator = entry.runtime_data
    async_add_entities([ToduckTodoList(coordinator)])


def _due_to_api(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


class ToduckTodoList(CoordinatorEntity[ToduckCoordinator], TodoListEntity):
    """A todo list backed by the Toduck tasks visible to the token."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
    )

    def __init__(self, coordinator: ToduckCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_todo"

    @property
    def todo_items(self) -> list[TodoItem]:
        items: list[TodoItem] = []
        for task in self.coordinator.data or []:
            values = todo_item_values(task)
            if values["uid"] is None:
                continue
            items.append(
                TodoItem(
                    uid=values["uid"],
                    summary=values["summary"],
                    status=TodoItemStatus.COMPLETED
                    if values["status"] == "completed"
                    else TodoItemStatus.NEEDS_ACTION,
                    due=values["due"],
                )
            )
        return items

    async def async_create_todo_item(self, item: TodoItem) -> None:
        await self.coordinator.client.create_task(
            item.summary or "",
            date=_due_to_api(item.due),
        )
        await self.coordinator.async_request_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        if item.uid is None:
            return
        await self.coordinator.client.update_task(
            item.uid,
            title=item.summary or "",
            date=_due_to_api(item.due),
            done=item.status == TodoItemStatus.COMPLETED,
        )
        await self.coordinator.async_request_refresh()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            await self.coordinator.client.delete_task(uid)
        await self.coordinator.async_request_refresh()
