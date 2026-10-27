import { useEffect, useRef, useState } from "react";
import { CategoryPicker, DateChooser, Modal, ProjectPicker, RepeatChooser, SectionLabel } from "@/components/toduck/ui";
import { Button } from "@/components/toduck/ui";
import {
  formatWhen,
  normalizeRepeat,
  shownDate,
  todayKey,
  type Category,
  type Project,
  type Repeat,
  type Task,
} from "@/lib/toduck/model";
import { useToduck } from "@/lib/toduck/store";
import { fetchMe, listUsers, type DirectoryUser, type ServerIdentity } from "@/lib/toduck/sync";

/**
 * Who owns this toduck and who it is shared with. Sharing is a server
 * feature: the directory and identity come from the connected server, and
 * changes save through the normal sync (the server re-stamps ownership and
 * only lets the owner change the sharing list).
 */
function SharingSection({ task }: { task: Task }) {
  const serverUrl = useToduck((s) => s.serverUrl);
  const serverToken = useToduck((s) => s.serverToken);
  const setTaskSharing = useToduck((s) => s.setTaskSharing);
  const [me, setMe] = useState<ServerIdentity | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [failed, setFailed] = useState(false);
  const connected = !!serverUrl && !!serverToken;

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const [identity, users] = await Promise.all([fetchMe(serverUrl, serverToken), listUsers(serverUrl, serverToken)]);
        if (cancelled) return;
        setMe(identity);
        setDirectory(users);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, serverUrl, serverToken]);

  const sharedWith = task.sharedWith ?? [];
  const ownerName =
    task.ownerId === null
      ? null
      : me?.kind === "user" && me.id === task.ownerId
        ? "You"
        : (directory.find((user) => user.id === task.ownerId)?.name ?? "Another user");
  const canChangeSharing =
    !connected ||
    me === null ||
    me.kind === "admin" ||
    task.ownerId === null ||
    (me.kind === "user" && me.id === task.ownerId);

  return (
    <section className="mt-6">
      <SectionLabel>Sharing</SectionLabel>
      {!connected ? (
        <p className="mt-2 text-sm text-muted">
          Owner: {task.ownerId ? (ownerName ?? "—") : "— (not owned by a user)"}. Sharing needs a server connection —
          connect one in Settings, then share this toduck with other registered users.
        </p>
      ) : failed ? (
        <p className="mt-2 text-sm text-muted">Could not load the server's user list. Sharing can't be changed right now.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            Owner: {task.ownerId ? (ownerName ?? "…") : "— (not owned by a user; the admin owns it)"}
            {sharedWith.length
              ? `. Shared with ${sharedWith.map((id) => directory.find((user) => user.id === id)?.name ?? "a user").join(", ")}.`
              : ". Not shared."}
          </p>
          {canChangeSharing ? (
            directory.filter((user) => user.id !== task.ownerId).length ? (
              <div className="mt-2 space-y-1">
                {directory
                  .filter((user) => user.id !== task.ownerId)
                  .map((user) => (
                    <label key={user.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[#1c1b19]"
                        checked={sharedWith.includes(user.id)}
                        onChange={(event) =>
                          setTaskSharing(
                            task.id,
                            event.target.checked ? [...sharedWith, user.id] : sharedWith.filter((id) => id !== user.id),
                          )
                        }
                      />
                      <span>
                        Share with {user.name}
                        {me?.kind === "user" && me.id === user.id ? " (you)" : ""}
                      </span>
                    </label>
                  ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">No other registered users on this server yet. The admin can create users in Settings.</p>
            )
          ) : (
            <p className="mt-2 text-sm text-muted">
              Shared with you by {ownerName ?? "the owner"}. You can edit this toduck, but only the owner can change
              sharing or delete it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

type Draft = {
  title: string;
  notes: string;
  categoryId: string | null;
  projectId: string | null;
  date: string | null;
  repeat: Repeat;
};

export function Detail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useToduck((s) => s.tasks.find((item) => item.id === taskId && !item.deleted));
  const categories = useToduck((s) => s.categories);
  const projects = useToduck((s) => s.projects);
  if (!task) return null;
  return <DetailBody key={task.id} task={task} categories={categories} projects={projects} onClose={onClose} />;
}

function DetailBody({
  task,
  categories,
  projects,
  onClose,
}: {
  task: Task;
  categories: Category[];
  projects: Project[];
  onClose: () => void;
}) {
  const updateTask = useToduck((s) => s.updateTask);
  const deleteTask = useToduck((s) => s.deleteTask);
  const addCategory = useToduck((s) => s.addCategory);
  const addProject = useToduck((s) => s.addProject);
  const today = todayKey();
  const visibleDate = shownDate(task, today);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [categoryId, setCategoryId] = useState(task.categoryId);
  const [projectId, setProjectId] = useState(task.projectId);
  const [date, setDate] = useState<string | null>(visibleDate);
  const [repeat, setRepeat] = useState<Repeat>(task.repeat);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const dateTouched = useRef(false);
  const saved = useRef<Draft>({
    title: task.title,
    notes: task.notes,
    categoryId: task.categoryId,
    projectId: task.projectId,
    date: task.date,
    repeat: normalizeRepeat(task.repeat),
  });
  const skipSave = useRef(false);
  const active = categories.filter((c) => !c.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activeProjectList = projects.filter((p) => !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function save(overrides: Partial<Draft> = {}, notice?: string) {
    const next: Draft = {
      title,
      notes,
      categoryId,
      projectId,
      date: overrides.date !== undefined || dateTouched.current ? date : task.date,
      repeat,
      ...overrides,
    };
    const clean: Draft = {
      ...next,
      title: next.title.trim().slice(0, 200) || task.title,
      notes: next.notes.slice(0, 20_000),
      repeat: normalizeRepeat(next.repeat),
    };
    const previous = saved.current;
    if (
      clean.title === previous.title &&
      clean.notes === previous.notes &&
      clean.categoryId === previous.categoryId &&
      clean.projectId === previous.projectId &&
      clean.date === previous.date &&
      JSON.stringify(clean.repeat) === JSON.stringify(previous.repeat)
    ) {
      return;
    }
    saved.current = clean;
    setTitle(clean.title);
    setNotes(clean.notes);
    setCategoryId(clean.categoryId);
    setProjectId(clean.projectId);
    setDate(clean.date);
    setRepeat(clean.repeat);
    updateTask(task.id, clean, notice);
  }

  function close() {
    if (!skipSave.current) save();
    onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Details"
      description="Category, project, notes, and schedule stay on this toduck."
    >
      <label className="sr-only" htmlFor="task-title">
        Toduck name
      </label>
      <input
        id="task-title"
        className="title-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => save()}
        placeholder="Toduck name"
      />

      <section className="mt-6">
        <SectionLabel>Category</SectionLabel>
        <div className="mt-2">
          <CategoryPicker
            categoryId={categoryId}
            categories={active}
            onChange={(id) => save({ categoryId: id })}
            onCreate={(name) => {
              const id = addCategory(name);
              if (id) save({ categoryId: id });
            }}
          />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Project</SectionLabel>
        <div className="mt-2">
          <ProjectPicker
            projectId={projectId}
            projects={activeProjectList}
            onChange={(id) => save({ projectId: id })}
            onCreate={(name) => {
              const id = addProject(name);
              if (id) save({ projectId: id });
            }}
          />
        </div>
      </section>

      <SharingSection task={task} />

      <section className="mt-6">
        <SectionLabel>Notes</SectionLabel>
        <textarea
          className="notes-area mt-2"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => save()}
          placeholder="Add the details you'll want later."
          aria-label="Notes"
        />
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <SectionLabel>Schedule</SectionLabel>
        <div className="mt-2">
          <DateChooser
            date={date}
            calendarDefaultOpen
            onChange={(next) => {
              dateTouched.current = true;
              const todayNow = todayKey();
              save({ date: next }, next ? `Moved to ${formatWhen(next, todayNow)}` : "Moved to later");
            }}
          />
        </div>
        <Button className="mt-3" variant="quiet" aria-expanded={repeatOpen} onClick={() => setRepeatOpen((open) => !open)}>
          {repeatOpen ? "Hide repeat" : repeat.kind === "none" ? "Doesn't repeat" : "Change repeat"}
        </Button>
        {repeatOpen ? (
          <div className="mt-3">
            <RepeatChooser repeat={repeat} date={date} onChange={(next) => save({ repeat: next })} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Only the next time shows on the list. Checking it off moves this toduck forward. Notes stay.</p>
        )}
      </section>

      <div className="mt-6 flex justify-end">
        <Button
          variant="danger"
          onClick={() => {
            skipSave.current = true;
            deleteTask(task.id);
            onClose();
          }}
        >
          Delete toduck
        </Button>
      </div>
    </Modal>
  );
}
