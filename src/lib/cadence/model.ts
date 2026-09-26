export type Repeat =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly" }
  | { kind: "monthly" }
  | { kind: "interval"; every: number; unit: "day" | "week" | "month" }
  | { kind: "days"; days: number[] };

export type Category = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};

export type Task = {
  id: string;
  title: string;
  notes: string;
  categoryId: string | null;
  date: string | null;
  repeat: Repeat;
  done: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};

export type ViewId = "feed" | "day" | "upcoming" | "overdue" | "later" | "repeats" | "done";

export type Refine = {
  query: string;
  categoryId: string | null;
  showRepeating: boolean;
};

export type Group = {
  key: string;
  label: string;
  tasks: Task[];
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey(now = new Date()): string {
  return toKey(now);
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function addDays(key: string, n: number): string {
  const dt = parseKey(key);
  dt.setDate(dt.getDate() + n);
  return toKey(dt);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000);
}

export function startOfWeek(key: string): string {
  const day = parseKey(key).getDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(key, delta);
}

export function weekdayName(key: string): string {
  return WEEKDAYS[parseKey(key).getDay()] ?? "";
}

export function monthDay(key: string): string {
  const d = parseKey(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function formatWhen(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const diff = daysBetween(today, key);
  const d = parseKey(key);
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()] ?? key;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function formatGroupLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const d = parseKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function upcomingWeekend(today: string): string {
  const day = parseKey(today).getDay();
  if (day === 0 || day === 6) return today;
  return addDays(today, 6 - day);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function normalizeRepeat(repeat: Repeat): Repeat {
  switch (repeat.kind) {
    case "interval": {
      const every = Math.min(99, Math.max(1, Math.floor(repeat.every) || 1));
      const unit = repeat.unit === "week" || repeat.unit === "month" ? repeat.unit : "day";
      return { kind: "interval", every, unit };
    }
    case "days": {
      const days = [...new Set(repeat.days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
      return { kind: "days", days };
    }
    case "none":
    case "daily":
    case "weekdays":
    case "weekly":
    case "monthly":
      return { kind: repeat.kind };
    default:
      return { kind: "none" };
  }
}

function matches(day: string, anchor: string, repeat: Repeat): boolean {
  const d = parseKey(day);
  const a = parseKey(anchor);
  switch (repeat.kind) {
    case "none":
      return false;
    case "daily":
      return true;
    case "weekdays":
      return d.getDay() !== 0 && d.getDay() !== 6;
    case "weekly":
      return d.getDay() === a.getDay();
    case "monthly":
      return d.getDate() === Math.min(a.getDate(), daysInMonth(d));
    case "interval": {
      const every = Math.max(1, Math.floor(repeat.every) || 1);
      if (repeat.unit === "day") {
        const diff = daysBetween(anchor, day);
        return diff >= 0 && diff % every === 0;
      }
      if (repeat.unit === "week") {
        const diff = daysBetween(anchor, day);
        return diff >= 0 && diff % (every * 7) === 0;
      }
      const months = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
      if (months < 0 || months % every !== 0) return false;
      return d.getDate() === Math.min(a.getDate(), daysInMonth(d));
    }
    case "days":
      return repeat.days.includes(d.getDay());
    default:
      return false;
  }
}

/** Next date strictly after `after`, keeping the original cadence. */
export function nextOccurrence(anchor: string, repeat: Repeat, after: string): string | null {
  const rule = normalizeRepeat(repeat);
  if (rule.kind === "none") return null;
  if (rule.kind === "days" && rule.days.length === 0) return null;
  let cursor = addDays(after, 1);
  for (let i = 0; i < 800; i++) {
    if (matches(cursor, anchor, rule)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

export type Completion = {
  date: string | null;
  done: boolean;
  completedAt: string | null;
  advanced: boolean;
};

/**
 * One-time tasks toggle done. A repeat is a single task: you only ever see
 * its next time. Checking it off moves that same task forward — past a
 * future due date if you finish early, or to the next time after today if
 * it was already late. Missed days are not extra copies.
 */
export function completionPatch(
  task: { date: string | null; repeat: Repeat; done: boolean },
  today: string,
  nowIso: string,
): Completion {
  if (task.repeat.kind === "none") {
    const done = !task.done;
    return { date: task.date, done, completedAt: done ? nowIso : null, advanced: false };
  }
  const anchor = task.date ?? today;
  const after = task.date && task.date > today ? task.date : today;
  const next = nextOccurrence(anchor, task.repeat, after);
  if (!next) return { date: task.date, done: true, completedAt: nowIso, advanced: false };
  return { date: next, done: false, completedAt: nowIso, advanced: true };
}

/** The one date this task occupies. Repeats are not expanded into a series. */
export function shownDate(task: { date: string | null; repeat: Repeat }, _today?: string): string | null {
  return task.date;
}

export function repeatLabel(repeat: Repeat, style: "short" | "long" = "long"): string {
  const rule = normalizeRepeat(repeat);
  switch (rule.kind) {
    case "none":
      return style === "short" ? "Once" : "Doesn't repeat";
    case "daily":
      return "Every day";
    case "weekdays":
      return "Weekdays";
    case "weekly":
      return "Every week";
    case "monthly":
      return "Every month";
    case "interval":
      return rule.every === 1 ? `Every ${rule.unit}` : `Every ${rule.every} ${rule.unit}s`;
    case "days":
      if (!rule.days.length) return "Choose days";
      return WEEKDAY_ORDER.filter((d) => rule.days.includes(d))
        .map((d) => DAY_SHORT[d])
        .join(" · ");
    default:
      return "Once";
  }
}

export function notePreview(notes: string): string {
  return notes.trim().split("\n").find((line) => line.trim())?.trim() ?? "";
}

export function activeCategories(categories: Category[]): Category[] {
  return categories.filter((c) => !c.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function categoryName(categories: Category[], id: string | null): string | null {
  if (!id) return null;
  return activeCategories(categories).find((c) => c.id === id)?.name ?? null;
}

function byCreatedDesc(a: Task, b: Task): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function visibleTasks(
  tasks: Task[],
  categories: Category[],
  view: ViewId,
  focusDate: string,
  today: string,
  refine: Refine,
): Task[] {
  const names = new Map(activeCategories(categories).map((c) => [c.id, c.name.toLowerCase()]));
  const q = refine.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (task.deleted) return false;
    if (view === "done") {
      if (!task.done) return false;
    } else if (task.done) {
      return false;
    } else {
      const when = shownDate(task, today);
      switch (view) {
        case "feed":
          break;
        case "day":
          if (when !== focusDate) return false;
          break;
        case "upcoming":
          if (!when || when <= today) return false;
          break;
        case "overdue":
          if (!when || when >= today) return false;
          break;
        case "later":
          if (when) return false;
          break;
        case "repeats":
          if (task.repeat.kind === "none") return false;
          break;
        default:
          return false;
      }
    }
    if (refine.categoryId && task.categoryId !== refine.categoryId) return false;
    if (!refine.showRepeating && task.repeat.kind !== "none" && view !== "repeats") return false;
    if (!q) return true;
    const blob = `${task.title}\n${task.notes}\n${names.get(task.categoryId ?? "") ?? ""}`.toLowerCase();
    return blob.includes(q);
  });
}

export function buildGroups(
  tasks: Task[],
  categories: Category[],
  view: ViewId,
  focusDate: string,
  today: string,
  refine: Refine,
): Group[] {
  const items = visibleTasks(tasks, categories, view, focusDate, today, refine);
  if (view === "feed") {
    const dated = items.map((task) => ({ task, when: shownDate(task, today) ?? "later" }));
    const overdue = dated
      .filter((item) => item.when !== "later" && item.when < today)
      .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : byCreatedDesc(a.task, b.task)));
    const rest = dated
      .filter((item) => item.when === "later" || item.when >= today)
      .sort((a, b) => {
        if (a.when === "later" && b.when !== "later") return 1;
        if (b.when === "later" && a.when !== "later") return -1;
        if (a.when < b.when) return -1;
        if (a.when > b.when) return 1;
        return byCreatedDesc(a.task, b.task);
      });
    const dates = [...new Set(rest.map((item) => item.when))];
    const groups: Group[] = [];
    if (overdue.length) {
      groups.push({ key: "overdue", label: "Overdue", tasks: overdue.map((item) => item.task) });
    }
    for (const date of dates) {
      groups.push({
        key: date,
        label: date === "later" ? "No date" : formatGroupLabel(date, today),
        tasks: rest.filter((item) => item.when === date).map((item) => item.task),
      });
    }
    return groups;
  }
  if (view === "upcoming") {
    const dated = items
      .map((task) => ({ task, when: shownDate(task, today) }))
      .filter((item): item is { task: Task; when: string } => !!item.when)
      .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
    const dates = [...new Set(dated.map((item) => item.when))];
    return dates.map((date) => ({
      key: date,
      label: date === "later" ? "No date" : formatGroupLabel(date, today),
      tasks: dated.filter((item) => item.when === date).map((item) => item.task).sort(byCreatedDesc),
    }));
  }
  if (view === "overdue") {
    const sorted = [...items].sort((a, b) => {
      if (a.date! < b.date!) return -1;
      if (a.date! > b.date!) return 1;
      return byCreatedDesc(a, b);
    });
    return sorted.length ? [{ key: "overdue", label: "", tasks: sorted }] : [];
  }
  if (view === "done") {
    const sorted = [...items].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return sorted.length ? [{ key: "done", label: "", tasks: sorted }] : [];
  }
  const sorted = [...items].sort(byCreatedDesc);
  return sorted.length ? [{ key: view, label: "", tasks: sorted }] : [];
}

export function countFor(
  tasks: Task[],
  categories: Category[],
  view: ViewId,
  focusDate: string,
  today: string,
  refine: Refine,
): number {
  return visibleTasks(tasks, categories, view, focusDate, today, refine).length;
}

function stamp(partial: Omit<Task, "createdAt" | "updatedAt" | "completedAt" | "done" | "deleted"> & Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    done: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function makeSeed(today: string): { tasks: Task[]; categories: Category[] } {
  const now = new Date().toISOString();
  const cat = (name: string, offset: number): Category => ({
    id: crypto.randomUUID(),
    name,
    createdAt: new Date(Date.now() + offset).toISOString(),
    updatedAt: now,
  });
  const home = cat("Home", 1);
  const work = cat("Work", 2);
  const health = cat("Health", 3);
  const personal = cat("Personal", 4);
  const task = (
    title: string,
    date: string | null,
    repeat: Repeat,
    categoryId: string,
    notes: string,
  ): Task =>
    stamp({
      id: crypto.randomUUID(),
      title,
      notes,
      categoryId,
      date,
      repeat,
    });
  const saturday = upcomingWeekend(today);
  return {
    categories: [home, work, health, personal],
    tasks: [
      task(
        "Stretch for ten minutes",
        today,
        { kind: "daily" },
        health.id,
        "Mat by the desk. Stop at the hips if the left side tugs.",
      ),
      task(
        "Clear the inbox",
        today,
        { kind: "weekdays" },
        work.id,
        "Reply, file, or defer. Leave the inbox empty, not sorted.",
      ),
      task(
        "Plan the week",
        today,
        { kind: "weekly" },
        work.id,
        "Pick three outcomes. Move anything that will not fit to another day.",
      ),
      task(
        "Return the library book",
        addDays(today, -1),
        { kind: "none" },
        personal.id,
        "The novel with the green sticker. Desk is on the second floor.",
      ),
      task(
        "Pay the water bill",
        addDays(today, -2),
        { kind: "monthly" },
        home.id,
        "Account is in the kitchen folder. After you pay, write the confirmation number here.",
      ),
      task(
        "Call the clinic",
        addDays(today, 1),
        { kind: "none" },
        health.id,
        "Ask about the Thursday opening. Insurance card is in the blue wallet.",
      ),
      task(
        "Market run",
        saturday === today ? addDays(today, 7) : saturday,
        { kind: "weekly" },
        home.id,
        "Eggs, greens, bread. Skip the stall that was out of change last time.",
      ),
      task(
        "Read twenty pages",
        null,
        { kind: "none" },
        personal.id,
        "Current book is on the nightstand. Stop at a chapter break.",
      ),
      task(
        "Team sync",
        today,
        { kind: "days", days: [1, 3, 5] },
        work.id,
        "Bring one blocker and one decision. Keep it to fifteen minutes.",
      ),
    ],
  };
}
