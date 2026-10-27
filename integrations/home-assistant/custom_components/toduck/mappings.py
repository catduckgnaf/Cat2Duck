"""Mapping helpers between Toduck tasks and Home Assistant concepts.

No Home Assistant imports here either: todo.py and sensor.py build their
entities on top of these plain functions, and the unit tests exercise
them directly.
"""

from __future__ import annotations

from datetime import date


def parse_due(value: object) -> date | None:
    """A task's date is a YYYY-MM-DD string or null; anything else is no date."""
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def is_open(task: dict) -> bool:
    return not task.get("done") and not task.get("deleted")


def task_status(task: dict) -> str:
    """Home Assistant todo status for a task: 'completed' or 'needs_action'."""
    return "completed" if task.get("done") else "needs_action"


def todo_item_values(task: dict) -> dict:
    """The values a HA TodoItem is built from, for one stored task."""
    return {
        "uid": task.get("id"),
        "summary": task.get("title") or "",
        "status": task_status(task),
        "due": parse_due(task.get("date")),
    }


def count_open(tasks: list[dict]) -> int:
    return sum(1 for task in tasks if is_open(task))


def count_overdue(tasks: list[dict], today: date) -> int:
    """Open tasks whose due date is before today."""
    overdue = 0
    for task in tasks:
        if not is_open(task):
            continue
        due = parse_due(task.get("date"))
        if due is not None and due < today:
            overdue += 1
    return overdue
