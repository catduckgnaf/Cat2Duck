import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createToduckServer, loadState, validateToken } from "./server.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef";

async function withServer(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "toduck-server-"));
  const dataPath = join(dir, "state.json");
  const server = createToduckServer({ token: TOKEN, dataPath, staticDir: dir, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run({ url, dataPath, dir });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function auth(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

test("validateToken rejects missing, default, and weak secrets", () => {
  assert.throws(() => validateToken(""), /TODUCK_TOKEN/);
  assert.throws(() => validateToken("change-me"), /TODUCK_TOKEN/);
  assert.throws(() => validateToken("short"), /32 characters/);
  assert.equal(validateToken(TOKEN), TOKEN);
});

test("health is public but state requires the configured token", async () => {
  await withServer(async ({ url }) => {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/v1/state`)).status, 401);
    assert.equal((await fetch(`${url}/v1/state`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
    const response = await fetch(`${url}/v1/state`, { headers: auth() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("etag"), '"0"');
  });
});

test("writes require the current revision and stale writers receive 409", async () => {
  await withServer(async ({ url }) => {
    const body = JSON.stringify({ tasks: [], categories: [] });
    const missing = await fetch(`${url}/v1/state`, { method: "PUT", headers: auth({ "Content-Type": "application/json" }), body });
    assert.equal(missing.status, 428);

    const first = await fetch(`${url}/v1/state`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }),
      body,
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("etag"), '"1"');

    const stale = await fetch(`${url}/v1/state`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }),
      body,
    });
    assert.equal(stale.status, 409);
  });
});

test("oversized bodies receive 413 without killing the server", async () => {
  await withServer(async ({ url }) => {
    const response = await fetch(`${url}/v1/state`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }),
      body: "x".repeat(1_500_001),
    });
    assert.equal(response.status, 413);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  });
});

test("CORS is absent by default and explicit origins are allowlisted", async () => {
  await withServer(async ({ url }) => {
    const rejected = await fetch(`${url}/v1/state`, { headers: auth({ Origin: "https://evil.example" }) });
    assert.equal(rejected.status, 403);
  });
  await withServer(
    async ({ url }) => {
      const allowed = await fetch(`${url}/v1/state`, { headers: auth({ Origin: "https://tasks.example" }) });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://tasks.example");
      assert.equal(allowed.headers.get("access-control-expose-headers"), "ETag");
      const health = await fetch(`${url}/health`, { headers: { Origin: "https://tasks.example" } });
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("access-control-allow-origin"), "https://tasks.example");
    },
    { allowedOrigins: ["https://tasks.example"] },
  );
});

test("security headers are returned for web responses", async () => {
  await withServer(async ({ url, dir }) => {
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Toduck</title>");
    const response = await fetch(`${url}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self' 'unsafe-inline'/);
  });
});

test("concurrent writes with the same revision result in exactly one winner and one 409", async () => {
  await withServer(async ({ url }) => {
    const makeBody = (title) => JSON.stringify({ tasks: [{ id: "t1", title, notes: "", categoryId: null, date: "2026-09-28", completedAt: null, repeat: { kind: "none" }, createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" }], categories: [] });
    const [res1, res2] = await Promise.all([
      fetch(`${url}/v1/state`, { method: "PUT", headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }), body: makeBody("First") }),
      fetch(`${url}/v1/state`, { method: "PUT", headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }), body: makeBody("Second") }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const finalState = await fetch(`${url}/v1/state`, { headers: auth() });
    assert.equal(finalState.headers.get("etag"), '"1"');
  });
});

test("write queue recovers from an individual persistence failure", async () => {
  await withServer(async ({ dir }) => {
    const badPath = join(dir, "cannot-write-here");
    await writeFile(badPath, "existing-file");
    const brokenServer = createToduckServer({ token: TOKEN, dataPath: join(badPath, "nested.json"), staticDir: dir });
    await new Promise((resolve) => brokenServer.listen(0, "127.0.0.1", resolve));
    const brokenUrl = `http://127.0.0.1:${brokenServer.address().port}`;
    try {
      const failed = await fetch(`${brokenUrl}/v1/state`, {
        method: "PUT",
        headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }),
        body: JSON.stringify({ tasks: [], categories: [] }),
      });
      assert.equal(failed.status, 500);

      const stale = await fetch(`${brokenUrl}/v1/state`, {
        method: "PUT",
        headers: auth({ "Content-Type": "application/json", "If-Match": '"999"' }),
        body: JSON.stringify({ tasks: [], categories: [] }),
      });
      assert.equal(stale.status, 409);
    } finally {
      await new Promise((resolve, reject) => brokenServer.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

test("invalid primary state recovers from the last known good backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toduck-recovery-"));
  const dataPath = join(dir, "state.json");
  const backup = `${dataPath}.bak`;
  await writeFile(dataPath, "{truncated");
  await writeFile(backup, JSON.stringify({ revision: 4, tasks: [], categories: [] }));
  const state = loadState(dataPath);
  assert.equal(state.revision, 4);
  assert.deepEqual(JSON.parse(await readFile(dataPath, "utf8")), state);
});

const stamp = "2026-09-28T00:00:00.000Z";
function makeTask(id, title, extra = {}) {
  return {
    id,
    title,
    notes: "",
    categoryId: null,
    projectId: null,
    date: null,
    repeat: { kind: "none" },
    done: false,
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    ownerId: null,
    sharedWith: [],
    ...extra,
  };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function putState(url, token, revision, body) {
  return fetch(`${url}/v1/state`, {
    method: "PUT",
    headers: { ...bearer(token), "Content-Type": "application/json", "If-Match": `"${revision}"` },
    body: JSON.stringify(body),
  });
}

async function getState(url, token) {
  const response = await fetch(`${url}/v1/state`, { headers: bearer(token) });
  assert.equal(response.status, 200);
  return { body: await response.json(), revision: Number(response.headers.get("etag").replaceAll('"', "")) };
}

async function createUser(url, name) {
  const response = await fetch(`${url}/v1/users`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("admin creates users; only the token hash is stored and the raw token is shown once", async () => {
  await withServer(async ({ url, dataPath }) => {
    const created = await createUser(url, "Teammate");
    assert.equal(created.name, "Teammate");
    assert.ok(created.id);
    assert.ok(created.token.length >= 32);

    const onDisk = await readFile(dataPath, "utf8");
    assert.ok(!onDisk.includes(created.token), "raw personal token must never be persisted");
    const stored = JSON.parse(onDisk);
    assert.equal(stored.users.length, 1);
    assert.equal(stored.users[0].id, created.id);
    assert.match(stored.users[0].tokenHash, /^[0-9a-f]{64}$/);

    // The directory lists names/ids only, for any authenticated caller.
    const asUser = await fetch(`${url}/v1/users`, { headers: bearer(created.token) });
    assert.equal(asUser.status, 200);
    assert.deepEqual(await asUser.json(), [{ id: created.id, name: "Teammate" }]);
    assert.equal((await fetch(`${url}/v1/users`)).status, 401);

    // A user token cannot create users; /v1/me reports who a token is.
    const forbidden = await fetch(`${url}/v1/users`, {
      method: "POST",
      headers: { ...bearer(created.token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await (await fetch(`${url}/v1/me`, { headers: bearer(created.token) })).json(), {
      kind: "user",
      id: created.id,
      name: "Teammate",
    });
    assert.deepEqual(await (await fetch(`${url}/v1/me`, { headers: auth() })).json(), { kind: "admin" });
  });
});

test("user tokens see only their own and shared tasks; legacy tasks stay the admin's", async () => {
  await withServer(async ({ url }) => {
    const alice = await createUser(url, "Alice");
    const bob = await createUser(url, "Bob");
    let revision = 0;
    // Alice creates a private task through scoped sync (forged owner ignored).
    let res = await putState(url, alice.token, revision, {
      tasks: [makeTask("a1", "Alice private", { ownerId: bob.id })],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);
    revision = 1;
    // Bob creates his own task.
    res = await putState(url, bob.token, revision, { tasks: [makeTask("b1", "Bob private")], categories: [], projects: [] });
    assert.equal(res.status, 200);
    revision = 2;
    // Admin adds a legacy unowned task.
    res = await putState(url, TOKEN, revision, {
      tasks: [makeTask("a1", "Alice private", { ownerId: alice.id }), makeTask("b1", "Bob private", { ownerId: bob.id }), makeTask("legacy", "Legacy")],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);

    const adminView = await getState(url, TOKEN);
    assert.deepEqual(adminView.body.tasks.map((t) => t.id).sort(), ["a1", "b1", "legacy"]);
    assert.equal(adminView.body.tasks.find((t) => t.id === "a1").ownerId, alice.id);

    const aliceView = await getState(url, alice.token);
    assert.deepEqual(aliceView.body.tasks.map((t) => t.id), ["a1"]);
    const bobView = await getState(url, bob.token);
    assert.deepEqual(bobView.body.tasks.map((t) => t.id), ["b1"]);
  });
});

test("sharing makes a task visible and editable by the other user, who cannot delete, re-own, or re-share it", async () => {
  await withServer(async ({ url }) => {
    const alice = await createUser(url, "Alice");
    const bob = await createUser(url, "Bob");
    // Alice owns a1 and shares it with Bob.
    let res = await putState(url, alice.token, 0, {
      tasks: [makeTask("a1", "Shared chore", { sharedWith: [bob.id] })],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);

    const bobView = await getState(url, bob.token);
    assert.deepEqual(bobView.body.tasks.map((t) => t.id), ["a1"]);

    // Bob edits the shared task's title but tries to steal ownership,
    // re-share it to nobody, and also sends Alice an unrelated forgery.
    res = await putState(url, bob.token, bobView.revision, {
      tasks: [makeTask("a1", "Shared chore, done by Bob", { ownerId: bob.id, sharedWith: [], done: true })],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);
    let adminView = await getState(url, TOKEN);
    const shared = adminView.body.tasks.find((t) => t.id === "a1");
    assert.equal(shared.title, "Shared chore, done by Bob");
    assert.equal(shared.done, true);
    assert.equal(shared.ownerId, alice.id);
    assert.deepEqual(shared.sharedWith, [bob.id]);

    // A tombstone from Bob (how the Web client deletes) is also ignored.
    res = await putState(url, bob.token, adminView.revision, {
      tasks: [makeTask("a1", "Shared chore, done by Bob", { ownerId: alice.id, sharedWith: [bob.id], done: true, deleted: true })],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);
    adminView = await getState(url, TOKEN);
    assert.equal(adminView.body.tasks.find((t) => t.id === "a1").deleted, undefined);

    // Bob's PUT omitting the shared task leaves it untouched.
    res = await putState(url, bob.token, adminView.revision, { tasks: [], categories: [], projects: [] });
    assert.equal(res.status, 200);
    adminView = await getState(url, TOKEN);
    assert.deepEqual(adminView.body.tasks.map((t) => t.id), ["a1"]);

    // Alice's PUT omitting her own task deletes it.
    const aliceView = await getState(url, alice.token);
    res = await putState(url, alice.token, aliceView.revision, { tasks: [], categories: [], projects: [] });
    assert.equal(res.status, 200);
    adminView = await getState(url, TOKEN);
    assert.deepEqual(adminView.body.tasks, []);
  });
});

test("a user PUT preserves other users' tasks exactly, and a deleted user loses access and shares", async () => {
  await withServer(async ({ url }) => {
    const alice = await createUser(url, "Alice");
    const bob = await createUser(url, "Bob");
    const bobTask = makeTask("b1", "Bob's exact task", { notes: "keep me byte-for-byte", sharedWith: [alice.id] });
    let res = await putState(url, bob.token, 0, { tasks: [bobTask], categories: [], projects: [] });
    assert.equal(res.status, 200);

    // Alice syncs (payload contains only what she can see, plus her own new task).
    const aliceView = await getState(url, alice.token);
    res = await putState(url, alice.token, aliceView.revision, {
      tasks: [bobTask, makeTask("a1", "Alice task")],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);
    const adminView = await getState(url, TOKEN);
    assert.deepEqual(adminView.body.tasks.find((t) => t.id === "b1"), { ...bobTask, ownerId: bob.id });

    // Deleting Bob revokes his token. (His own tasks stay stored for the
    // admin; shares *to* him are stripped — covered by Carol below.)
    const deleted = await fetch(`${url}/v1/users/${bob.id}`, { method: "DELETE", headers: auth() });
    assert.equal(deleted.status, 200);
    assert.equal((await fetch(`${url}/v1/state`, { headers: bearer(bob.token) })).status, 401);

    // Alice shares one of her tasks with Carol; deleting Carol unshares it.
    const carol = await createUser(url, "Carol");
    const before = await getState(url, TOKEN);
    res = await putState(url, TOKEN, before.revision, {
      tasks: [...before.body.tasks, makeTask("a2", "Alice shares with Carol", { ownerId: alice.id, sharedWith: [carol.id] })],
      categories: [],
      projects: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await getState(url, carol.token)).body.tasks.map((t) => t.id), ["a2"]);
    const removedCarol = await fetch(`${url}/v1/users/${carol.id}`, { method: "DELETE", headers: auth() });
    assert.equal(removedCarol.status, 200);
    const finalView = await getState(url, TOKEN);
    assert.deepEqual(finalView.body.tasks.find((t) => t.id === "a2").sharedWith, []);
    assert.equal((await fetch(`${url}/v1/state`, { headers: bearer(carol.token) })).status, 401);
    assert.equal((await fetch(`${url}/v1/users/${carol.id}`, { method: "DELETE", headers: auth() })).status, 404);
  });
});

test("projects round-trip, and payloads without projects still work and do not wipe them", async () => {
  await withServer(async ({ url }) => {
    const project = { id: "p1", name: "House", createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" };
    const withProjects = await fetch(`${url}/v1/state`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/json", "If-Match": '"0"' }),
      body: JSON.stringify({ tasks: [], categories: [], projects: [project] }),
    });
    assert.equal(withProjects.status, 200);

    const read = await fetch(`${url}/v1/state`, { headers: auth() });
    const body = await read.json();
    assert.deepEqual(body.projects, [project]);

    // An older client PUTs without projects: accepted, projects preserved.
    const legacy = await fetch(`${url}/v1/state`, {
      method: "PUT",
      headers: auth({ "Content-Type": "application/json", "If-Match": '"1"' }),
      body: JSON.stringify({ tasks: [], categories: [] }),
    });
    assert.equal(legacy.status, 200);
    const after = await (await fetch(`${url}/v1/state`, { headers: auth() })).json();
    assert.deepEqual(after.projects, [project]);
  });

  // A fresh server answers projects as an empty array.
  await withServer(async ({ url }) => {
    const body = await (await fetch(`${url}/v1/state`, { headers: auth() })).json();
    assert.deepEqual(body.projects, []);
  });
});
