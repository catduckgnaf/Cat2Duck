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
    seeded: true,
    hasHydrated: true,
    view: "feed",
    focusDate: "2026-09-28",
    query: "",
    categoryFilter: null,
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
