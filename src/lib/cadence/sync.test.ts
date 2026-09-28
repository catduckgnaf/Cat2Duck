import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServerUrl, mergeById, pullDoc, readDoc, syncDoc } from "./sync.ts";

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

test("pullDoc returns the server ETag revision", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ tasks: [], categories: [] }), { status: 200, headers: { ETag: '"7"' } });
  try {
    assert.deepEqual(await pullDoc("https://tasks.example.com", "secret"), {
      doc: { tasks: [], categories: [] },
      revision: '"7"',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("syncDoc retries one stale write after pulling and merging", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; revision: string | null }> = [];
  let getCount = 0;
  globalThis.fetch = async (_input, init = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    requests.push({ method, revision: headers.get("If-Match") });
    if (method === "GET") {
      getCount += 1;
      const title = getCount === 1 ? "Remote old" : "Remote concurrent";
      const updatedAt = getCount === 1 ? "2026-09-27T10:00:00Z" : "2026-09-27T12:00:00Z";
      return new Response(JSON.stringify({ tasks: [{ id: "1", title, notes: "", categoryId: null, date: null, repeat: { kind: "none" }, done: false, createdAt: updatedAt, updatedAt }], categories: [] }), { status: 200, headers: { ETag: getCount === 1 ? '"1"' : '"2"' } });
    }
    if (requests.filter((request) => request.method === "PUT").length === 1) {
      return new Response(JSON.stringify({ error: "State changed" }), { status: 409, headers: { ETag: '"2"' } });
    }
    return new Response(JSON.stringify({ ok: true, revision: 3 }), { status: 200, headers: { ETag: '"3"' } });
  };
  try {
    const local = { tasks: [{ id: "2", title: "Local", notes: "", categoryId: null, date: null, repeat: { kind: "none" as const }, done: false, completedAt: null, createdAt: "2026-09-27T11:00:00Z", updatedAt: "2026-09-27T11:00:00Z" }], categories: [] };
    const result = await syncDoc("https://tasks.example.com", "secret", local, 2);
    assert.equal(result.tasks.length, 2);
    assert.deepEqual(requests, [
      { method: "GET", revision: null },
      { method: "PUT", revision: '"1"' },
      { method: "GET", revision: null },
      { method: "PUT", revision: '"2"' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
