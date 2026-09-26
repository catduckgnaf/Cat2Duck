import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  completionPatch,
  makeSeed,
  nextOccurrence,
  shownDate,
  visibleTasks,
  type Category,
  type Task,
} from "./model.ts";

describe("repeats", () => {
  it("schedules the next day, weekday, week, and month", () => {
    assert.equal(nextOccurrence("2026-09-25", { kind: "daily" }, "2026-09-25"), "2026-09-26");
    assert.equal(nextOccurrence("2026-09-25", { kind: "weekdays" }, "2026-09-25"), "2026-09-28");
    assert.equal(nextOccurrence("2026-09-25", { kind: "weekly" }, "2026-09-25"), "2026-10-02");
    assert.equal(nextOccurrence("2026-01-31", { kind: "monthly" }, "2026-01-31"), "2026-02-28");
  });

  it("keeps an interval on its cadence and honors chosen days", () => {
    assert.equal(
      nextOccurrence("2026-09-01", { kind: "interval", every: 3, unit: "day" }, "2026-09-01"),
      "2026-09-04",
    );
    assert.equal(
      nextOccurrence("2026-01-15", { kind: "interval", every: 2, unit: "month" }, "2026-01-15"),
      "2026-03-15",
    );
    assert.equal(
      nextOccurrence("2026-09-25", { kind: "days", days: [1, 3, 5] }, "2026-09-25"),
      "2026-09-28",
    );
  });

  it("finishes a future repeat after its due date, and skips missed overdue days", () => {
    const early = completionPatch(
      { date: "2026-10-02", repeat: { kind: "weekly" }, done: false },
      "2026-09-25",
      "2026-09-25T12:00:00.000Z",
    );
    assert.equal(early.date, "2026-10-09");
    assert.equal(early.advanced, true);
    assert.equal(early.done, false);

    const overdue = completionPatch(
      { date: "2026-09-20", repeat: { kind: "daily" }, done: false },
      "2026-09-25",
      "2026-09-25T12:00:00.000Z",
    );
    assert.equal(overdue.date, "2026-09-26");
  });

  it("keeps one row for a repeat, and a click moves that row to the next time", () => {
    const today = "2026-09-26";
    const task = { date: "2026-09-25", repeat: { kind: "weekdays" as const }, done: false };
    assert.equal(shownDate(task, today), "2026-09-25");
    const advanced = completionPatch(task, today, "2026-09-26T12:00:00.000Z");
    assert.equal(advanced.date, "2026-09-28");
    assert.equal(advanced.done, false);

    const daily = {
      id: "d",
      title: "Stretch",
      notes: "",
      categoryId: null,
      date: "2026-09-20",
      repeat: { kind: "daily" as const },
      done: false,
      completedAt: null,
      createdAt: "a",
      updatedAt: "a",
    };
    const refine = { query: "", categoryId: null, showRepeating: true };
    assert.equal(visibleTasks([daily], [], "overdue", "2026-09-25", "2026-09-25", refine).length, 1);
    assert.equal(visibleTasks([daily], [], "day", "2026-09-21", "2026-09-25", refine).length, 0);
    assert.equal(visibleTasks([daily], [], "day", "2026-09-25", "2026-09-25", refine).length, 0);
    assert.equal(visibleTasks([daily], [], "upcoming", "2026-09-25", "2026-09-25", refine).length, 0);
    const open = [
      daily,
      { ...daily, id: "today", date: "2026-09-25" },
      { ...daily, id: "later", date: null, repeat: { kind: "none" as const } },
    ];
    assert.equal(visibleTasks(open, [], "feed", "2026-09-25", "2026-09-25", refine).length, 3);
  });

  it("toggles one-time tasks without moving them", () => {
    const done = completionPatch(
      { date: "2026-09-25", repeat: { kind: "none" }, done: false },
      "2026-09-25",
      "2026-09-25T12:00:00.000Z",
    );
    assert.equal(done.done, true);
    assert.equal(done.date, "2026-09-25");
    assert.equal(done.advanced, false);
  });
});

describe("filters", () => {
  const categories: Category[] = [
    { id: "home", name: "Home", createdAt: "a", updatedAt: "a" },
    { id: "work", name: "Work", createdAt: "b", updatedAt: "b" },
  ];
  const tasks: Task[] = [
    {
      id: "1",
      title: "Pay the water bill",
      notes: "confirmation number goes here",
      categoryId: "home",
      date: "2026-09-23",
      repeat: { kind: "monthly" },
      done: false,
      completedAt: null,
      createdAt: "a",
      updatedAt: "a",
    },
    {
      id: "2",
      title: "Call the clinic",
      notes: "Thursday opening",
      categoryId: "work",
      date: "2026-09-25",
      repeat: { kind: "none" },
      done: false,
      completedAt: null,
      createdAt: "b",
      updatedAt: "b",
    },
  ];

  it("matches notes and category names, and can hide repeats", () => {
    const today = "2026-09-25";
    const byNote = visibleTasks(tasks, categories, "overdue", today, today, {
      query: "confirmation",
      categoryId: null,
      showRepeating: true,
    });
    assert.deepEqual(byNote.map((t) => t.id), ["1"]);

    const byCategory = visibleTasks(tasks, categories, "day", today, today, {
      query: "work",
      categoryId: null,
      showRepeating: true,
    });
    assert.deepEqual(byCategory.map((t) => t.id), ["2"]);

    const hidden = visibleTasks(tasks, categories, "overdue", today, today, {
      query: "",
      categoryId: "home",
      showRepeating: false,
    });
    assert.equal(hidden.length, 0);
  });
});

describe("seed", () => {
  it("builds dated examples around today, including notes and categories", () => {
    const today = "2026-09-25";
    const seed = makeSeed(today);
    assert.equal(seed.categories.length, 4);
    assert.ok(seed.tasks.some((t) => t.date === addDays(today, -2) && t.notes.includes("confirmation")));
    assert.ok(seed.tasks.some((t) => t.date === null));
    assert.ok(seed.tasks.every((t) => t.categoryId));
  });
});
