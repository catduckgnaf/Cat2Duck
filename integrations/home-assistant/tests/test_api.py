"""Unit tests for the standalone Toduck API client.

Run without Home Assistant installed:

    python3 -m unittest discover -s integrations/home-assistant/tests -v
    # or, where pytest exists:
    python3 -m pytest integrations/home-assistant/tests -q
"""

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "custom_components" / "toduck"))

from api import ToduckApiError, ToduckAuthError, ToduckApiClient, ToduckNotFoundError  # noqa: E402


class FakeResponse:
    def __init__(self, status, body=None):
        self.status = status
        self._body = body

    async def json(self):
        return self._body


class FakeRequestContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """An aiohttp-style session stub recording every request."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    def request(self, method, url, headers=None, json=None):
        self.requests.append({"method": method, "url": url, "headers": headers, "json": json})
        return FakeRequestContext(self._responses.pop(0))


def run(coro):
    return asyncio.run(coro)


class TestClient(unittest.TestCase):
    def make_client(self, responses):
        session = FakeSession(responses)
        return ToduckApiClient(session, "http://toduck.local:8793/", "secret-token"), session

    def test_base_url_trailing_slash_is_stripped(self):
        client, _ = self.make_client([])
        self.assertEqual(client.base_url, "http://toduck.local:8793")

    def test_get_tasks_sends_bearer_and_returns_tasks(self):
        tasks = [{"id": "t1", "title": "One"}, {"id": "t2", "title": "Two"}]
        client, session = self.make_client([FakeResponse(200, {"tasks": tasks})])
        self.assertEqual(run(client.get_tasks()), tasks)
        request = session.requests[0]
        self.assertEqual(request["method"], "GET")
        self.assertEqual(request["url"], "http://toduck.local:8793/v1/tasks")
        self.assertEqual(request["headers"]["Authorization"], "Bearer secret-token")

    def test_get_tasks_rejects_malformed_body(self):
        client, _ = self.make_client([FakeResponse(200, {"nope": []})])
        with self.assertRaises(ToduckApiError):
            run(client.get_tasks())

    def test_create_task_posts_only_given_fields(self):
        created = {"id": "t9", "title": "Book the dentist"}
        client, session = self.make_client([FakeResponse(201, created)])
        result = run(client.create_task("Book the dentist", date="2026-10-30"))
        self.assertEqual(result, created)
        request = session.requests[0]
        self.assertEqual(request["method"], "POST")
        self.assertEqual(request["json"], {"title": "Book the dentist", "date": "2026-10-30"})

    def test_update_task_patches_fields_including_done_and_null_date(self):
        client, session = self.make_client([FakeResponse(200, {"id": "t1", "done": True})])
        run(client.update_task("t1", done=True, date=None))
        request = session.requests[0]
        self.assertEqual(request["method"], "PATCH")
        self.assertEqual(request["url"], "http://toduck.local:8793/v1/tasks/t1")
        self.assertEqual(request["json"], {"done": True, "date": None})

    def test_delete_task(self):
        client, session = self.make_client([FakeResponse(200, {"id": "t1", "deleted": True})])
        run(client.delete_task("t1"))
        self.assertEqual(session.requests[0]["method"], "DELETE")
        self.assertEqual(session.requests[0]["url"], "http://toduck.local:8793/v1/tasks/t1")

    def test_401_raises_auth_error(self):
        client, _ = self.make_client([FakeResponse(401, {"error": "Unauthorized"})])
        with self.assertRaises(ToduckAuthError):
            run(client.get_tasks())

    def test_404_raises_not_found(self):
        client, _ = self.make_client([FakeResponse(404, {"error": "Task not found"})])
        with self.assertRaises(ToduckNotFoundError):
            run(client.delete_task("missing"))

    def test_500_raises_api_error(self):
        client, _ = self.make_client([FakeResponse(500, {"error": "nope"})])
        with self.assertRaises(ToduckApiError):
            run(client.get_tasks())

    def test_unreachable_server_raises_api_error(self):
        class BoomSession:
            def request(self, *args, **kwargs):
                raise ConnectionError("dns failed")

        client = ToduckApiClient(BoomSession(), "http://nowhere", "token")
        with self.assertRaises(ToduckApiError):
            run(client.get_tasks())


if __name__ == "__main__":
    unittest.main()
