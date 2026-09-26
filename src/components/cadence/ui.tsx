import * as Dialog from "@radix-ui/react-dialog";
import { DayPicker } from "react-day-picker";
import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  DAY_SHORT,
  WEEKDAY_ORDER,
  addDays,
  formatGroupLabel,
  nextOccurrence,
  normalizeRepeat,
  parseKey,
  repeatLabel,
  todayKey,
  upcomingWeekend,
  type Category,
  type Repeat,
} from "@/lib/cadence/model";

export function Button({
  variant = "quiet",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "ghost" | "danger";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        "disabled:opacity-40",
        variant === "primary" && "bg-ink text-paper",
        variant === "quiet" && "bg-paper-2 text-ink",
        variant === "ghost" && "bg-transparent text-ink",
        variant === "danger" && "text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Chip({
  active,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        active ? "bg-ink text-paper" : "bg-paper-2 text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-content">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-3xl text-ink">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-pretty text-muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              aria-label="Close"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-muted">{children}</h3>;
}

export function DateChooser({
  date,
  onChange,
  calendarDefaultOpen = false,
}: {
  date: string | null;
  onChange: (date: string | null) => void;
  calendarDefaultOpen?: boolean;
}) {
  const today = todayKey();
  const base = date ?? today;
  const [calendarOpen, setCalendarOpen] = useState(calendarDefaultOpen);
  const options: { label: string; value: string | null }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "This weekend", value: upcomingWeekend(today) },
    { label: "Next week", value: addDays(base, 7) },
    { label: "In 3 days", value: addDays(today, 3) },
    { label: "No date", value: null },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip key={option.label} active={date === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </Chip>
        ))}
      </div>
      {date ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onChange(addDays(date, -1))}>
            One day earlier
          </Button>
          <Button variant="ghost" onClick={() => onChange(addDays(date, 1))}>
            One day later
          </Button>
        </div>
      ) : null}
      <Button className="mt-3" variant="quiet" onClick={() => setCalendarOpen((open) => !open)} aria-expanded={calendarOpen}>
        {calendarOpen ? "Hide calendar" : "Pick a date"}
      </Button>
      {calendarOpen ? (
        <div className="cadence-cal mt-3">
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={date ? parseKey(date) : undefined}
            defaultMonth={date ? parseKey(date) : parseKey(today)}
            onSelect={(next) => onChange(next ? toLocalKey(next) : null)}
          />
        </div>
      ) : null}
    </div>
  );
}

function toLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const REPEAT_PRESETS: { label: string; repeat: Repeat }[] = [
  { label: "Doesn't repeat", repeat: { kind: "none" } },
  { label: "Every day", repeat: { kind: "daily" } },
  { label: "Weekdays", repeat: { kind: "weekdays" } },
  { label: "Every week", repeat: { kind: "weekly" } },
  { label: "Every month", repeat: { kind: "monthly" } },
  { label: "Every few…", repeat: { kind: "interval", every: 2, unit: "week" } },
  { label: "Chosen days", repeat: { kind: "days", days: [1, 3, 5] } },
];

export function RepeatChooser({
  repeat,
  date,
  onChange,
}: {
  repeat: Repeat;
  date: string | null;
  onChange: (repeat: Repeat) => void;
}) {
  const rule = normalizeRepeat(repeat);
  const next = date && rule.kind !== "none" ? nextOccurrence(date, rule, date) : null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {REPEAT_PRESETS.map((option) => (
          <Chip key={option.label} active={sameKind(rule, option.repeat)} onClick={() => onChange(option.repeat)}>
            {option.label}
          </Chip>
        ))}
      </div>
      {rule.kind === "interval" ? (
        <div className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="repeat-every">
            Interval
          </label>
          <input
            id="repeat-every"
            className="field w-20"
            inputMode="numeric"
            value={rule.every}
            onChange={(event) =>
              onChange({
                kind: "interval",
                every: Number(event.target.value),
                unit: rule.unit,
              })
            }
          />
          <label className="sr-only" htmlFor="repeat-unit">
            Interval unit
          </label>
          <select
            id="repeat-unit"
            className="field"
            value={rule.unit}
            onChange={(event) =>
              onChange({
                kind: "interval",
                every: rule.every,
                unit: event.target.value as "day" | "week" | "month",
              })
            }
          >
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
        </div>
      ) : null}
      {rule.kind === "days" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAY_ORDER.map((day) => {
            const selected = rule.days.includes(day);
            return (
              <Chip
                key={day}
                active={selected}
                aria-pressed={selected}
                onClick={() => {
                  const days = selected ? rule.days.filter((item) => item !== day) : [...rule.days, day];
                  onChange({ kind: "days", days });
                }}
              >
                {DAY_SHORT[day]}
              </Chip>
            );
          })}
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        {rule.kind === "none"
          ? "Checking this off finishes it."
          : next
            ? `After this one, next is ${formatGroupLabel(next, todayKey())}. Notes and category stay.`
            : "Set a date so the next one has somewhere to land."}{" "}
        {rule.kind === "none" ? null : <span className="text-ink">{repeatLabel(rule)}</span>}
      </p>
    </div>
  );
}

function sameKind(a: Repeat, b: Repeat): boolean {
  return a.kind === b.kind;
}

export function CategoryPicker({
  categoryId,
  categories,
  onChange,
  onCreate,
}: {
  categoryId: string | null;
  categories: Category[];
  onChange: (id: string | null) => void;
  onCreate: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Chip active={categoryId === null} onClick={() => onChange(null)}>
          None
        </Chip>
        {categories.map((category) => (
          <Chip key={category.id} active={categoryId === category.id} onClick={() => onChange(category.id)}>
            {category.name}
          </Chip>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.trim();
          if (!name) return;
          onCreate(name);
          setDraft("");
        }}
      >
        <input
          className="field"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New category"
          aria-label="New category"
          maxLength={40}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
