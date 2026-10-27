import test from "node:test";
import assert from "node:assert/strict";
import { createUser, deleteUser, fetchMe, listUsers, normalizeServerUrl, mergeById, pullDoc, readDoc, syncDoc } from "./sync.ts";

test("normalizeServerUrl trims whitespace and handles trailing slashes", () => {
  assert.equal(normalizeServerUrl(""), "");
  assert.equal(normalizeServerUrl("   "), "");
  assert.equal(normalizeServerUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeServerUrl("https://todo.example.com/api/"), "https://todo.example.com/api");
  assert.equal(normalizeServerUrl("ftp://invalid.com"), null);
  assert.equal(normalizeServerUrl("not-a-url"), null);
});

test("readDoc extracts safe defaults and validates items strictly", () => {
  assert.deepEqual(readDoc(null), { tasks: [], categories: [], projects: [] });
  assert.deepEqual(readDoc({}), { tasks: [], categories: [], projects: [] });
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
    projects: [
      {
        id: "p1",
        name: "House",
        createdAt: "2026-09-27T00:00:00Z",
        updatedAt: "2026-09-27T00:00:00Z",
      },
    ],
  };
  const doc = readDoc(raw);
  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.categories.length, 1);
  assert.equal(doc.projects.length, 1);
  assert.equal(doc.projects[0]?.name, "House");
  assert.equal(doc.tasks[0]?.title, "Test Task");
  // Tasks from before projects existed read back with a null projectId.
  assert.equal(doc.tasks[0]?.projectId, null);
  // Tasks from before multi-user servers read back unowned and unshared.
  assert.equal(doc.tasks[0]?.ownerId, null);
  assert.deepEqual(doc.tasks[0]?.sharedWith, []);
});

test("readDoc keeps ownerId and sharedWith when present and rejects malformed ones", () => {
  const base = {
    id: "t1",
    title: "Owned",
    notes: "",
    categoryId: null,
    date: null,
    repeat: { kind: "none" },
    done: false,
    createdAt: "2026-09-27T00:00:00Z",
    updatedAt: "2026-09-27T00:00:00Z",
  };
  const doc = readDoc({ tasks: [{ ...base, ownerId: "user-1", sharedWith: ["user-2"] }], categories: [], projects: [] });
  assert.equal(doc.tasks[0]?.ownerId, "user-1");
  assert.deepEqual(doc.tasks[0]?.sharedWith, ["user-2"]);
  const bad = readDoc({ tasks: [{ ...base, sharedWith: "user-2" }], categories: [], projects: [] });
  assert.equal(bad.tasks.length, 0);
});

test("user directory helpers call the users endpoints with the caller token", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization: string | null; body?: string }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? "GET", authorization: headers.get("Authorization"), body: typeof init.body === "string" ? init.body : undefined });
    if (url.endsWith("/v1/me")) return new Response(JSON.stringify({ kind: "user", id: "u1", name: "Alice" }), { status: 200 });
    if (url.endsWith("/v1/users") && (init.method ?? "GET") === "GET") {
      return new Response(JSON.stringify([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob", tokenHash: "never-exposed" }]), { status: 200 });
    }
    if (url.endsWith("/v1/users") && init.method === "POST") {
      return new Response(JSON.stringify({ id: "u3", name: "Carol", token: "carol-secret-token" }), { status: 201 });
    }
    if (url.endsWith("/v1/users/u3") && init.method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  try {
    assert.deepEqual(await fetchMe("https://tasks.example.com", "alice-token"), { kind: "user", id: "u1", name: "Alice" });
    const directory = await listUsers("https://tasks.example.com", "alice-token");
    assert.equal(directory.length, 2);
    assert.equal(directory[0]?.name, "Alice");
    const created = await createUser("https://tasks.example.com", "admin-token", "Carol");
    assert.equal(created.token, "carol-secret-token");
    await deleteUser("https://tasks.example.com", "admin-token", "u3");
    assert.deepEqual(
      calls.map((call) => [call.method, call.url]),
      [
        ["GET", "https://tasks.example.com/v1/me"],
        ["GET", "https://tasks.example.com/v1/users"],
        ["POST", "https://tasks.example.com/v1/users"],
        ["DELETE", "https://tasks.example.com/v1/users/u3"],
      ],
    );
    assert.equal(calls[2]?.authorization, "Bearer admin-token");
    assert.equal(calls[2]?.body, JSON.stringify({ name: "Carol" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
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
      doc: { tasks: [], categories: [], projects: [] },
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
    const local = { tasks: [{ id: "2", title: "Local", notes: "", categoryId: null, projectId: null, date: null, repeat: { kind: "none" as const }, done: false, completedAt: null, createdAt: "2026-09-27T11:00:00Z", updatedAt: "2026-09-27T11:00:00Z", ownerId: null, sharedWith: [] }], categories: [], projects: [] };
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
