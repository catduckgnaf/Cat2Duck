"""Unit tests for the coordinator-free mapping helpers."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "custom_components" / "toduck"))

from mappings import count_open, count_overdue, parse_due, task_status, todo_item_values  # noqa: E402

TODAY = date(2026, 10, 27)


def task(**overrides):
    base = {"id": "t1", "title": "A toduck", "date": None, "done": False}
    base.update(overrides)
    return base


class TestParseDue(unittest.TestCase):
    def test_valid_date(self):
        self.assertEqual(parse_due("2026-10-30"), date(2026, 10, 30))

    def test_null_and_garbage_are_no_date(self):
        self.assertIsNone(parse_due(None))
        self.assertIsNone(parse_due("30/10/2026"))
        self.assertIsNone(parse_due(20261030))


class TestStatus(unittest.TestCase):
    def test_done_maps_to_completed(self):
        self.assertEqual(task_status(task(done=True)), "completed")

    def test_open_maps_to_needs_action(self):
        self.assertEqual(task_status(task()), "needs_action")


class TestTodoItemValues(unittest.TestCase):
    def test_full_mapping(self):
        values = todo_item_values(task(date="2026-10-30"))
        self.assertEqual(values, {"uid": "t1", "summary": "A toduck", "status": "needs_action", "due": date(2026, 10, 30)})

    def test_done_without_date(self):
        values = todo_item_values(task(done=True))
        self.assertEqual(values["status"], "completed")
        self.assertIsNone(values["due"])


class TestCounts(unittest.TestCase):
    def setUp(self):
        self.tasks = [
            task(id="open-today", date="2026-10-27"),
            task(id="open-overdue", date="2026-10-20"),
            task(id="open-later", date="2026-11-01"),
            task(id="open-nodate"),
            task(id="done-overdue", date="2026-10-20", done=True),
            task(id="deleted-open", date="2026-10-20", deleted=True),
        ]

    def test_count_open_excludes_done_and_deleted(self):
        self.assertEqual(count_open(self.tasks), 4)

    def test_count_overdue_only_open_and_past_due(self):
        self.assertEqual(count_overdue(self.tasks, TODAY), 1)

    def test_nothing_overdue_on_the_due_date_itself(self):
        self.assertEqual(count_overdue([task(date="2026-10-27")], TODAY), 0)


if __name__ == "__main__":
    unittest.main()
