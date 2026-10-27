import assert from "node:assert/strict";
import test from "node:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } satisfies Storage,
});

const { useCadence, syncNow } = await import("./store.ts");

function resetState() {
  localStorage.clear();
  useCadence.setState({
    tasks: [],
    categories: [],
    projects: [],
    seeded: true,
    hasHydrated: true,
    view: "feed",
    focusDate: "2026-09-28",
    query: "",
    categoryFilter: null,
    projectFilter: null,
    showRepeating: true,
    compact: false,
    serverUrl: "",
    serverToken: "",
    syncStatus: "off",
    syncError: null,
    lastSyncedAt: null,
    notice: null,
  });
}

test("disconnect clears browser credentials without deleting local tasks", () => {
  resetState();
  useCadence.getState().addTask({
    title: "Keep me",
    notes: "",
    categoryId: null,
    projectId: null,
    date: "2026-09-28",
    repeat: { kind: "none" },
  });
  useCadence.getState().setServer("https://tasks.example.com", "session-secret");
  useCadence.getState().setServer("", "");

  const state = useCadence.getState();
  assert.equal(state.serverUrl, "");
  assert.equal(state.serverToken, "");
  assert.equal(state.syncStatus, "off");
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0]?.title, "Keep me");
});

test("persisted state excludes the bearer token", () => {
  resetState();
  useCadence.getState().setServer("https://tasks.example.com", "session-secret");
  const options = useCadence.persist.getOptions();
  const persisted = options.partialize?.(useCadence.getState()) as Record<string, unknown>;

  assert.equal(persisted.serverUrl, "https://tasks.example.com");
  assert.equal("serverToken" in persisted, false);
});

test("concurrent local edits while sync is in flight are preserved", async () => {
  resetState();
  let releaseServer: () => void = () => {};
  const serverHeld = new Promise<void>((resolve) => {
    releaseServer = resolve;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.endsWith("/v1/state") && (!init?.method || init.method === "GET")) {
      await serverHeld;
      return new Response(JSON.stringify({ tasks: [], categories: [] }), {
        status: 200,
        headers: { ETag: '"0"' },
      });
    }
    if (url.endsWith("/v1/state") && init?.method === "PUT") {
      return new Response(JSON.stringify({ ok: true, revision: 1 }), {
        status: 200,
        headers: { ETag: '"1"' },
      });
    }
    return originalFetch(input, init);
  };

  try {
    useCadence.getState().setServer("https://tasks.example.com", "session-secret");
    const syncPromise = syncNow();

    useCadence.getState().addTask({
      title: "Concurrent local task",
      notes: "must not be wiped",
      categoryId: null,
      projectId: null,
      date: "2026-09-28",
      repeat: { kind: "none" },
    });

    releaseServer();
    await syncPromise;

    const state = useCadence.getState();
    assert.equal(state.syncStatus, "ok");
    assert.equal(state.tasks.some((t) => t.title === "Concurrent local task"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed synchronization records an actionable connection error", async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };
  try {
    useCadence.getState().setServer("https://tasks.example.com", "session-secret");
    await syncNow();
    const state = useCadence.getState();
    assert.equal(state.syncStatus, "error");
    assert.match(state.syncError ?? "", /Could not reach the server/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("projects mirror categories: create, dedupe, rename, assign, delete clears tasks", () => {
  resetState();
  const state = () => useCadence.getState();
  const id = state().addProject("House");
  assert.ok(id);
  assert.equal(state().addProject("house"), id);
  assert.equal(state().addProject("  "), null);
  state().renameProject(id!, "Home base");
  assert.equal(state().projects.find((p) => p.id === id)?.name, "Home base");

  state().addTask({
    title: "In a project",
    notes: "",
    categoryId: null,
    projectId: id,
    date: "2026-09-28",
    repeat: { kind: "none" },
  });
  assert.equal(state().tasks[0]?.projectId, id);

  // The assignment survives the persisted (partialized) shape.
  const options = useCadence.persist.getOptions();
  const persisted = options.partialize?.(state()) as { tasks: Array<{ projectId: string | null }>; projects: unknown[] };
  assert.equal(persisted.tasks[0]?.projectId, id);
  assert.equal(persisted.projects.length, 1);

  state().setProjectFilter(id);
  state().deleteProject(id!);
  assert.equal(state().tasks[0]?.projectId, null);
  assert.equal(state().projectFilter, null);
  assert.equal(state().projects[0]?.deleted, true);
});

test("migrating a v3 payload adds empty projects and a null projectId", () => {
  const options = useCadence.persist.getOptions();
  const migrate = options.migrate as unknown as (state: unknown, version: number) => {
    projects: unknown[];
    tasks: Array<{ projectId: string | null }>;
  };
  const migrated = migrate(
    {
      tasks: [
        {
          id: "old",
          title: "Old task",
          notes: "",
          categoryId: null,
          date: null,
          repeat: { kind: "none" },
          done: false,
          completedAt: null,
          createdAt: "a",
          updatedAt: "a",
        },
      ],
      categories: [],
    },
    3,
  );
  assert.deepEqual(migrated.projects, []);
  assert.equal(migrated.tasks[0]?.projectId, null);
});
