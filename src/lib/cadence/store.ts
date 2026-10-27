import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  activeCategories,
  activeProjects,
  completionPatch,
  formatWhen,
  makeSeed,
  normalizeRepeat,
  todayKey,
  type Category,
  type Project,
  type Repeat,
  type Task,
  type ViewId,
} from "./model.ts";
import { mergeById, mergeDocs, syncDoc, type CadenceDoc } from "./sync.ts";

export type Notice = {
  text: string;
  snapshot: CadenceDoc;
} | null;

type TaskInput = {
  title: string;
  notes: string;
  categoryId: string | null;
  projectId: string | null;
  date: string | null;
  repeat: Repeat;
};

type State = {
  tasks: Task[];
  categories: Category[];
  projects: Project[];
  seeded: boolean;
  hasHydrated: boolean;
  view: ViewId;
  focusDate: string;
  query: string;
  categoryFilter: string | null;
  projectFilter: string | null;
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
  setProjectFilter: (id: string | null) => void;
  setShowRepeating: (show: boolean) => void;
  setCompact: (compact: boolean) => void;
  clearFilters: () => void;
  dismissNotice: () => void;
  undo: () => void;
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, patch: Partial<TaskInput>, notice?: string) => void;
  setTaskSharing: (id: string, sharedWith: string[]) => void;
  moveTask: (id: string, date: string | null) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  addCategory: (name: string) => string | null;
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  addProject: (name: string) => string | null;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  setServer: (url: string, token: string) => void;
  importDoc: (doc: CadenceDoc) => void;
  resetSamples: () => void;
  clearDone: () => void;
};

function nowIso() {
  return new Date().toISOString();
}

function noticeOf(text: string, tasks: Task[], categories: Category[], projects: Project[]): Notice {
  return { text, snapshot: { tasks, categories, projects } };
}

export const useCadence = create<State>()(
  persist(
    (set, get) => ({
      tasks: [],
      categories: [],
      projects: [],
      seeded: false,
      hasHydrated: false,
      view: "feed",
      focusDate: "",
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
      setView: (view) => set({ view }),
      setFocusDate: (focusDate) => set({ focusDate, view: "day" }),
      setQuery: (query) => set({ query }),
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      setProjectFilter: (projectFilter) => set({ projectFilter }),
      setShowRepeating: (showRepeating) => set({ showRepeating }),
      setCompact: (compact) => set({ compact }),
      clearFilters: () => set({ query: "", categoryFilter: null, projectFilter: null, showRepeating: true }),
      dismissNotice: () => set({ notice: null }),
      undo: () => {
        const notice = get().notice;
        if (!notice) return;
        set({
          tasks: notice.snapshot.tasks,
          categories: notice.snapshot.categories,
          projects: notice.snapshot.projects ?? [],
          notice: null,
        });
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
          projectId: input.projectId ?? null,
          date: input.date,
          repeat: normalizeRepeat(input.repeat),
          done: false,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ownerId: null,
          sharedWith: [],
        };
        const prev = get();
        set({
          tasks: [task, ...prev.tasks],
          notice: noticeOf("Added", prev.tasks, prev.categories, prev.projects),
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
            projectId: patch.projectId === undefined ? task.projectId : patch.projectId,
            date: patch.date === undefined ? task.date : patch.date,
            repeat: patch.repeat ? normalizeRepeat(patch.repeat) : task.repeat,
            updatedAt: now,
          };
        });
        set({
          tasks,
          notice: notice ? noticeOf(notice, prev.tasks, prev.categories, prev.projects) : prev.notice,
        });
      },
      setTaskSharing: (id, sharedWith) => {
        const prev = get();
        const task = prev.tasks.find((item) => item.id === id);
        if (!task) return;
        const next = [...new Set(sharedWith)];
        if (JSON.stringify(next) === JSON.stringify(task.sharedWith ?? [])) return;
        const now = nowIso();
        set({
          tasks: prev.tasks.map((item) => (item.id === id ? { ...item, sharedWith: next, updatedAt: now } : item)),
          notice: noticeOf(next.length ? "Sharing updated" : "Sharing removed", prev.tasks, prev.categories, prev.projects),
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
          notice: noticeOf(date ? `Moved to ${formatWhen(date, today)}` : "Moved to later", prev.tasks, prev.categories, prev.projects),
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
          advanced && fields.date
            ? `Moved repeating toduck to ${formatWhen(fields.date, today)}`
            : fields.done
              ? "Completed"
              : "Restored";
        set({
          tasks: prev.tasks.map((item) => (item.id === id ? { ...item, ...fields, updatedAt: now } : item)),
          notice: noticeOf(text, prev.tasks, prev.categories, prev.projects),
        });
      },
      deleteTask: (id) => {
        const prev = get();
        const now = nowIso();
        set({
          tasks: prev.tasks.map((task) => (task.id === id ? { ...task, deleted: true, updatedAt: now } : task)),
          notice: noticeOf("Deleted", prev.tasks, prev.categories, prev.projects),
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
          notice: noticeOf("Category removed", prev.tasks, prev.categories, prev.projects),
        });
      },
      addProject: (name) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return null;
        const existing = activeProjects(get().projects).find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id;
        const now = nowIso();
        const id = crypto.randomUUID();
        set({
          projects: [...get().projects, { id, name: trimmed, createdAt: now, updatedAt: now }],
        });
        return id;
      },
      renameProject: (id, name) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return;
        const projects = get().projects;
        const current = projects.find((p) => p.id === id);
        if (!current || current.deleted || current.name === trimmed) return;
        const clash = activeProjects(projects).some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase());
        if (clash) return;
        const now = nowIso();
        set({
          projects: projects.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: now } : p)),
        });
      },
      deleteProject: (id) => {
        const prev = get();
        const now = nowIso();
        set({
          projects: prev.projects.map((p) => (p.id === id ? { ...p, deleted: true, updatedAt: now } : p)),
          tasks: prev.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null, updatedAt: now } : t)),
          projectFilter: prev.projectFilter === id ? null : prev.projectFilter,
          notice: noticeOf("Project removed", prev.tasks, prev.categories, prev.projects),
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
          projects: mergeById(prev.projects, doc.projects ?? []),
          seeded: true,
          notice: noticeOf("Imported", prev.tasks, prev.categories, prev.projects),
        });
      },
      resetSamples: () => {
        const prev = get();
        const seed = makeSeed(todayKey());
        set({
          tasks: seed.tasks,
          categories: seed.categories,
          projects: seed.projects,
          seeded: true,
          categoryFilter: null,
          projectFilter: null,
          notice: noticeOf("Samples restored", prev.tasks, prev.categories, prev.projects),
        });
      },
      clearDone: () => {
        const prev = get();
        const now = nowIso();
        const tasks = prev.tasks.map((task) => (task.done && !task.deleted ? { ...task, deleted: true, updatedAt: now } : task));
        set({ tasks, notice: noticeOf("Cleared finished toducks", prev.tasks, prev.categories, prev.projects) });
      },
    }),
    {
      name: "cadence",
      version: 5,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as {
          view?: ViewId;
          serverToken?: string;
          projects?: Project[];
          tasks?: Task[];
        };
        if (version < 2) state.view = "feed";
        if (version < 3) delete state.serverToken;
        if (version < 4) {
          // Projects arrived in v4; older payloads have none, and their
          // tasks have no projectId.
          state.projects = [];
          state.tasks = (state.tasks ?? []).map((task) => ({ ...task, projectId: task.projectId ?? null }));
        }
        if (version < 5) {
          // Ownership/sharing arrived in v5; older tasks are unowned and
          // shared with nobody.
          state.tasks = (state.tasks ?? []).map((task) => ({
            ...task,
            ownerId: task.ownerId ?? null,
            sharedWith: task.sharedWith ?? [],
          }));
        }
        return state;
      },
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        tasks: state.tasks,
        categories: state.categories,
        projects: state.projects,
        seeded: state.seeded,
        view: state.view,
        focusDate: state.focusDate,
        categoryFilter: state.categoryFilter,
        projectFilter: state.projectFilter,
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
      projects: seed.projects,
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
  const projects = state.projects ?? [];
  const tasks = state.tasks.map((task) => ({
    ...task,
    projectId: task.projectId === undefined ? null : task.projectId,
    ownerId: task.ownerId === undefined ? null : task.ownerId,
    sharedWith: task.sharedWith ?? [],
  }));
  const projectFilter =
    state.projectFilter && projects.some((p) => p.id === state.projectFilter && !p.deleted) ? state.projectFilter : null;
  useCadence.setState({ hasHydrated: true, focusDate, categoryFilter, projects, tasks, projectFilter });
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
let pendingSync = false;

export async function syncNow() {
  const initial = useCadence.getState();
  if (!initial.serverUrl || !initial.serverToken) return;
  if (pushing) {
    pendingSync = true;
    return;
  }

  pushing = true;
  useCadence.setState({ syncStatus: "syncing", syncError: null });

  try {
    while (true) {
      pendingSync = false;
      const snapshot = useCadence.getState();
      const merged = await syncDoc(snapshot.serverUrl, snapshot.serverToken, {
        tasks: snapshot.tasks,
        categories: snapshot.categories,
        projects: snapshot.projects,
      });

      const current = useCadence.getState();
      const currentDoc = { tasks: current.tasks, categories: current.categories, projects: current.projects };
      const combined = mergeDocs(currentDoc, merged);

      useCadence.setState({
        ...combined,
        syncStatus: "ok",
        syncError: null,
        lastSyncedAt: nowIso(),
      });

      if (!pendingSync) break;
    }
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
    if (state.tasks === prev.tasks && state.categories === prev.categories && state.projects === prev.projects) return;
    if (pushing) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void pushNow();
    }, 600);
  });
}
