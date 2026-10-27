import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Menu, Settings, X } from "lucide-react";
import { Detail } from "@/components/cadence/detail";
import { CategoriesDialog, ProjectsDialog, SettingsDialog } from "@/components/cadence/settings";
import { Button, CategoryPicker, Chip, DateChooser, Modal, ProjectPicker, RepeatChooser } from "@/components/cadence/ui";
import {
  activeCategories,
  activeProjects,
  addDays,
  buildGroups,
  buildWorkflow,
  categoryName,
  countFor,
  formatWhen,
  monthDay,
  notePreview,
  projectName,
  repeatLabel,
  shownDate,
  startOfWeek,
  todayKey,
  weekdayName,
  DAY_SHORT,
  type Project,
  type Repeat,
  type Task,
  type ViewId,
} from "@/lib/cadence/model";
import { bindSync, syncNow, useCadence } from "@/lib/cadence/store";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "all", label: "All Tasks" },
  { id: "feed", label: "Feed" },
  { id: "day", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "later", label: "Later" },
  { id: "repeats", label: "Repeats" },
  { id: "done", label: "Done" },
  { id: "workflow", label: "Workflow" },
  { id: "projects", label: "Projects" },
];

const SIDEBAR_STORAGE_KEY = "cat2duck-sidebar-open";

function initialSidebarOpen(): boolean {
  if (typeof window === "undefined") return true;
  // Narrow screens start unpinned; the sidebar is a drawer there.
  if (window.innerWidth < 768) return false;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

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
  const [projectsManageOpen, setProjectsManageOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(initialSidebarOpen);

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
    projectId: state.projectFilter,
    showRepeating: state.showRepeating,
  };
  const groups = buildGroups(state.tasks, state.categories, state.view, focus, today, refine, state.projects);
  const workflow = state.view === "workflow" ? buildWorkflow(state.tasks, state.categories, focus, today, refine, state.projects) : [];
  const categories = activeCategories(state.categories);
  const projects = activeProjects(state.projects);
  const filtering =
    state.query.trim().length > 0 || !!state.categoryFilter || !!state.projectFilter || !state.showRepeating;
  const overdueCount = countFor(state.tasks, state.categories, "overdue", focus, today, refine, state.projects);
  const header = headerCopy(state.view, focus, today);
  const viewCount = countFor(state.tasks, state.categories, state.view, focus, today, refine, state.projects);
  const headerCount = state.view === "projects" && !state.projectFilter ? projects.length : viewCount;
  const countWord =
    state.view === "done"
      ? "finished toducks"
      : state.view === "all" || state.view === "workflow"
        ? "toducks"
        : state.view === "projects" && !state.projectFilter
          ? "projects"
          : "open toducks";
  const selectedProject = state.projectFilter ? projects.find((p) => p.id === state.projectFilter) : undefined;

  function toggleSidebar() {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Persistence is a nicety; the toggle still works without it.
      }
      return next;
    });
  }

  function closeSidebarOnNarrow() {
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  }

  function navigate(view: ViewId) {
    if (view === "projects") state.setProjectFilter(null);
    state.setView(view);
    closeSidebarOnNarrow();
  }

  function renderGroups() {
    if (groups.length === 0) {
      return <Empty view={state.view} filtering={filtering} onClear={state.clearFilters} />;
    }
    return groups.map((group) => (
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
              project={projectName(state.projects, task.projectId)}
              today={today}
              columns={state.view === "feed"}
              compact={state.compact}
              onOpen={() => setDetailId(task.id)}
            />
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper text-ink">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      {sidebarOpen ? (
        <aside className="fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-line bg-paper md:static md:z-auto" aria-label="Sidebar">
          <div className="flex items-center gap-3 px-4 pt-5">
            <img src="/logo.png" alt="" className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl leading-tight text-ink">Cat2Duck</p>
              <p className="text-xs text-muted">Your toducks</p>
            </div>
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:hidden"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <nav aria-label="Views" className="mt-5 flex flex-col gap-1">
              {VIEWS.map((view) => {
                const active = state.view === view.id;
                const count =
                  view.id === "projects"
                    ? projects.length
                    : countFor(
                        state.tasks,
                        state.categories,
                        view.id,
                        view.id === "day" ? focus : today,
                        today,
                        refine,
                        state.projects,
                      );
                const label = view.id === "day" ? (focus === today ? "Today" : formatWhen(focus, today)) : view.label;
                return (
                  <button
                    key={view.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => navigate(view.id)}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                      active ? "bg-ink text-paper" : "text-ink hover:bg-paper-2"
                    }`}
                  >
                    <span>{label}</span>
                    <span className="tabular-nums">{count}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-5">
              <input
                className="field"
                type="search"
                value={state.query}
                onChange={(event) => state.setQuery(event.target.value)}
                placeholder="Filter toducks"
                aria-label="Filter toducks"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
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

            <div className="mt-3 flex flex-wrap gap-2">
              {state.view !== "repeats" ? (
                <Chip active={!state.showRepeating} aria-pressed={!state.showRepeating} onClick={() => state.setShowRepeating(!state.showRepeating)}>
                  {state.showRepeating ? "Hide repeats" : "Repeats hidden"}
                </Chip>
              ) : null}
              <Chip active={state.compact} aria-pressed={state.compact} onClick={() => state.setCompact(!state.compact)}>
                {state.compact ? "Compact on" : "Compact"}
              </Chip>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Button variant="quiet" className="w-full" onClick={() => setCategoriesOpen(true)}>
                Categories
              </Button>
              <button
                type="button"
                className="relative inline-flex min-h-11 w-full items-center justify-center rounded-full bg-paper-2 px-4 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="mr-2 size-5" />
                Settings
                {state.serverUrl ? (
                  <span
                    className={`absolute right-3 top-1/2 size-2 -translate-y-1/2 rounded-full ${state.syncStatus === "error" ? "bg-danger" : "bg-sage"}`}
                  />
                ) : null}
              </button>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 px-5 pt-6">
          <div className="flex items-start gap-2">
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              aria-label="Toggle navigation"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-display text-ink">{header.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {header.sub}
                <span className="tabular-nums"> · {headerCount} {countWord}</span>
              </p>
            </div>
          </div>
        </header>

        {state.view === "day" ? (
          <WeekStrip
            focus={focus}
            today={today}
            tasks={state.tasks}
            categoryFilter={state.categoryFilter}
            projectFilter={state.projectFilter}
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
          {state.view === "workflow" ? (
            workflow.every((column) => column.tasks.length === 0) ? (
              <Empty view="workflow" filtering={filtering} onClear={state.clearFilters} />
            ) : (
              <div className="flex gap-3 overflow-x-auto px-5 pb-2 pt-2">
                {workflow.map((column) => (
                  <section key={column.id} className="w-72 shrink-0 rounded-2xl bg-card p-2" aria-label={column.label}>
                    <h2 className={`px-2 pt-2 font-display text-xl text-ink ${column.id === "overdue" ? "text-danger" : ""}`}>
                      {column.label}
                      <span className="ml-2 text-sm tabular-nums text-muted">{column.tasks.length}</span>
                    </h2>
                    {column.tasks.length === 0 ? (
                      <p className="px-2 py-4 text-sm text-muted">Nothing here.</p>
                    ) : (
                      <ul>
                        {column.tasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            category={categoryName(state.categories, task.categoryId)}
                            project={projectName(state.projects, task.projectId)}
                            today={today}
                            columns={false}
                            compact={state.compact}
                            onOpen={() => setDetailId(task.id)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )
          ) : state.view === "projects" && !state.projectFilter ? (
            <ProjectsList
              projects={projects}
              tasks={state.tasks}
              onSelect={(id) => state.setProjectFilter(id)}
              onManage={() => setProjectsManageOpen(true)}
            />
          ) : (
            <>
              {state.view === "projects" && state.projectFilter ? (
                <div className="flex items-center gap-2 px-5 pt-4">
                  <Button variant="ghost" onClick={() => state.setProjectFilter(null)}>
                    ← All projects
                  </Button>
                  <p className="font-display text-2xl text-ink">{selectedProject?.name ?? "Project"}</p>
                </div>
              ) : null}
              {state.view === "feed" && groups.length > 0 ? <FeedColumns /> : null}
              {renderGroups()}
            </>
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

        <Composer view={state.view} focus={focus} categoryFilter={state.categoryFilter} projectFilter={state.projectFilter} />

        {detailId ? <Detail taskId={detailId} onClose={() => setDetailId(null)} /> : null}
        {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
        {categoriesOpen ? <CategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
        {projectsManageOpen ? <ProjectsDialog onClose={() => setProjectsManageOpen(false)} /> : null}
      </div>
    </div>
  );
}

function ProjectsList({
  projects,
  tasks,
  onSelect,
  onManage,
}: {
  projects: Project[];
  tasks: Task[];
  onSelect: (id: string) => void;
  onManage: () => void;
}) {
  const addProject = useCadence((s) => s.addProject);
  const [name, setName] = useState("");
  return (
    <div className="px-5 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Pick a project to see its toducks.</p>
        <Button variant="quiet" onClick={onManage}>
          Manage projects
        </Button>
      </div>
      {projects.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No projects yet. Create one below, then put toducks in it.</p>
      ) : (
        <ul className="mt-3">
          {projects.map((project) => {
            const open = tasks.filter((task) => !task.deleted && !task.done && task.projectId === project.id).length;
            const total = tasks.filter((task) => !task.deleted && task.projectId === project.id).length;
            return (
              <li key={project.id} className="border-b border-line">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  onClick={() => onSelect(project.id)}
                  aria-label={`Show toducks in ${project.name}`}
                >
                  <span className="font-medium text-ink">{project.name}</span>
                  <span className="text-sm tabular-nums text-muted">
                    {open} open · {total} total
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (addProject(name)) setName("");
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New project"
          aria-label="New project"
          maxLength={40}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
      </form>
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
    all: { title: "All Tasks", sub: "Every toduck, open and finished" },
    feed: { title: "Feed", sub: "Every open toduck, each repeat only once" },
    upcoming: { title: "Upcoming", sub: "Dated after today" },
    overdue: { title: "Overdue", sub: "Still open from earlier days" },
    later: { title: "Later", sub: "No date yet" },
    repeats: { title: "Repeats", sub: "Each one shows only its next time" },
    done: { title: "Done", sub: "One-time toducks you finished" },
    workflow: { title: "Workflow", sub: "Toducks in the column their date puts them in" },
    projects: { title: "Projects", sub: "Toducks grouped by the project they belong to" },
  };
  return copy[view];
}

function WeekStrip({
  focus,
  today,
  tasks,
  categoryFilter,
  projectFilter,
  showRepeating,
  onSelect,
}: {
  focus: string;
  today: string;
  tasks: Task[];
  categoryFilter: string | null;
  projectFilter: string | null;
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
            if (projectFilter && task.projectId !== projectFilter) return false;
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
    <div className="sticky top-0 z-10 hidden border-b border-line bg-paper px-5 py-2 text-xs font-medium tracking-wide text-muted md:grid md:grid-cols-[minmax(0,1fr)_14rem_9rem_8rem_2.75rem] md:gap-3">
      <span>Toduck</span>
      <span>Due</span>
      <span>Category</span>
      <span>Repeats</span>
      <span className="sr-only">Done</span>
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
  project,
  today,
  columns,
  compact,
  onOpen,
}: {
  task: Task;
  category: string | null;
  project: string | null;
  today: string;
  columns: boolean;
  compact: boolean;
  onOpen: () => void;
}) {
  const moveTask = useCadence((s) => s.moveTask);
  const toggleTask = useCadence((s) => s.toggleTask);
  const updateTask = useCadence((s) => s.updateTask);
  const addCategory = useCadence((s) => s.addCategory);
  const allCategories = useCadence((s) => s.categories);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const when = shownDate(task, today);
  const preview = notePreview(task.notes);
  const meta = [category, project, task.repeat.kind !== "none" ? repeatLabel(task.repeat, "short") : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={`border-b border-line px-5 ${compact ? "py-1" : "py-2"}`}>
      <div className={columns ? "md:grid md:grid-cols-[minmax(0,1fr)_14rem_9rem_8rem_2.75rem] md:items-center md:gap-3" : ""}>
      <div className={columns ? "flex items-center gap-2 md:contents" : "flex items-center gap-2"}>
        <button type="button" className={`min-w-0 flex-1 text-left ${compact ? "py-1" : "py-2"}`} onClick={onOpen} aria-label={`Details for ${task.title}`}>
          <span className={`block font-medium ${task.done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
          {meta && !columns ? <span className="mt-0.5 block truncate text-sm text-muted">{meta}{when ? ` · ${formatWhen(when, today)}` : ""}</span> : null}
          {preview && !compact ? <span className="mt-1 block truncate text-sm text-pretty text-muted">{preview}</span> : null}
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.repeat.kind === "none" ? `Complete ${task.title}` : `Done. Move ${task.title} to the next time`}
          className={`grid shrink-0 place-items-center ${compact ? "size-9" : "size-11"}`}
          onClick={() => toggleTask(task.id)}
        >
          <span className={`grid size-5 place-items-center rounded-full border border-ink text-xs text-paper ${task.done ? "bg-ink" : "bg-transparent"}`}>
            {task.done ? "✓" : ""}
          </span>
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
          <div className="relative min-w-0 flex-1">
            <span
              aria-hidden="true"
              className={`pointer-events-none block min-h-11 truncate py-3 text-sm tabular-nums text-muted underline-offset-2 ${when && when < today ? "text-danger" : ""} ${compact ? "text-left" : "text-center"}`}
            >
              {when ? formatWhen(when, today) : "No date"}
            </span>
            <input
              type="date"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label={when ? `Change date for ${task.title}, currently ${formatWhen(when, today)}` : `Set a date for ${task.title}`}
              value={when ?? ""}
              onClick={(event) => {
                try {
                  event.currentTarget.showPicker();
                } catch {
                  // Some browsers already open the picker from the click itself.
                }
              }}
              onChange={(event) => moveTask(task.id, event.target.value || null)}
            />
          </div>
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
          <Button
            variant="quiet"
            className={`max-w-32 shrink-0 ${columns ? "md:hidden" : ""}`}
            onClick={() => setCategoryOpen(true)}
            aria-label={`Change category for ${task.title}`}
          >
            <span className="truncate">{category ?? "Category"}</span>
          </Button>
        </div>
      ) : columns ? (
        <span className="hidden md:block" />
      ) : null}
      {columns ? (
        <>
          <button
            type="button"
            onClick={() => setCategoryOpen(true)}
            aria-label={`Change category for ${task.title}`}
            className="mt-1 hidden items-center gap-2 text-left text-sm text-muted underline-offset-2 hover:underline md:mt-0 md:flex"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: category ? categoryTone(category) : "#3f3b35" }} />
            <span className="truncate">{category ?? "None"}</span>
          </button>
          <span className="hidden text-sm text-muted md:block">{task.repeat.kind === "none" ? "Once" : repeatLabel(task.repeat, "short")}</span>
        </>
      ) : null}
      </div>
      {categoryOpen ? (
        <Modal open onOpenChange={setCategoryOpen} title="Category" description={task.title}>
          <CategoryPicker
            categoryId={task.categoryId}
            categories={activeCategories(allCategories)}
            onChange={(id) => {
              updateTask(task.id, { categoryId: id });
              setCategoryOpen(false);
            }}
            onCreate={(name) => {
              const id = addCategory(name);
              if (id) updateTask(task.id, { categoryId: id });
              setCategoryOpen(false);
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
        <p className="mt-2 text-sm text-muted">Those filters are hiding every toduck.</p>
        <Button className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }
  const copy: Record<ViewId, { title: string; body: string }> = {
    all: { title: "No toducks yet", body: "Every toduck you add, open or finished, gathers here exactly once." },
    feed: { title: "The feed is empty", body: "Every open toduck lives here, one row each. A repeat stays on its next date until you check it off." },
    day: { title: "Nothing on this day", body: "Add a toduck below, then open it to write notes or choose a category." },
    upcoming: { title: "Nothing upcoming", body: "Toducks with a future date will gather here." },
    overdue: { title: "Nothing overdue", body: "Anything still open from an earlier day shows up here." },
    later: { title: "Nothing without a date", body: "Move a toduck off the calendar and it waits here." },
    repeats: { title: "No repeating toducks", body: "A repeat shows up once, on its next date. Checking it off moves that same toduck forward." },
    done: { title: "Nothing finished", body: "One-time toducks you check off land here. Repeats schedule their next date instead." },
    workflow: { title: "Nothing on the board", body: "Toducks land in a column by their date: overdue, today, upcoming, later, or done." },
    projects: { title: "Nothing in this project", body: "Toducks assigned to this project show up here, open and finished." },
  };
  return (
    <div className="px-5 py-16 text-center">
      <p className="font-display text-2xl text-ink">{copy[view].title}</p>
      <p className="mt-2 text-sm text-pretty text-muted">{copy[view].body}</p>
    </div>
  );
}

function Composer({
  view,
  focus,
  categoryFilter,
  projectFilter,
}: {
  view: ViewId;
  focus: string;
  categoryFilter: string | null;
  projectFilter: string | null;
}) {
  const categories = activeCategories(useCadence((s) => s.categories));
  const projects = activeProjects(useCadence((s) => s.projects));
  const addTask = useCadence((s) => s.addTask);
  const addCategory = useCadence((s) => s.addCategory);
  const addProject = useCadence((s) => s.addProject);
  const today = todayKey();
  const defaultDate = view === "later" ? null : view === "upcoming" ? addDays(today, 1) : view === "day" ? focus : today;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [date, setDate] = useState<string | null>(defaultDate);
  const [repeat, setRepeat] = useState<Repeat>(view === "repeats" ? { kind: "daily" } : { kind: "none" });
  const [categoryId, setCategoryId] = useState<string | null>(categoryFilter);
  const [projectId, setProjectId] = useState<string | null>(projectFilter);
  const [dateOpen, setDateOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  useEffect(() => {
    setDate(defaultDate);
    setCategoryId(categoryFilter);
    setProjectId(projectFilter);
  }, [defaultDate, categoryFilter, projectFilter]);

  const category = categories.find((item) => item.id === categoryId)?.name ?? "Category";
  const project = projects.find((item) => item.id === projectId)?.name ?? "Project";

  return (
    <form
      className="safe-bottom shrink-0 border-t border-line bg-paper px-5 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        addTask({ title, notes, categoryId, projectId, date, repeat });
        setTitle("");
        setNotes("");
        setNotesOpen(false);
        setDate(defaultDate);
        setCategoryId(categoryFilter);
        setProjectId(projectFilter);
        setRepeat(view === "repeats" ? { kind: "daily" } : { kind: "none" });
      }}
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="new-task">
          New toduck
        </label>
        <input
          id="new-task"
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={view === "later" ? "Add a toduck for later" : "Add a toduck"}
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
        <Chip active={!!projectId} onClick={() => setProjectOpen(true)}>
          {project}
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
        <Modal open onOpenChange={setDateOpen} title="Date" description="Where this toduck should land.">
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
        <Modal open onOpenChange={setCategoryOpen} title="Category" description="Choose one category for this toduck.">
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
      {projectOpen ? (
        <Modal open onOpenChange={setProjectOpen} title="Project" description="Choose one project for this toduck.">
          <ProjectPicker
            projectId={projectId}
            projects={projects}
            onChange={(id) => {
              setProjectId(id);
              setProjectOpen(false);
            }}
            onCreate={(name) => {
              const id = addProject(name);
              if (id) setProjectId(id);
              setProjectOpen(false);
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
