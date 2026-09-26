import { activeCategories, type Category, type Repeat, type Task } from "./model";

export type CadenceDoc = {
  tasks: Task[];
  categories: Category[];
};

const REPEAT_KINDS = new Set(["none", "daily", "weekdays", "weekly", "monthly", "interval", "days"]);

function isRepeat(value: unknown): value is Repeat {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && REPEAT_KINDS.has(kind);
}

export function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Task>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return false;
  if (typeof t.notes !== "string") return false;
  if (!(t.categoryId === null || typeof t.categoryId === "string")) return false;
  if (!(t.date === null || (typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date)))) return false;
  if (!isRepeat(t.repeat)) return false;
  if (typeof t.done !== "boolean") return false;
  if (typeof t.createdAt !== "string" || typeof t.updatedAt !== "string") return false;
  return true;
}

export function isCategory(value: unknown): value is Category {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Category>;
  return typeof c.id === "string" && typeof c.name === "string" && typeof c.createdAt === "string" && typeof c.updatedAt === "string";
}

export function readDoc(value: unknown): CadenceDoc {
  if (!value || typeof value !== "object") return { tasks: [], categories: [] };
  const doc = value as { tasks?: unknown; categories?: unknown };
  return {
    tasks: Array.isArray(doc.tasks) ? doc.tasks.filter(isTask) : [],
    categories: Array.isArray(doc.categories) ? doc.categories.filter(isCategory) : [],
  };
}

export function mergeById<T extends { id: string; updatedAt: string; deleted?: boolean }>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of local) {
    const other = map.get(item.id);
    if (!other || item.updatedAt > other.updatedAt) map.set(item.id, item);
  }
  const cutoff = Date.now() - 30 * 86_400_000;
  return [...map.values()].filter((item) => {
    if (!item.deleted) return true;
    const time = new Date(item.updatedAt).getTime();
    return Number.isFinite(time) && time > cutoff;
  });
}

export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/$/, "");
    return path && path !== "/" ? url.origin + path : url.origin;
  } catch {
    return null;
  }
}

async function request(url: string, token: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new Error("Could not reach the server.");
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 180);
    throw new Error(text || `Server responded ${res.status}.`);
  }
  return res;
}

export async function pullDoc(url: string, token: string): Promise<CadenceDoc> {
  const res = await request(url, token, "/v1/state");
  return readDoc(await res.json());
}

export async function pushDoc(url: string, token: string, doc: CadenceDoc): Promise<void> {
  await request(url, token, "/v1/state", {
    method: "PUT",
    body: JSON.stringify({
      tasks: doc.tasks,
      categories: activeCategories(doc.categories).concat(doc.categories.filter((c) => c.deleted)),
    }),
  });
}

export async function checkServer(url: string, token: string): Promise<void> {
  await request(url, token, "/health");
  await pullDoc(url, token);
}
