import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServerUrl, mergeById, readDoc } from "./sync.ts";

test("normalizeServerUrl trims whitespace and handles trailing slashes", () => {
  assert.equal(normalizeServerUrl(""), "");
  assert.equal(normalizeServerUrl("   "), "");
  assert.equal(normalizeServerUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeServerUrl("https://todo.example.com/api/"), "https://todo.example.com/api");
  assert.equal(normalizeServerUrl("ftp://invalid.com"), null);
  assert.equal(normalizeServerUrl("not-a-url"), null);
});

test("readDoc extracts safe defaults and validates items strictly", () => {
  assert.deepEqual(readDoc(null), { tasks: [], categories: [] });
  assert.deepEqual(readDoc({}), { tasks: [], categories: [] });
  const raw = {
    tasks: [
      {
        id: "t1",
        title: "Test Task",
        notes: "Some notes",
        categoryId: null,
        date: "2026-09-27",
        repeat: { kind: "none" },
        done: false,
        createdAt: "2026-09-27T00:00:00Z",
        updatedAt: "2026-09-27T00:00:00Z",
      },
    ],
    categories: [
      {
        id: "c1",
        name: "Work",
        color: "#ffffff",
        createdAt: "2026-09-27T00:00:00Z",
        updatedAt: "2026-09-27T00:00:00Z",
      },
    ],
  };
  const doc = readDoc(raw);
  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.categories.length, 1);
  assert.equal(doc.tasks[0]?.title, "Test Task");
});

test("mergeById favors newer updatedAt timestamp", () => {
  const local = [
    { id: "1", title: "Local Old", updatedAt: "2026-09-27T10:00:00Z" },
    { id: "2", title: "Local Only", updatedAt: "2026-09-27T10:00:00Z" },
  ];
  const remote = [
    { id: "1", title: "Remote New", updatedAt: "2026-09-27T11:00:00Z" },
    { id: "3", title: "Remote Only", updatedAt: "2026-09-27T10:00:00Z" },
  ];
  const merged = mergeById(local, remote);
  const map = new Map(merged.map((i) => [i.id, i]));
  assert.equal(map.get("1")?.title, "Remote New");
  assert.equal(map.get("2")?.title, "Local Only");
  assert.equal(map.get("3")?.title, "Remote Only");
});
