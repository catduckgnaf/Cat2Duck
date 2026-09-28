import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  activeCategories,
  completionPatch,
  formatWhen,
  makeSeed,
  normalizeRepeat,
  todayKey,
  type Category,
  type Repeat,
  type Task,
  type ViewId,
} from "./model.ts";
import { mergeById, syncDoc, type CadenceDoc } from "./sync.ts";

export type Notice = {
  text: string;
  snapshot: CadenceDoc;
} | null;

type TaskInput = {
  title: string;
  notes: string;
  categoryId: string | null;
  date: string | null;
  repeat: Repeat;
};

type State = {
  tasks: Task[];
  categories: Category[];
  seeded: boolean;
  hasHydrated: boolean;
  view: ViewId;
  focusDate: string;
  query: string;
  categoryFilter: string | null;
  showRepeating: boolean;
  compact: boolean;
  serverUrl: string;
  serverToken: string;
  syncStatus: "off" | "syncing" | "ok" | "error";
  syncError: string | null;
  lastSyncedAt: string | null;
  notice: Notice;
  setView: (view: ViewId) => void;
  setFocusDate: (date: string) => void;
  setQuery: (query: string) => void;
  setCategoryFilter: (id: string | null) => void;
  setShowRepeating: (show: boolean) => void;
  setCompact: (compact: boolean) => void;
  clearFilters: () => void;
  dismissNotice: () => void;
  undo: () => void;
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, patch: Partial<TaskInput>, notice?: string) => void;
  moveTask: (id: string, date: string | null) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  addCategory: (name: string) => string | null;
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  setServer: (url: string, token: string) => void;
  importDoc: (doc: CadenceDoc) => void;
  resetSamples: () => void;
  clearDone: () => void;
};

function nowIso() {
  return new Date().toISOString();
}

function noticeOf(text: string, tasks: Task[], categories: Category[]): Notice {
  return { text, snapshot: { tasks, categories } };
}

export const useCadence = create<State>()(
  persist(
    (set, get) => ({
      tasks: [],
      categories: [],
      seeded: false,
      hasHydrated: false,
      view: "feed",
      focusDate: "",
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
      setView: (view) => set({ view }),
      setFocusDate: (focusDate) => set({ focusDate, view: "day" }),
      setQuery: (query) => set({ query }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      setShowRepeating: (showRepeating) => set({ showRepeating }),
      setCompact: (compact) => set({ compact }),
      clearFilters: () => set({ query: "", categoryFilter: null, showRepeating: true }),
      dismissNotice: () => set({ notice: null }),
      undo: () => {
        const notice = get().notice;
        if (!notice) return;
        set({ tasks: notice.snapshot.tasks, categories: notice.snapshot.categories, notice: null });
      },
      addTask: (input) => {
        const title = input.title.trim().slice(0, 200);
        if (!title) return;
        const now = nowIso();
        const task: Task = {
          id: crypto.randomUUID(),
          title,
          notes: input.notes.trim().slice(0, 20_000),
          categoryId: input.categoryId,
          date: input.date,
          repeat: normalizeRepeat(input.repeat),
          done: false,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const prev = get();
        set({
          tasks: [task, ...prev.tasks],
          notice: noticeOf("Added", prev.tasks, prev.categories),
        });
      },
      updateTask: (id, patch, notice) => {
        const prev = get();
        const now = nowIso();
        const tasks = prev.tasks.map((task) => {
          if (task.id !== id) return task;
          const title = (patch.title ?? task.title).trim().slice(0, 200) || task.title;
          return {
            ...task,
            title,
            notes: (patch.notes ?? task.notes).slice(0, 20_000),
            categoryId: patch.categoryId === undefined ? task.categoryId : patch.categoryId,
            date: patch.date === undefined ? task.date : patch.date,
            repeat: patch.repeat ? normalizeRepeat(patch.repeat) : task.repeat,
            updatedAt: now,
          };
        });
        set({
          tasks,
          notice: notice ? noticeOf(notice, prev.tasks, prev.categories) : prev.notice,
        });
      },
      moveTask: (id, date) => {
        const prev = get();
        const task = prev.tasks.find((item) => item.id === id);
        if (!task || task.date === date) return;
        const now = nowIso();
        const today = todayKey();
        set({
          tasks: prev.tasks.map((item) => (item.id === id ? { ...item, date, updatedAt: now } : item)),
          notice: noticeOf(date ? `Moved to ${formatWhen(date, today)}` : "Moved to later", prev.tasks, prev.categories),
        });
      },
      toggleTask: (id) => {
        const prev = get();
        const task = prev.tasks.find((item) => item.id === id);
        if (!task) return;
        const today = todayKey();
        const now = nowIso();
        const { advanced, ...fields } = completionPatch(task, today, now);
        const text =
          advanced && fields.date ? `Next is ${formatWhen(fields.date, today)}` : fields.done ? "Completed" : "Restored";
        set({
          tasks: prev.tasks.map((item) => (item.id === id ? { ...item, ...fields, updatedAt: now } : item)),
          notice: noticeOf(text, prev.tasks, prev.categories),
        });
      },
      deleteTask: (id) => {
        const prev = get();
        const now = nowIso();
        set({
          tasks: prev.tasks.map((task) => (task.id === id ? { ...task, deleted: true, updatedAt: now } : task)),
          notice: noticeOf("Deleted", prev.tasks, prev.categories),
        });
      },
      addCategory: (name) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return null;
        const existing = activeCategories(get().categories).find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id;
        const now = nowIso();
        const id = crypto.randomUUID();
        set({
          categories: [...get().categories, { id, name: trimmed, createdAt: now, updatedAt: now }],
        });
        return id;
      },
      renameCategory: (id, name) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return;
        const categories = get().categories;
        const current = categories.find((c) => c.id === id);
        if (!current || current.deleted || current.name === trimmed) return;
        const clash = activeCategories(categories).some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase());
        if (clash) return;
        const now = nowIso();
        set({
          categories: categories.map((c) => (c.id === id ? { ...c, name: trimmed, updatedAt: now } : c)),
        });
      },
      deleteCategory: (id) => {
        const prev = get();
        const now = nowIso();
        set({
          categories: prev.categories.map((c) => (c.id === id ? { ...c, deleted: true, updatedAt: now } : c)),
          tasks: prev.tasks.map((t) => (t.categoryId === id ? { ...t, categoryId: null, updatedAt: now } : t)),
          categoryFilter: prev.categoryFilter === id ? null : prev.categoryFilter,
          notice: noticeOf("Category removed", prev.tasks, prev.categories),
        });
      },
      setServer: (serverUrl, serverToken) =>
        set({
          serverUrl,
          serverToken,
          syncStatus: serverUrl && serverToken ? "off" : "off",
          syncError: null,
        }),
      importDoc: (doc) => {
        const prev = get();
        set({
          tasks: mergeById(prev.tasks, doc.tasks),
          categories: mergeById(prev.categories, doc.categories),
          seeded: true,
          notice: noticeOf("Imported", prev.tasks, prev.categories),
        });
      },
      resetSamples: () => {
        const prev = get();
        const seed = makeSeed(todayKey());
        set({
          tasks: seed.tasks,
          categories: seed.categories,
          seeded: true,
          categoryFilter: null,
          notice: noticeOf("Samples restored", prev.tasks, prev.categories),
        });
      },
      clearDone: () => {
        const prev = get();
        const now = nowIso();
        const tasks = prev.tasks.map((task) => (task.done && !task.deleted ? { ...task, deleted: true, updatedAt: now } : task));
        set({ tasks, notice: noticeOf("Cleared finished tasks", prev.tasks, prev.categories) });
      },
    }),
    {
      name: "cadence",
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { view?: ViewId; serverToken?: string };
        if (version < 2) state.view = "feed";
        if (version < 3) delete state.serverToken;
        return state;
      },
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        tasks: state.tasks,
        categories: state.categories,
        seeded: state.seeded,
        view: state.view,
        focusDate: state.focusDate,
        categoryFilter: state.categoryFilter,
        showRepeating: state.showRepeating,
        compact: state.compact,
        serverUrl: state.serverUrl,
      }),
    },
  ),
);

function finishHydration() {
  const state = useCadence.getState();
  const today = todayKey();
  if (!state.seeded) {
    const seed = makeSeed(today);
    useCadence.setState({
      tasks: seed.tasks,
      categories: seed.categories,
      seeded: true,
      focusDate: today,
      hasHydrated: true,
    });
    return;
  }
  const focusDate = !state.focusDate || state.focusDate < today ? today : state.focusDate;
  const categoryFilter =
    state.categoryFilter && state.categories.some((c) => c.id === state.categoryFilter && !c.deleted)
      ? state.categoryFilter
      : null;
  useCadence.setState({ hasHydrated: true, focusDate, categoryFilter });
}

if (useCadence.persist) {
  useCadence.persist.onFinishHydration(() => {
    finishHydration();
  });
}

export async function bootCadence() {
  if (typeof window === "undefined") return;
  if (useCadence.getState().hasHydrated) return;
  try {
    await useCadence.persist.rehydrate();
  } catch {
    finishHydration();
  }
  if (!useCadence.getState().hasHydrated) finishHydration();
}

let pushing = false;

export async function syncNow() {
  const state = useCadence.getState();
  if (!state.serverUrl || !state.serverToken) return;
  useCadence.setState({ syncStatus: "syncing", syncError: null });
  pushing = true;
  try {
    const latest = useCadence.getState();
    const merged = await syncDoc(latest.serverUrl, latest.serverToken, { tasks: latest.tasks, categories: latest.categories });
    useCadence.setState({ ...merged, syncStatus: "ok", syncError: null, lastSyncedAt: nowIso() });
  } catch (error) {
    useCadence.setState({
      syncStatus: "error",
      syncError: error instanceof Error ? error.message : "Could not reach the server.",
    });
  } finally {
    pushing = false;
  }
}

export async function pushNow() {
  await syncNow();
}

export function bindSync() {
  let timer: number | undefined;
  return useCadence.subscribe((state, prev) => {
    if (!state.hasHydrated || !state.serverUrl || !state.serverToken) return;
    if (state.tasks === prev.tasks && state.categories === prev.categories) return;
    if (pushing) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void pushNow();
    }, 600);
  });
}
