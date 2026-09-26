import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { Detail } from "@/components/cadence/detail";
import { CategoriesDialog, SettingsDialog } from "@/components/cadence/settings";
import { Button, Chip, DateChooser, Modal, RepeatChooser } from "@/components/cadence/ui";
import {
  activeCategories,
  addDays,
  buildGroups,
  categoryName,
  countFor,
  formatWhen,
  monthDay,
  notePreview,
  repeatLabel,
  shownDate,
  startOfWeek,
  todayKey,
  weekdayName,
  DAY_SHORT,
  type Repeat,
  type Task,
  type ViewId,
} from "@/lib/cadence/model";
import { bindSync, syncNow, useCadence } from "@/lib/cadence/store";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "day", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "later", label: "Later" },
  { id: "repeats", label: "Repeats" },
  { id: "done", label: "Done" },
];

export function CadenceShell() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-6xl flex-col bg-paper px-5 pt-8">
      <div className="h-4 w-20 rounded-full bg-paper-2" />
      <div className="mt-4 h-10 w-48 rounded-xl bg-paper-2" />
      <div className="mt-8 h-24 rounded-2xl bg-card" />
      <div className="mt-3 h-24 rounded-2xl bg-card" />
    </div>
  );
}

export function CadenceScreen() {
  const state = useCadence();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  useEffect(() => {
    const unsub = bindSync();
    void syncNow();
    return unsub;
  }, []);

  useEffect(() => {
    if (!state.notice) return;
    const id = window.setTimeout(() => state.dismissNotice(), 5000);
    return () => window.clearTimeout(id);
  }, [state.notice, state.dismissNotice]);

  const today = todayKey();
  const focus = state.focusDate || today;
  const refine = {
    query: state.query,
    categoryId: state.categoryFilter,
    showRepeating: state.showRepeating,
  };
  const groups = buildGroups(state.tasks, state.categories, state.view, focus, today, refine);
  const categories = activeCategories(state.categories);
  const filtering = state.query.trim().length > 0 || !!state.categoryFilter || !state.showRepeating;
  const overdueCount = countFor(state.tasks, state.categories, "overdue", focus, today, refine);
  const header = headerCopy(state.view, focus, today);
  const openCount = countFor(state.tasks, state.categories, state.view, focus, today, refine);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-6xl flex-col overflow-hidden bg-paper text-ink">
      <header className="shrink-0 px-5 pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted">Cadence</p>
          <div className="flex items-center">
            <Button variant="ghost" className="px-3" onClick={() => setCategoriesOpen(true)}>
              Categories
            </Button>
            <button
              type="button"
              className="relative grid size-11 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-5" />
              {state.serverUrl ? (
                <span
                  className={`absolute right-2 top-2 size-2 rounded-full ${state.syncStatus === "error" ? "bg-danger" : "bg-sage"}`}
                />
              ) : null}
            </button>
          </div>
        </div>
        <h1 className="font-display text-display text-ink">{header.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {header.sub}
          <span className="tabular-nums"> · {openCount} {state.view === "done" ? "finished" : "open"}</span>
        </p>
      </header>

      <div className="no-scrollbar mt-4 flex shrink-0 gap-2 overflow-x-auto px-5 pb-2">
        {VIEWS.map((view) => {
          const active = state.view === view.id;
          const count = countFor(
            state.tasks,
            state.categories,
            view.id,
            view.id === "day" ? focus : today,
            today,
            refine,
          );
          const label = view.id === "day" ? (focus === today ? "Today" : formatWhen(focus, today)) : view.label;
          return (
            <Chip key={view.id} active={active} aria-current={active ? "true" : undefined} onClick={() => state.setView(view.id)}>
              {label}
              <span className="ml-2 tabular-nums">{count}</span>
            </Chip>
          );
        })}
        {state.view !== "repeats" ? (
          <Chip active={!state.showRepeating} aria-pressed={!state.showRepeating} onClick={() => state.setShowRepeating(!state.showRepeating)}>
            {state.showRepeating ? "Hide repeats" : "Repeats hidden"}
          </Chip>
        ) : null}
        <Chip active={state.compact} aria-pressed={state.compact} onClick={() => state.setCompact(!state.compact)}>
          {state.compact ? "Compact on" : "Compact"}
        </Chip>
      </div>

      <div className="shrink-0 px-5 pb-2">
        <input
          className="field"
          type="search"
          value={state.query}
          onChange={(event) => state.setQuery(event.target.value)}
          placeholder="Filter tasks"
          aria-label="Filter tasks"
        />
      </div>

      <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-5 pb-3">
        <Chip active={!state.categoryFilter} onClick={() => state.setCategoryFilter(null)}>
          All
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            active={state.categoryFilter === category.id}
            onClick={() => state.setCategoryFilter(state.categoryFilter === category.id ? null : category.id)}
          >
            {category.name}
          </Chip>
        ))}
        {filtering ? (
          <Button variant="ghost" onClick={state.clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {state.view === "day" ? (
        <WeekStrip
          focus={focus}
          today={today}
          tasks={state.tasks}
          categoryFilter={state.categoryFilter}
          showRepeating={state.showRepeating}
          onSelect={state.setFocusDate}
        />
      ) : null}

      {state.view === "day" && focus === today && overdueCount > 0 ? (
        <div className="shrink-0 px-5 pb-3">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between rounded-2xl bg-danger-soft px-4 text-sm font-medium text-danger"
            onClick={() => state.setView("overdue")}
          >
            <span className="tabular-nums">{overdueCount} overdue</span>
            <span>Show</span>
          </button>
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto pb-4">
        {state.view === "feed" && groups.length > 0 ? <FeedColumns /> : null}
        {groups.length === 0 ? (
          <Empty view={state.view} filtering={filtering} onClear={state.clearFilters} />
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              {group.label ? (
                <h2 className={`px-5 font-display text-ink ${state.compact ? "pt-3 text-lg" : "pt-4 text-2xl"} ${group.key === "overdue" ? "text-danger" : ""}`}>
                  {group.label}
                </h2>
              ) : null}
              <ul>
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    category={categoryName(state.categories, task.categoryId)}
                    today={today}
                    columns={state.view === "feed"}
                    compact={state.compact}
                    onOpen={() => setDetailId(task.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      {state.notice ? (
        <div className="shrink-0 px-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-paper-2 px-4 py-1">
            <p className="text-sm">{state.notice.text}</p>
            <Button variant="ghost" onClick={state.undo}>
              Undo
            </Button>
          </div>
        </div>
      ) : null}

      <Composer view={state.view} focus={focus} categoryFilter={state.categoryFilter} />

      {detailId ? <Detail taskId={detailId} onClose={() => setDetailId(null)} /> : null}
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {categoriesOpen ? <CategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
    </div>
  );
}

function headerCopy(view: ViewId, focus: string, today: string): { title: string; sub: string } {
  if (view === "day") {
    const when =
      focus === today ? "Today" : focus === addDays(today, 1) ? "Tomorrow" : focus === addDays(today, -1) ? "Yesterday" : "";
    return { title: weekdayName(focus), sub: [monthDay(focus), when].filter(Boolean).join(" · ") };
  }
  const copy: Record<Exclude<ViewId, "day">, { title: string; sub: string }> = {
    feed: { title: "Feed", sub: "Every open task, each repeat only once" },
    upcoming: { title: "Upcoming", sub: "Dated after today" },
    overdue: { title: "Overdue", sub: "Still open from earlier days" },
    later: { title: "Later", sub: "No date yet" },
    repeats: { title: "Repeats", sub: "Each one shows only its next time" },
    done: { title: "Done", sub: "One-time tasks you finished" },
  };
  return copy[view];
}

function WeekStrip({
  focus,
  today,
  tasks,
  categoryFilter,
  showRepeating,
  onSelect,
}: {
  focus: string;
  today: string;
  tasks: Task[];
  categoryFilter: string | null;
  showRepeating: boolean;
  onSelect: (date: string) => void;
}) {
  const start = startOfWeek(focus);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 pb-3">
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink"
        aria-label="Previous week"
        onClick={() => onSelect(addDays(focus, -7))}
      >
        <ChevronLeft className="size-5" />
      </button>
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
        {days.map((day) => {
          const selected = day === focus;
          const count = tasks.filter((task) => {
            if (task.deleted || task.done || shownDate(task, today) !== day) return false;
            if (categoryFilter && task.categoryId !== categoryFilter) return false;
            if (!showRepeating && task.repeat.kind !== "none") return false;
            return true;
          }).length;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              aria-label={formatWhen(day, today)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-2xl text-ink ${selected ? "bg-ink text-paper" : day === today ? "bg-paper-2" : ""}`}
              onClick={() => onSelect(day)}
            >
              <span className={`text-xs ${selected ? "text-paper" : "text-muted"}`}>{DAY_SHORT[new Date(`${day}T12:00:00`).getDay()]}</span>
              <span className="text-sm font-medium tabular-nums">{Number(day.slice(-2))}</span>
              <span className={`mt-0.5 size-1 rounded-full ${count ? (selected ? "bg-paper" : "bg-ink") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink"
        aria-label="Next week"
        onClick={() => onSelect(addDays(focus, 7))}
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}

function FeedColumns() {
  return (
    <div className="sticky top-0 z-10 hidden border-b border-line bg-paper px-5 py-2 text-xs font-medium tracking-wide text-muted md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_12rem_9rem_8rem] md:gap-3">
      <span className="sr-only">Done</span>
      <span>Task</span>
      <span>Due</span>
      <span>Category</span>
      <span>Repeats</span>
    </div>
  );
}

const CATEGORY_TONES = ["#d7c4a3", "#9dceb4", "#e0b1a8", "#a9bddb", "#e0d09a", "#cbb4dd"];

function categoryTone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % CATEGORY_TONES.length;
  return CATEGORY_TONES[hash] ?? CATEGORY_TONES[0];
}
function TaskRow({
  task,
  category,
  today,
  columns,
  compact,
  onOpen,
}: {
  task: Task;
  category: string | null;
  today: string;
  columns: boolean;
  compact: boolean;
  onOpen: () => void;
}) {
  const moveTask = useCadence((s) => s.moveTask);
  const toggleTask = useCadence((s) => s.toggleTask);
  const [moveOpen, setMoveOpen] = useState(false);
  const when = shownDate(task, today);
  const preview = notePreview(task.notes);
  const meta = [category, task.repeat.kind !== "none" ? repeatLabel(task.repeat, "short") : null].filter(Boolean).join(" · ");

  return (
    <li className={`border-b border-line px-5 ${compact ? "py-1" : "py-3"}`}>
      <div className={columns ? "md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_12rem_9rem_8rem] md:items-center md:gap-3" : ""}>
      <div className={columns ? "flex items-start gap-1 md:contents" : "flex items-start gap-1"}>
        <button
          type="button"
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.repeat.kind === "none" ? `Complete ${task.title}` : `Done. Move ${task.title} to the next time`}
          className={`grid shrink-0 place-items-center ${compact ? "size-9" : "size-11"}`}
          onClick={() => toggleTask(task.id)}
        >
          <span className={`size-5 rounded-full border border-ink ${task.done ? "bg-ink" : "bg-transparent"}`} />
        </button>
        <button type="button" className={`min-w-0 flex-1 text-left ${compact ? "py-1" : "py-2"}`} onClick={onOpen} aria-label={`Details for ${task.title}`}>
          <span className={`block font-medium ${task.done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
          {meta && !columns ? <span className="mt-0.5 block text-sm text-muted">{meta}</span> : null}
          {preview && !compact ? <span className="mt-1 block truncate text-sm text-pretty text-muted">{preview}</span> : null}
        </button>
      </div>
      {!task.done ? (
        <div className={`flex items-center gap-1 ${compact ? "pl-9" : "mt-1 pl-12"} ${columns ? "md:mt-0 md:pl-0" : ""}`}>
          {compact ? null : (
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-ink disabled:opacity-40"
              aria-label="One day earlier"
              disabled={!when}
              onClick={() => when && moveTask(task.id, addDays(when, -1))}
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <span className={`min-w-0 flex-1 text-sm tabular-nums text-muted ${when && when < today ? "text-danger" : ""} ${compact ? "text-left" : "text-center"}`}>
            {when ? formatWhen(when, today) : "No date"}
          </span>
          {compact ? null : (
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-ink"
              aria-label={when ? "One day later" : "Set to today"}
              onClick={() => moveTask(task.id, when ? addDays(when, 1) : today)}
            >
              <ChevronRight className="size-5" />
            </button>
          )}
          <Button variant="quiet" onClick={() => setMoveOpen(true)}>
            Move
          </Button>
        </div>
      ) : columns ? (
        <span className="hidden md:block" />
      ) : null}
      {columns ? (
        <>
          <span className="mt-1 hidden items-center gap-2 text-sm text-muted md:mt-0 md:flex">
            <span className="size-2 shrink-0 rounded-full" style={{ background: category ? categoryTone(category) : "#3f3b35" }} />
            {category ?? "None"}
          </span>
          <span className="hidden text-sm text-muted md:block">{task.repeat.kind === "none" ? "Once" : repeatLabel(task.repeat, "short")}</span>
        </>
      ) : null}
      </div>
      {moveOpen ? (
        <Modal
          open
          onOpenChange={setMoveOpen}
          title="Move"
          description={
            task.repeat.kind === "none"
              ? task.title
              : `${task.title}. Only this next time is shown. Moving it changes where that one sits.`
          }
        >
          <DateChooser
            date={when}
            calendarDefaultOpen
            onChange={(date) => {
              moveTask(task.id, date);
              setMoveOpen(false);
            }}
          />
        </Modal>
      ) : null}
    </li>
  );
}

function Empty({ view, filtering, onClear }: { view: ViewId; filtering: boolean; onClear: () => void }) {
  if (filtering) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-display text-2xl text-ink">Nothing matches</p>
        <p className="mt-2 text-sm text-muted">Those filters are hiding every task.</p>
        <Button className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }
  const copy: Record<ViewId, { title: string; body: string }> = {
    feed: { title: "The feed is empty", body: "Every open task lives here, one row each. A repeat stays on its next date until you check it off." },
    day: { title: "Nothing on this day", body: "Add a task below, then open it to write notes or choose a category." },
    upcoming: { title: "Nothing upcoming", body: "Tasks with a future date will gather here." },
    overdue: { title: "Nothing overdue", body: "Anything still open from an earlier day shows up here." },
    later: { title: "Nothing without a date", body: "Move a task off the calendar and it waits here." },
    repeats: { title: "No repeating tasks", body: "A repeat shows up once, on its next date. Checking it off moves that same task forward." },
    done: { title: "Nothing finished", body: "One-time tasks you check off land here. Repeats schedule their next date instead." },
  };
  return (
    <div className="px-5 py-16 text-center">
      <p className="font-display text-2xl text-ink">{copy[view].title}</p>
      <p className="mt-2 text-sm text-pretty text-muted">{copy[view].body}</p>
    </div>
  );
}

function Composer({ view, focus, categoryFilter }: { view: ViewId; focus: string; categoryFilter: string | null }) {
  const categories = activeCategories(useCadence((s) => s.categories));
  const addTask = useCadence((s) => s.addTask);
  const addCategory = useCadence((s) => s.addCategory);
  const today = todayKey();
  const defaultDate = view === "later" ? null : view === "upcoming" ? addDays(today, 1) : view === "day" ? focus : today;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [date, setDate] = useState<string | null>(defaultDate);
  const [repeat, setRepeat] = useState<Repeat>(view === "repeats" ? { kind: "daily" } : { kind: "none" });
  const [categoryId, setCategoryId] = useState<string | null>(categoryFilter);
  const [dateOpen, setDateOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  useEffect(() => {
    setDate(defaultDate);
    setCategoryId(categoryFilter);
  }, [defaultDate, categoryFilter]);

  const category = categories.find((item) => item.id === categoryId)?.name ?? "Category";

  return (
    <form
      className="safe-bottom shrink-0 border-t border-line bg-paper px-5 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        addTask({ title, notes, categoryId, date, repeat });
        setTitle("");
        setNotes("");
        setNotesOpen(false);
        setRepeat(view === "repeats" ? { kind: "daily" } : { kind: "none" });
      }}
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="new-task">
          New task
        </label>
        <input
          id="new-task"
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={view === "later" ? "Add a task for later" : "Add a task"}
        />
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          Add
        </Button>
      </div>
      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
        <Chip onClick={() => setDateOpen(true)}>{date ? formatWhen(date, today) : "No date"}</Chip>
        <Chip onClick={() => setRepeatOpen(true)}>{repeatLabel(repeat, "short")}</Chip>
        <Chip active={!!categoryId} onClick={() => setCategoryOpen(true)}>
          {category}
        </Chip>
        <Chip active={notesOpen || notes.trim().length > 0} aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
          Notes
        </Chip>
      </div>
      {notesOpen ? (
        <div className="pb-2">
          <label className="text-sm font-medium text-muted" htmlFor="new-notes">
            Notes
          </label>
          <textarea
            id="new-notes"
            className="notes-area mt-2"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add the details you'll want later."
          />
        </div>
      ) : null}
      {dateOpen ? (
        <Modal open onOpenChange={setDateOpen} title="Date" description="Where this task should land.">
          <DateChooser
            date={date}
            calendarDefaultOpen
            onChange={(next) => {
              setDate(next);
              setDateOpen(false);
            }}
          />
        </Modal>
      ) : null}
      {repeatOpen ? (
        <Modal open onOpenChange={setRepeatOpen} title="Repeat" description="The next date is set when you finish this one.">
          <RepeatChooser repeat={repeat} date={date} onChange={setRepeat} />
        </Modal>
      ) : null}
      {categoryOpen ? (
        <Modal open onOpenChange={setCategoryOpen} title="Category" description="Choose one category for this task.">
          <div className="flex flex-wrap gap-2">
            <Chip
              active={!categoryId}
              onClick={() => {
                setCategoryId(null);
                setCategoryOpen(false);
              }}
            >
              None
            </Chip>
            {categories.map((item) => (
              <Chip
                key={item.id}
                active={categoryId === item.id}
                onClick={() => {
                  setCategoryId(item.id);
                  setCategoryOpen(false);
                }}
              >
                {item.name}
              </Chip>
            ))}
          </div>
          <CategoryCreate
            onCreate={(name) => {
              const id = addCategory(name);
              if (id) setCategoryId(id);
              setCategoryOpen(false);
            }}
          />
        </Modal>
      ) : null}
    </form>
  );
}

function CategoryCreate({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onCreate(name);
      }}
    >
      <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="New category" aria-label="New category" maxLength={40} />
      <Button type="submit" variant="primary" disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}
