import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCadenceServer, loadState, validateToken } from "./server.mjs";

const TOKEN = "0123456789abcdef0123456789abcdef";

async function withServer(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cat2duck-server-"));
  const dataPath = join(dir, "state.json");
  const server = createCadenceServer({ token: TOKEN, dataPath, staticDir: dir, ...options });
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
  assert.throws(() => validateToken(""), /CADENCE_TOKEN/);
  assert.throws(() => validateToken("change-me"), /CADENCE_TOKEN/);
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
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Cadence</title>");
    const response = await fetch(`${url}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  });
});

test("invalid primary state recovers from the last known good backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cat2duck-recovery-"));
  const dataPath = join(dir, "state.json");
  const backup = `${dataPath}.bak`;
  await writeFile(dataPath, "{truncated");
  await writeFile(backup, JSON.stringify({ revision: 4, tasks: [], categories: [] }));
  const state = loadState(dataPath);
  assert.equal(state.revision, 4);
  assert.deepEqual(JSON.parse(await readFile(dataPath, "utf8")), state);
});
