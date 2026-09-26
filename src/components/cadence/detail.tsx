import { useRef, useState } from "react";
import { CategoryPicker, DateChooser, Modal, RepeatChooser, SectionLabel } from "@/components/cadence/ui";
import { Button } from "@/components/cadence/ui";
import {
  formatWhen,
  normalizeRepeat,
  shownDate,
  todayKey,
  type Category,
  type Repeat,
  type Task,
} from "@/lib/cadence/model";
import { useCadence } from "@/lib/cadence/store";

type Draft = {
  title: string;
  notes: string;
  categoryId: string | null;
  date: string | null;
  repeat: Repeat;
};

export function Detail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useCadence((s) => s.tasks.find((item) => item.id === taskId && !item.deleted));
  const categories = useCadence((s) => s.categories);
  if (!task) return null;
  return <DetailBody key={task.id} task={task} categories={categories} onClose={onClose} />;
}

function DetailBody({ task, categories, onClose }: { task: Task; categories: Category[]; onClose: () => void }) {
  const updateTask = useCadence((s) => s.updateTask);
  const deleteTask = useCadence((s) => s.deleteTask);
  const addCategory = useCadence((s) => s.addCategory);
  const today = todayKey();
  const visibleDate = shownDate(task, today);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [categoryId, setCategoryId] = useState(task.categoryId);
  const [date, setDate] = useState<string | null>(visibleDate);
  const [repeat, setRepeat] = useState<Repeat>(task.repeat);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const dateTouched = useRef(false);
  const saved = useRef<Draft>({
    title: task.title,
    notes: task.notes,
    categoryId: task.categoryId,
    date: task.date,
    repeat: normalizeRepeat(task.repeat),
  });
  const skipSave = useRef(false);
  const active = categories.filter((c) => !c.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function save(overrides: Partial<Draft> = {}, notice?: string) {
    const next: Draft = {
      title,
      notes,
      categoryId,
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
      clean.date === previous.date &&
      JSON.stringify(clean.repeat) === JSON.stringify(previous.repeat)
    ) {
      return;
    }
    saved.current = clean;
    setTitle(clean.title);
    setNotes(clean.notes);
    setCategoryId(clean.categoryId);
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
      description="Category, notes, and schedule stay on this task."
    >
      <label className="sr-only" htmlFor="task-title">
        Task name
      </label>
      <input
        id="task-title"
        className="title-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => save()}
        placeholder="Task name"
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
          <p className="mt-2 text-sm text-muted">Only the next time shows on the list. Checking it off moves this task forward. Notes stay.</p>
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
          Delete task
        </Button>
      </div>
    </Modal>
  );
}
