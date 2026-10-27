"""Standalone client for the Toduck REST task API.

This module intentionally has no Home Assistant imports so it can be
unit-tested (and reused) outside Home Assistant. It talks to the REST
task API documented in selfhost/README.md:

    GET    /v1/tasks
    POST   /v1/tasks
    PATCH  /v1/tasks/<id>
    DELETE /v1/tasks/<id>

The session is any aiohttp-style object whose ``request()`` method
returns an async context manager yielding a response with ``.status``
and ``.json()`` — Home Assistant's shared aiohttp session qualifies, and
tests substitute a small fake.
"""

from __future__ import annotations

from typing import Any


class ToduckApiError(Exception):
    """The Toduck server returned an error or could not be reached."""


class ToduckAuthError(ToduckApiError):
    """The Toduck server rejected the token (HTTP 401)."""


class ToduckNotFoundError(ToduckApiError):
    """The task does not exist or is not visible to this token (HTTP 404)."""


class ToduckApiClient:
    """Client for one Toduck server + one token (admin or personal)."""

    def __init__(self, session: Any, base_url: str, token: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._token = token

    @property
    def base_url(self) -> str:
        return self._base_url

    async def _request(self, method: str, path: str, payload: dict | None = None) -> Any:
        headers = {"Authorization": f"Bearer {self._token}"}
        try:
            async with self._session.request(
                method, f"{self._base_url}{path}", headers=headers, json=payload
            ) as response:
                if response.status == 401:
                    raise ToduckAuthError("Toduck server rejected the token (401)")
                if response.status == 404:
                    raise ToduckNotFoundError("Task not found or not visible to this token (404)")
                if response.status >= 400:
                    raise ToduckApiError(f"Toduck server answered {response.status} for {method} {path}")
                if response.status == 204:
                    return None
                return await response.json()
        except (ToduckApiError,):
            raise
        except Exception as err:  # aiohttp errors, DNS, timeouts, bad JSON…
            raise ToduckApiError(f"Could not reach the Toduck server: {err}") from err

    async def get_tasks(self) -> list[dict]:
        """All tasks visible to this token, deleted ones excluded."""
        body = await self._request("GET", "/v1/tasks")
        tasks = body.get("tasks") if isinstance(body, dict) else None
        if not isinstance(tasks, list):
            raise ToduckApiError("Toduck server returned a malformed task list")
        return [task for task in tasks if isinstance(task, dict)]

    async def create_task(
        self,
        title: str,
        *,
        date: str | None = None,
        notes: str | None = None,
        category_id: str | None = None,
        project_id: str | None = None,
        repeat: dict | None = None,
    ) -> dict:
        """Create a toduck. The server assigns the id and timestamps."""
        payload: dict[str, Any] = {"title": title}
        if date is not None:
            payload["date"] = date
        if notes is not None:
            payload["notes"] = notes
        if category_id is not None:
            payload["categoryId"] = category_id
        if project_id is not None:
            payload["projectId"] = project_id
        if repeat is not None:
            payload["repeat"] = repeat
        return await self._request("POST", "/v1/tasks", payload)

    async def update_task(self, task_id: str, **fields: Any) -> dict:
        """Patch a toduck.

        Keyword arguments use the REST field names: title, date, notes,
        done, categoryId, projectId. Only the fields given are sent, so
        passing date=None explicitly clears the due date.
        """
        return await self._request("PATCH", f"/v1/tasks/{task_id}", dict(fields))

    async def delete_task(self, task_id: str) -> dict:
        """Delete (tombstone) a toduck. Owner or admin tokens only."""
        return await self._request("DELETE", f"/v1/tasks/{task_id}")
