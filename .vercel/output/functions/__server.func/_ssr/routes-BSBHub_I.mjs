import { i as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { a as ChevronRight, i as Settings, o as ChevronLeft, r as Trash2, t as X } from "../_libs/lucide-react.mjs";
import { a as DialogOverlay, i as DialogDescription, n as DialogClose, o as DialogPortal, r as DialogContent, s as DialogTitle, t as Dialog } from "../_libs/@radix-ui/react-dialog+[...].mjs";
import { t as DayPicker } from "../_libs/react-day-picker.mjs";
import { t as clsx } from "../_libs/clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as persist, r as create, t as createJSONStorage } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-BSBHub_I.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday"
];
var MONTHS = [
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
	"December"
];
var MONTHS_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
var DAY_SHORT = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat"
];
var WEEKDAY_ORDER = [
	1,
	2,
	3,
	4,
	5,
	6,
	0
];
function toKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function todayKey(now = /* @__PURE__ */ new Date()) {
	return toKey(now);
}
function parseKey(key) {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function addDays(key, n) {
	const dt = parseKey(key);
	dt.setDate(dt.getDate() + n);
	return toKey(dt);
}
function daysBetween(a, b) {
	return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 864e5);
}
function startOfWeek(key) {
	const day = parseKey(key).getDay();
	return addDays(key, day === 0 ? -6 : 1 - day);
}
function weekdayName(key) {
	return WEEKDAYS[parseKey(key).getDay()] ?? "";
}
function monthDay(key) {
	const d = parseKey(key);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function formatWhen(key, today) {
	if (key === today) return "Today";
	if (key === addDays(today, 1)) return "Tomorrow";
	if (key === addDays(today, -1)) return "Yesterday";
	const diff = daysBetween(today, key);
	const d = parseKey(key);
	if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()] ?? key;
	return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}
function formatGroupLabel(key, today) {
	if (key === today) return "Today";
	if (key === addDays(today, 1)) return "Tomorrow";
	if (key === addDays(today, -1)) return "Yesterday";
	const d = parseKey(key);
	return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}
function upcomingWeekend(today) {
	const day = parseKey(today).getDay();
	if (day === 0 || day === 6) return today;
	return addDays(today, 6 - day);
}
function daysInMonth(d) {
	return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function normalizeRepeat(repeat) {
	switch (repeat.kind) {
		case "interval": return {
			kind: "interval",
			every: Math.min(99, Math.max(1, Math.floor(repeat.every) || 1)),
			unit: repeat.unit === "week" || repeat.unit === "month" ? repeat.unit : "day"
		};
		case "days": return {
			kind: "days",
			days: [...new Set(repeat.days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
		};
		case "none":
		case "daily":
		case "weekdays":
		case "weekly":
		case "monthly": return { kind: repeat.kind };
		default: return { kind: "none" };
	}
}
function matches(day, anchor, repeat) {
	const d = parseKey(day);
	const a = parseKey(anchor);
	switch (repeat.kind) {
		case "none": return false;
		case "daily": return true;
		case "weekdays": return d.getDay() !== 0 && d.getDay() !== 6;
		case "weekly": return d.getDay() === a.getDay();
		case "monthly": return d.getDate() === Math.min(a.getDate(), daysInMonth(d));
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
		case "days": return repeat.days.includes(d.getDay());
		default: return false;
	}
}
/** Next date strictly after `after`, keeping the original cadence. */
function nextOccurrence(anchor, repeat, after) {
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
/**
* One-time tasks toggle done. A repeat is a single task: you only ever see
* its next time. Checking it off moves that same task forward — past a
* future due date if you finish early, or to the next time after today if
* it was already late. Missed days are not extra copies.
*/
function completionPatch(task, today, nowIso) {
	if (task.repeat.kind === "none") {
		const done = !task.done;
		return {
			date: task.date,
			done,
			completedAt: done ? nowIso : null,
			advanced: false
		};
	}
	const anchor = task.date ?? today;
	const after = task.date && task.date > today ? task.date : today;
	const next = nextOccurrence(anchor, task.repeat, after);
	if (!next) return {
		date: task.date,
		done: true,
		completedAt: nowIso,
		advanced: false
	};
	return {
		date: next,
		done: false,
		completedAt: nowIso,
		advanced: true
	};
}
/** The one date this task occupies. Repeats are not expanded into a series. */
function shownDate(task, _today) {
	return task.date;
}
function repeatLabel(repeat, style = "long") {
	const rule = normalizeRepeat(repeat);
	switch (rule.kind) {
		case "none": return style === "short" ? "Once" : "Doesn't repeat";
		case "daily": return "Every day";
		case "weekdays": return "Weekdays";
		case "weekly": return "Every week";
		case "monthly": return "Every month";
		case "interval": return rule.every === 1 ? `Every ${rule.unit}` : `Every ${rule.every} ${rule.unit}s`;
		case "days":
			if (!rule.days.length) return "Choose days";
			return WEEKDAY_ORDER.filter((d) => rule.days.includes(d)).map((d) => DAY_SHORT[d]).join(" · ");
		default: return "Once";
	}
}
function notePreview(notes) {
	return notes.trim().split("\n").find((line) => line.trim())?.trim() ?? "";
}
function activeCategories(categories) {
	return categories.filter((c) => !c.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function categoryName(categories, id) {
	if (!id) return null;
	return activeCategories(categories).find((c) => c.id === id)?.name ?? null;
}
function byCreatedDesc(a, b) {
	return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}
function visibleTasks(tasks, categories, view, focusDate, today, refine) {
	const names = new Map(activeCategories(categories).map((c) => [c.id, c.name.toLowerCase()]));
	const q = refine.query.trim().toLowerCase();
	return tasks.filter((task) => {
		if (task.deleted) return false;
		if (view === "done") {
			if (!task.done) return false;
		} else if (task.done) return false;
		else {
			const when = shownDate(task, today);
			switch (view) {
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
				default: return false;
			}
		}
		if (refine.categoryId && task.categoryId !== refine.categoryId) return false;
		if (!refine.showRepeating && task.repeat.kind !== "none" && view !== "repeats") return false;
		if (!q) return true;
		return `${task.title}\n${task.notes}\n${names.get(task.categoryId ?? "") ?? ""}`.toLowerCase().includes(q);
	});
}
function buildGroups(tasks, categories, view, focusDate, today, refine) {
	const items = visibleTasks(tasks, categories, view, focusDate, today, refine);
	if (view === "upcoming") {
		const dated = items.map((task) => ({
			task,
			when: shownDate(task, today)
		})).filter((item) => !!item.when).sort((a, b) => a.when < b.when ? -1 : a.when > b.when ? 1 : 0);
		return [...new Set(dated.map((item) => item.when))].map((date) => ({
			key: date,
			label: formatGroupLabel(date, today),
			tasks: dated.filter((item) => item.when === date).map((item) => item.task).sort(byCreatedDesc)
		}));
	}
	if (view === "overdue") {
		const sorted = [...items].sort((a, b) => {
			if (a.date < b.date) return -1;
			if (a.date > b.date) return 1;
			return byCreatedDesc(a, b);
		});
		return sorted.length ? [{
			key: "overdue",
			label: "",
			tasks: sorted
		}] : [];
	}
	if (view === "done") {
		const sorted = [...items].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
		return sorted.length ? [{
			key: "done",
			label: "",
			tasks: sorted
		}] : [];
	}
	const sorted = [...items].sort(byCreatedDesc);
	return sorted.length ? [{
		key: view,
		label: "",
		tasks: sorted
	}] : [];
}
function countFor(tasks, categories, view, focusDate, today, refine) {
	return visibleTasks(tasks, categories, view, focusDate, today, refine).length;
}
function stamp(partial) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		done: false,
		completedAt: null,
		createdAt: now,
		updatedAt: now,
		...partial
	};
}
function makeSeed(today) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const cat = (name, offset) => ({
		id: crypto.randomUUID(),
		name,
		createdAt: new Date(Date.now() + offset).toISOString(),
		updatedAt: now
	});
	const home = cat("Home", 1);
	const work = cat("Work", 2);
	const health = cat("Health", 3);
	const personal = cat("Personal", 4);
	const task = (title, date, repeat, categoryId, notes) => stamp({
		id: crypto.randomUUID(),
		title,
		notes,
		categoryId,
		date,
		repeat
	});
	const saturday = upcomingWeekend(today);
	return {
		categories: [
			home,
			work,
			health,
			personal
		],
		tasks: [
			task("Stretch for ten minutes", today, { kind: "daily" }, health.id, "Mat by the desk. Stop at the hips if the left side tugs."),
			task("Clear the inbox", today, { kind: "weekdays" }, work.id, "Reply, file, or defer. Leave the inbox empty, not sorted."),
			task("Plan the week", today, { kind: "weekly" }, work.id, "Pick three outcomes. Move anything that will not fit to another day."),
			task("Return the library book", addDays(today, -1), { kind: "none" }, personal.id, "The novel with the green sticker. Desk is on the second floor."),
			task("Pay the water bill", addDays(today, -2), { kind: "monthly" }, home.id, "Account is in the kitchen folder. After you pay, write the confirmation number here."),
			task("Call the clinic", addDays(today, 1), { kind: "none" }, health.id, "Ask about the Thursday opening. Insurance card is in the blue wallet."),
			task("Market run", saturday === today ? addDays(today, 7) : saturday, { kind: "weekly" }, home.id, "Eggs, greens, bread. Skip the stall that was out of change last time."),
			task("Read twenty pages", null, { kind: "none" }, personal.id, "Current book is on the nightstand. Stop at a chapter break."),
			task("Team sync", today, {
				kind: "days",
				days: [
					1,
					3,
					5
				]
			}, work.id, "Bring one blocker and one decision. Keep it to fifteen minutes.")
		]
	};
}
function Button({ variant = "quiet", className, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink", "disabled:opacity-40", variant === "primary" && "bg-ink text-paper", variant === "quiet" && "bg-paper-2 text-ink", variant === "ghost" && "bg-transparent text-ink", variant === "danger" && "text-danger", className),
		...props
	});
}
function Chip({ active, className, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn("inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink", active ? "bg-ink text-paper" : "bg-paper-2 text-ink", className),
		...props
	});
}
function Modal({ open, onOpenChange, title, description, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dialog, {
		open,
		onOpenChange,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogPortal, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogOverlay, { className: "modal-overlay" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
			className: "modal-content",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
						className: "font-display text-3xl text-ink",
						children: title
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, {
						className: "mt-1 text-sm text-pretty text-muted",
						children: description
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogClose, {
					className: "grid size-11 shrink-0 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
					"aria-label": "Close",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" })
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-5",
				children
			})]
		})] })
	});
}
function SectionLabel({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
		className: "text-sm font-medium text-muted",
		children
	});
}
function DateChooser({ date, onChange, calendarDefaultOpen = false }) {
	const today = todayKey();
	const base = date ?? today;
	const [calendarOpen, setCalendarOpen] = (0, import_react.useState)(calendarDefaultOpen);
	const options = [
		{
			label: "Today",
			value: today
		},
		{
			label: "Tomorrow",
			value: addDays(today, 1)
		},
		{
			label: "This weekend",
			value: upcomingWeekend(today)
		},
		{
			label: "Next week",
			value: addDays(base, 7)
		},
		{
			label: "In 3 days",
			value: addDays(today, 3)
		},
		{
			label: "No date",
			value: null
		}
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex flex-wrap gap-2",
			children: options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
				active: date === option.value,
				onClick: () => onChange(option.value),
				children: option.label
			}, option.label))
		}),
		date ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-3 flex flex-wrap gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "ghost",
				onClick: () => onChange(addDays(date, -1)),
				children: "One day earlier"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "ghost",
				onClick: () => onChange(addDays(date, 1)),
				children: "One day later"
			})]
		}) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			className: "mt-3",
			variant: "quiet",
			onClick: () => setCalendarOpen((open) => !open),
			"aria-expanded": calendarOpen,
			children: calendarOpen ? "Hide calendar" : "Pick a date"
		}),
		calendarOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "cadence-cal mt-3",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DayPicker, {
				mode: "single",
				weekStartsOn: 1,
				selected: date ? parseKey(date) : void 0,
				defaultMonth: date ? parseKey(date) : parseKey(today),
				onSelect: (next) => onChange(next ? toLocalKey(next) : null)
			})
		}) : null
	] });
}
function toLocalKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
var REPEAT_PRESETS = [
	{
		label: "Doesn't repeat",
		repeat: { kind: "none" }
	},
	{
		label: "Every day",
		repeat: { kind: "daily" }
	},
	{
		label: "Weekdays",
		repeat: { kind: "weekdays" }
	},
	{
		label: "Every week",
		repeat: { kind: "weekly" }
	},
	{
		label: "Every month",
		repeat: { kind: "monthly" }
	},
	{
		label: "Every few…",
		repeat: {
			kind: "interval",
			every: 2,
			unit: "week"
		}
	},
	{
		label: "Chosen days",
		repeat: {
			kind: "days",
			days: [
				1,
				3,
				5
			]
		}
	}
];
function RepeatChooser({ repeat, date, onChange }) {
	const rule = normalizeRepeat(repeat);
	const next = date && rule.kind !== "none" ? nextOccurrence(date, rule, date) : null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex flex-wrap gap-2",
			children: REPEAT_PRESETS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
				active: sameKind(rule, option.repeat),
				onClick: () => onChange(option.repeat),
				children: option.label
			}, option.label))
		}),
		rule.kind === "interval" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-3 flex gap-2",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "sr-only",
					htmlFor: "repeat-every",
					children: "Interval"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					id: "repeat-every",
					className: "field w-20",
					inputMode: "numeric",
					value: rule.every,
					onChange: (event) => onChange({
						kind: "interval",
						every: Number(event.target.value),
						unit: rule.unit
					})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "sr-only",
					htmlFor: "repeat-unit",
					children: "Interval unit"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
					id: "repeat-unit",
					className: "field",
					value: rule.unit,
					onChange: (event) => onChange({
						kind: "interval",
						every: rule.every,
						unit: event.target.value
					}),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "day",
							children: "days"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "week",
							children: "weeks"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "month",
							children: "months"
						})
					]
				})
			]
		}) : null,
		rule.kind === "days" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-3 flex flex-wrap gap-2",
			children: WEEKDAY_ORDER.map((day) => {
				const selected = rule.days.includes(day);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
					active: selected,
					"aria-pressed": selected,
					onClick: () => {
						onChange({
							kind: "days",
							days: selected ? rule.days.filter((item) => item !== day) : [...rule.days, day]
						});
					},
					children: DAY_SHORT[day]
				}, day);
			})
		}) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "mt-3 text-sm text-muted",
			children: [
				rule.kind === "none" ? "Checking this off finishes it." : next ? `After this one, next is ${formatGroupLabel(next, todayKey())}. Notes and category stay.` : "Set a date so the next one has somewhere to land.",
				" ",
				rule.kind === "none" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-ink",
					children: repeatLabel(rule)
				})
			]
		})
	] });
}
function sameKind(a, b) {
	return a.kind === b.kind;
}
function CategoryPicker({ categoryId, categories, onChange, onCreate }) {
	const [draft, setDraft] = (0, import_react.useState)("");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-wrap gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
			active: categoryId === null,
			onClick: () => onChange(null),
			children: "None"
		}), categories.map((category) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
			active: categoryId === category.id,
			onClick: () => onChange(category.id),
			children: category.name
		}, category.id))]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "mt-3 flex gap-2",
		onSubmit: (event) => {
			event.preventDefault();
			const name = draft.trim();
			if (!name) return;
			onCreate(name);
			setDraft("");
		},
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			className: "field",
			value: draft,
			onChange: (event) => setDraft(event.target.value),
			placeholder: "New category",
			"aria-label": "New category",
			maxLength: 40
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			type: "submit",
			variant: "primary",
			disabled: !draft.trim(),
			children: "Add"
		})]
	})] });
}
var REPEAT_KINDS = /* @__PURE__ */ new Set([
	"none",
	"daily",
	"weekdays",
	"weekly",
	"monthly",
	"interval",
	"days"
]);
function isRepeat(value) {
	if (!value || typeof value !== "object") return false;
	const kind = value.kind;
	return typeof kind === "string" && REPEAT_KINDS.has(kind);
}
function isTask(value) {
	if (!value || typeof value !== "object") return false;
	const t = value;
	if (typeof t.id !== "string" || typeof t.title !== "string") return false;
	if (typeof t.notes !== "string") return false;
	if (!(t.categoryId === null || typeof t.categoryId === "string")) return false;
	if (!(t.date === null || typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date))) return false;
	if (!isRepeat(t.repeat)) return false;
	if (typeof t.done !== "boolean") return false;
	if (typeof t.createdAt !== "string" || typeof t.updatedAt !== "string") return false;
	return true;
}
function isCategory(value) {
	if (!value || typeof value !== "object") return false;
	const c = value;
	return typeof c.id === "string" && typeof c.name === "string" && typeof c.createdAt === "string" && typeof c.updatedAt === "string";
}
function readDoc(value) {
	if (!value || typeof value !== "object") return {
		tasks: [],
		categories: []
	};
	const doc = value;
	return {
		tasks: Array.isArray(doc.tasks) ? doc.tasks.filter(isTask) : [],
		categories: Array.isArray(doc.categories) ? doc.categories.filter(isCategory) : []
	};
}
function mergeById(local, remote) {
	const map = /* @__PURE__ */ new Map();
	for (const item of remote) map.set(item.id, item);
	for (const item of local) {
		const other = map.get(item.id);
		if (!other || item.updatedAt > other.updatedAt) map.set(item.id, item);
	}
	const cutoff = Date.now() - 2592e6;
	return [...map.values()].filter((item) => {
		if (!item.deleted) return true;
		const time = new Date(item.updatedAt).getTime();
		return Number.isFinite(time) && time > cutoff;
	});
}
function normalizeServerUrl(raw) {
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
async function request(url, token, path, init) {
	let res;
	try {
		res = await fetch(`${url}${path}`, {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
				...init?.body ? { "Content-Type": "application/json" } : {}
			}
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
async function pullDoc(url, token) {
	return readDoc(await (await request(url, token, "/v1/state")).json());
}
async function pushDoc(url, token, doc) {
	await request(url, token, "/v1/state", {
		method: "PUT",
		body: JSON.stringify({
			tasks: doc.tasks,
			categories: activeCategories(doc.categories).concat(doc.categories.filter((c) => c.deleted))
		})
	});
}
async function checkServer(url, token) {
	await request(url, token, "/health");
	await pullDoc(url, token);
}
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function noticeOf(text, tasks, categories) {
	return {
		text,
		snapshot: {
			tasks,
			categories
		}
	};
}
var useCadence = create()(persist((set, get) => ({
	tasks: [],
	categories: [],
	seeded: false,
	hasHydrated: false,
	view: "day",
	focusDate: "",
	query: "",
	categoryFilter: null,
	showRepeating: true,
	serverUrl: "",
	serverToken: "",
	syncStatus: "off",
	syncError: null,
	notice: null,
	setView: (view) => set({ view }),
	setFocusDate: (focusDate) => set({
		focusDate,
		view: "day"
	}),
	setQuery: (query) => set({ query }),
	setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
	setShowRepeating: (showRepeating) => set({ showRepeating }),
	clearFilters: () => set({
		query: "",
		categoryFilter: null,
		showRepeating: true
	}),
	dismissNotice: () => set({ notice: null }),
	undo: () => {
		const notice = get().notice;
		if (!notice) return;
		set({
			tasks: notice.snapshot.tasks,
			categories: notice.snapshot.categories,
			notice: null
		});
	},
	addTask: (input) => {
		const title = input.title.trim().slice(0, 200);
		if (!title) return;
		const now = nowIso();
		const task = {
			id: crypto.randomUUID(),
			title,
			notes: input.notes.trim().slice(0, 2e4),
			categoryId: input.categoryId,
			date: input.date,
			repeat: normalizeRepeat(input.repeat),
			done: false,
			completedAt: null,
			createdAt: now,
			updatedAt: now
		};
		const prev = get();
		set({
			tasks: [task, ...prev.tasks],
			notice: noticeOf("Added", prev.tasks, prev.categories)
		});
	},
	updateTask: (id, patch, notice) => {
		const prev = get();
		const now = nowIso();
		set({
			tasks: prev.tasks.map((task) => {
				if (task.id !== id) return task;
				const title = (patch.title ?? task.title).trim().slice(0, 200) || task.title;
				return {
					...task,
					title,
					notes: (patch.notes ?? task.notes).slice(0, 2e4),
					categoryId: patch.categoryId === void 0 ? task.categoryId : patch.categoryId,
					date: patch.date === void 0 ? task.date : patch.date,
					repeat: patch.repeat ? normalizeRepeat(patch.repeat) : task.repeat,
					updatedAt: now
				};
			}),
			notice: notice ? noticeOf(notice, prev.tasks, prev.categories) : prev.notice
		});
	},
	moveTask: (id, date) => {
		const prev = get();
		const task = prev.tasks.find((item) => item.id === id);
		if (!task || task.date === date) return;
		const now = nowIso();
		const today = todayKey();
		set({
			tasks: prev.tasks.map((item) => item.id === id ? {
				...item,
				date,
				updatedAt: now
			} : item),
			notice: noticeOf(date ? `Moved to ${formatWhen(date, today)}` : "Moved to later", prev.tasks, prev.categories)
		});
	},
	toggleTask: (id) => {
		const prev = get();
		const task = prev.tasks.find((item) => item.id === id);
		if (!task) return;
		const today = todayKey();
		const now = nowIso();
		const { advanced, ...fields } = completionPatch(task, today, now);
		const text = advanced && fields.date ? `Next is ${formatWhen(fields.date, today)}` : fields.done ? "Completed" : "Restored";
		set({
			tasks: prev.tasks.map((item) => item.id === id ? {
				...item,
				...fields,
				updatedAt: now
			} : item),
			notice: noticeOf(text, prev.tasks, prev.categories)
		});
	},
	deleteTask: (id) => {
		const prev = get();
		const now = nowIso();
		set({
			tasks: prev.tasks.map((task) => task.id === id ? {
				...task,
				deleted: true,
				updatedAt: now
			} : task),
			notice: noticeOf("Deleted", prev.tasks, prev.categories)
		});
	},
	addCategory: (name) => {
		const trimmed = name.trim().slice(0, 40);
		if (!trimmed) return null;
		const existing = activeCategories(get().categories).find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
		if (existing) return existing.id;
		const now = nowIso();
		const id = crypto.randomUUID();
		set({ categories: [...get().categories, {
			id,
			name: trimmed,
			createdAt: now,
			updatedAt: now
		}] });
		return id;
	},
	renameCategory: (id, name) => {
		const trimmed = name.trim().slice(0, 40);
		if (!trimmed) return;
		const categories = get().categories;
		const current = categories.find((c) => c.id === id);
		if (!current || current.deleted || current.name === trimmed) return;
		if (activeCategories(categories).some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())) return;
		const now = nowIso();
		set({ categories: categories.map((c) => c.id === id ? {
			...c,
			name: trimmed,
			updatedAt: now
		} : c) });
	},
	deleteCategory: (id) => {
		const prev = get();
		const now = nowIso();
		set({
			categories: prev.categories.map((c) => c.id === id ? {
				...c,
				deleted: true,
				updatedAt: now
			} : c),
			tasks: prev.tasks.map((t) => t.categoryId === id ? {
				...t,
				categoryId: null,
				updatedAt: now
			} : t),
			categoryFilter: prev.categoryFilter === id ? null : prev.categoryFilter,
			notice: noticeOf("Category removed", prev.tasks, prev.categories)
		});
	},
	setServer: (serverUrl, serverToken) => set({
		serverUrl,
		serverToken,
		syncStatus: serverUrl && serverToken ? "off" : "off",
		syncError: null
	}),
	importDoc: (doc) => {
		const prev = get();
		set({
			tasks: mergeById(prev.tasks, doc.tasks),
			categories: mergeById(prev.categories, doc.categories),
			seeded: true,
			notice: noticeOf("Imported", prev.tasks, prev.categories)
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
			notice: noticeOf("Samples restored", prev.tasks, prev.categories)
		});
	},
	clearDone: () => {
		const prev = get();
		const now = nowIso();
		set({
			tasks: prev.tasks.map((task) => task.done && !task.deleted ? {
				...task,
				deleted: true,
				updatedAt: now
			} : task),
			notice: noticeOf("Cleared finished tasks", prev.tasks, prev.categories)
		});
	}
}), {
	name: "cadence",
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
		serverUrl: state.serverUrl,
		serverToken: state.serverToken
	})
}));
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
			hasHydrated: true
		});
		return;
	}
	const focusDate = !state.focusDate || state.focusDate < today ? today : state.focusDate;
	const categoryFilter = state.categoryFilter && state.categories.some((c) => c.id === state.categoryFilter && !c.deleted) ? state.categoryFilter : null;
	useCadence.setState({
		hasHydrated: true,
		focusDate,
		categoryFilter
	});
}
if (useCadence.persist) useCadence.persist.onFinishHydration(() => {
	finishHydration();
});
async function bootCadence() {
	if (typeof window === "undefined") return;
	if (useCadence.getState().hasHydrated) return;
	try {
		await useCadence.persist.rehydrate();
	} catch {
		finishHydration();
	}
	if (!useCadence.getState().hasHydrated) finishHydration();
}
var pushing = false;
async function syncNow() {
	const state = useCadence.getState();
	if (!state.serverUrl || !state.serverToken) return;
	useCadence.setState({
		syncStatus: "syncing",
		syncError: null
	});
	pushing = true;
	try {
		const remote = await pullDoc(state.serverUrl, state.serverToken);
		const latest = useCadence.getState();
		const merged = {
			tasks: mergeById(latest.tasks, remote.tasks),
			categories: mergeById(latest.categories, remote.categories)
		};
		useCadence.setState({
			...merged,
			syncStatus: "syncing"
		});
		await pushDoc(latest.serverUrl, latest.serverToken, merged);
		useCadence.setState({
			syncStatus: "ok",
			syncError: null
		});
	} catch (error) {
		useCadence.setState({
			syncStatus: "error",
			syncError: error instanceof Error ? error.message : "Could not reach the server."
		});
	} finally {
		pushing = false;
	}
}
async function pushNow() {
	const state = useCadence.getState();
	if (!state.serverUrl || !state.serverToken || pushing) return;
	pushing = true;
	useCadence.setState({
		syncStatus: "syncing",
		syncError: null
	});
	try {
		const latest = useCadence.getState();
		await pushDoc(latest.serverUrl, latest.serverToken, {
			tasks: latest.tasks,
			categories: latest.categories
		});
		useCadence.setState({
			syncStatus: "ok",
			syncError: null
		});
	} catch (error) {
		useCadence.setState({
			syncStatus: "error",
			syncError: error instanceof Error ? error.message : "Could not reach the server."
		});
	} finally {
		pushing = false;
	}
}
function bindSync() {
	let timer;
	return useCadence.subscribe((state, prev) => {
		if (!state.hasHydrated || !state.serverUrl || !state.serverToken) return;
		if (state.tasks === prev.tasks && state.categories === prev.categories) return;
		if (pushing) return;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			pushNow();
		}, 600);
	});
}
function Detail({ taskId, onClose }) {
	const task = useCadence((s) => s.tasks.find((item) => item.id === taskId && !item.deleted));
	const categories = useCadence((s) => s.categories);
	if (!task) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DetailBody, {
		task,
		categories,
		onClose
	}, task.id);
}
function DetailBody({ task, categories, onClose }) {
	const updateTask = useCadence((s) => s.updateTask);
	const deleteTask = useCadence((s) => s.deleteTask);
	const addCategory = useCadence((s) => s.addCategory);
	const visibleDate = shownDate(task, todayKey());
	const [title, setTitle] = (0, import_react.useState)(task.title);
	const [notes, setNotes] = (0, import_react.useState)(task.notes);
	const [categoryId, setCategoryId] = (0, import_react.useState)(task.categoryId);
	const [date, setDate] = (0, import_react.useState)(visibleDate);
	const [repeat, setRepeat] = (0, import_react.useState)(task.repeat);
	const [repeatOpen, setRepeatOpen] = (0, import_react.useState)(false);
	const dateTouched = (0, import_react.useRef)(false);
	const saved = (0, import_react.useRef)({
		title: task.title,
		notes: task.notes,
		categoryId: task.categoryId,
		date: task.date,
		repeat: normalizeRepeat(task.repeat)
	});
	const skipSave = (0, import_react.useRef)(false);
	const active = categories.filter((c) => !c.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	function save(overrides = {}, notice) {
		const next = {
			title,
			notes,
			categoryId,
			date: overrides.date !== void 0 || dateTouched.current ? date : task.date,
			repeat,
			...overrides
		};
		const clean = {
			...next,
			title: next.title.trim().slice(0, 200) || task.title,
			notes: next.notes.slice(0, 2e4),
			repeat: normalizeRepeat(next.repeat)
		};
		const previous = saved.current;
		if (clean.title === previous.title && clean.notes === previous.notes && clean.categoryId === previous.categoryId && clean.date === previous.date && JSON.stringify(clean.repeat) === JSON.stringify(previous.repeat)) return;
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Modal, {
		open: true,
		onOpenChange: (open) => {
			if (!open) close();
		},
		title: "Details",
		description: "Category, notes, and schedule stay on this task.",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
				className: "sr-only",
				htmlFor: "task-title",
				children: "Task name"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				id: "task-title",
				className: "title-input",
				value: title,
				onChange: (event) => setTitle(event.target.value),
				onBlur: () => save(),
				placeholder: "Task name"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionLabel, { children: "Category" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-2",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CategoryPicker, {
						categoryId,
						categories: active,
						onChange: (id) => save({ categoryId: id }),
						onCreate: (name) => {
							const id = addCategory(name);
							if (id) save({ categoryId: id });
						}
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionLabel, { children: "Notes" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					className: "notes-area mt-2",
					value: notes,
					onChange: (event) => setNotes(event.target.value),
					onBlur: () => save(),
					placeholder: "Add the details you'll want later.",
					"aria-label": "Notes"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 border-t border-line pt-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionLabel, { children: "Schedule" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-2",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DateChooser, {
							date,
							onChange: (next) => {
								dateTouched.current = true;
								const todayNow = todayKey();
								save({ date: next }, next ? `Moved to ${formatWhen(next, todayNow)}` : "Moved to later");
							}
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						className: "mt-3",
						variant: "quiet",
						"aria-expanded": repeatOpen,
						onClick: () => setRepeatOpen((open) => !open),
						children: repeatOpen ? "Hide repeat" : repeat.kind === "none" ? "Doesn't repeat" : "Change repeat"
					}),
					repeatOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RepeatChooser, {
							repeat,
							date,
							onChange: (next) => save({ repeat: next })
						})
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: "Only the next time shows on the list. Checking it off moves this task forward. Notes stay."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-6 flex justify-end",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "danger",
					onClick: () => {
						skipSave.current = true;
						deleteTask(task.id);
						onClose();
					},
					children: "Delete task"
				})
			})
		]
	});
}
function CategoriesDialog({ onClose }) {
	const categories = useCadence((s) => s.categories);
	const addCategory = useCadence((s) => s.addCategory);
	const renameCategory = useCadence((s) => s.renameCategory);
	const deleteCategory = useCadence((s) => s.deleteCategory);
	const [draft, setDraft] = (0, import_react.useState)("");
	const items = activeCategories(categories);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Modal, {
		open: true,
		onOpenChange: (open) => {
			if (!open) onClose();
		},
		title: "Categories",
		description: "A task sits in one category. Filter the list with the chips under search.",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "space-y-2",
				children: items.map((category) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CategoryRow, {
					name: category.name,
					onRename: (name) => renameCategory(category.id, name),
					onDelete: () => deleteCategory(category.id)
				}, category.id))
			}),
			items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "No categories yet."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-4 flex gap-2",
				onSubmit: (event) => {
					event.preventDefault();
					if (addCategory(draft)) setDraft("");
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					className: "field",
					value: draft,
					onChange: (event) => setDraft(event.target.value),
					placeholder: "New category",
					"aria-label": "New category",
					maxLength: 40
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					variant: "primary",
					disabled: !draft.trim(),
					children: "Add"
				})]
			})
		]
	});
}
function CategoryRow({ name, onRename, onDelete }) {
	const [value, setValue] = (0, import_react.useState)(name);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			className: "field",
			value,
			"aria-label": `Rename ${name}`,
			maxLength: 40,
			onChange: (event) => setValue(event.target.value),
			onBlur: () => onRename(value)
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "grid size-11 shrink-0 place-items-center rounded-full text-danger",
			"aria-label": `Delete ${name}`,
			onClick: onDelete,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" })
		})]
	});
}
function SettingsDialog({ onClose }) {
	const serverUrl = useCadence((s) => s.serverUrl);
	const serverToken = useCadence((s) => s.serverToken);
	const syncStatus = useCadence((s) => s.syncStatus);
	const syncError = useCadence((s) => s.syncError);
	const setServer = useCadence((s) => s.setServer);
	const importDoc = useCadence((s) => s.importDoc);
	const resetSamples = useCadence((s) => s.resetSamples);
	const clearDone = useCadence((s) => s.clearDone);
	const tasks = useCadence((s) => s.tasks);
	const categories = useCadence((s) => s.categories);
	const [url, setUrl] = (0, import_react.useState)(serverUrl);
	const [token, setToken] = (0, import_react.useState)(serverToken);
	const [message, setMessage] = (0, import_react.useState)(null);
	const [confirmReset, setConfirmReset] = (0, import_react.useState)(false);
	async function saveServer() {
		const next = normalizeServerUrl(url);
		if (next === null) {
			setMessage("Enter a full address, including http or https.");
			return;
		}
		setServer(next, token.trim());
		setUrl(next);
		if (!next || !token.trim()) {
			setMessage("Server cleared. Tasks stay on this device.");
			return;
		}
		setMessage("Checking the server…");
		try {
			await checkServer(next, token.trim());
			await syncNow();
			setMessage("Connected. Notes, categories, and tasks will stay in sync.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Could not reach the server.");
		}
	}
	function exportJson() {
		const blob = new Blob([JSON.stringify({
			tasks: tasks.filter((task) => !task.deleted),
			categories: categories.filter((category) => !category.deleted)
		}, null, 2)], { type: "application/json" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = "cadence.json";
		link.click();
		URL.revokeObjectURL(link.href);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Modal, {
		open: true,
		onOpenChange: (open) => {
			if (!open) onClose();
		},
		title: "Settings",
		description: "This device keeps your list. Connect a server when you want the Android app to share it.",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionLabel, { children: "Your server" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-pretty text-muted",
					children: "Optional. Leave this blank to keep everything here. The download below is a small server plus an Android app with a home-screen widget. Put the server on your own machine, then paste its address and token here and in the phone app."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "mt-3 block text-sm font-medium",
					htmlFor: "server-url",
					children: "Address"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					id: "server-url",
					className: "field mt-1",
					value: url,
					onChange: (event) => setUrl(event.target.value),
					placeholder: "https://tasks.example.com",
					autoComplete: "off"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "mt-3 block text-sm font-medium",
					htmlFor: "server-token",
					children: "Token"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					id: "server-token",
					className: "field mt-1",
					value: token,
					onChange: (event) => setToken(event.target.value),
					placeholder: "Secret from your server",
					type: "password",
					autoComplete: "off"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3 flex flex-wrap gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "primary",
						onClick: () => void saveServer(),
						children: "Save and sync"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						className: "inline-flex min-h-11 items-center rounded-full bg-paper-2 px-4 text-sm font-medium text-ink",
						href: "/cadence-pack.zip",
						download: true,
						children: "Download server and Android app"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: message ?? (syncStatus === "ok" ? "Synced." : syncStatus === "syncing" ? "Syncing…" : syncStatus === "error" ? syncError : "Not connected.")
				})
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 border-t border-line pt-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SectionLabel, { children: "Backup" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3 flex flex-wrap gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: exportJson,
						children: "Export"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "inline-flex min-h-11 cursor-pointer items-center rounded-full bg-paper-2 px-4 text-sm font-medium",
						children: ["Import", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "sr-only",
							type: "file",
							accept: "application/json",
							onChange: async (event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (!file) return;
								try {
									const doc = readDoc(JSON.parse(await file.text()));
									importDoc(doc);
									setMessage("Imported.");
								} catch {
									setMessage("That file could not be read.");
								}
							}
						})]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "mt-6 border-t border-line pt-5",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: clearDone,
						children: "Clear finished"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "danger",
						onClick: () => {
							if (!confirmReset) {
								setConfirmReset(true);
								return;
							}
							resetSamples();
							setConfirmReset(false);
						},
						children: confirmReset ? "Replace list with samples" : "Restore samples"
					})]
				})
			})
		]
	});
}
var VIEWS = [
	{
		id: "day",
		label: "Today"
	},
	{
		id: "upcoming",
		label: "Upcoming"
	},
	{
		id: "overdue",
		label: "Overdue"
	},
	{
		id: "later",
		label: "Later"
	},
	{
		id: "repeats",
		label: "Repeats"
	},
	{
		id: "done",
		label: "Done"
	}
];
function CadenceShell() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto flex h-dvh w-full max-w-xl flex-col bg-paper px-5 pt-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-4 w-20 rounded-full bg-paper-2" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-4 h-10 w-48 rounded-xl bg-paper-2" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-8 h-24 rounded-2xl bg-card" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-3 h-24 rounded-2xl bg-card" })
		]
	});
}
function CadenceScreen() {
	const state = useCadence();
	const [detailId, setDetailId] = (0, import_react.useState)(null);
	const [settingsOpen, setSettingsOpen] = (0, import_react.useState)(false);
	const [categoriesOpen, setCategoriesOpen] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		const unsub = bindSync();
		syncNow();
		return unsub;
	}, []);
	(0, import_react.useEffect)(() => {
		if (!state.notice) return;
		const id = window.setTimeout(() => state.dismissNotice(), 5e3);
		return () => window.clearTimeout(id);
	}, [state.notice, state.dismissNotice]);
	const today = todayKey();
	const focus = state.focusDate || today;
	const refine = {
		query: state.query,
		categoryId: state.categoryFilter,
		showRepeating: state.showRepeating
	};
	const groups = buildGroups(state.tasks, state.categories, state.view, focus, today, refine);
	const categories = activeCategories(state.categories);
	const filtering = state.query.trim().length > 0 || !!state.categoryFilter || !state.showRepeating;
	const overdueCount = countFor(state.tasks, state.categories, "overdue", focus, today, refine);
	const header = headerCopy(state.view, focus, today);
	const openCount = countFor(state.tasks, state.categories, state.view, focus, today, refine);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto flex h-dvh w-full max-w-xl flex-col overflow-hidden bg-paper text-ink",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "shrink-0 px-5 pt-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm font-medium text-muted",
							children: "Cadence"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								variant: "ghost",
								className: "px-3",
								onClick: () => setCategoriesOpen(true),
								children: "Categories"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "relative grid size-11 place-items-center rounded-full text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
								"aria-label": "Settings",
								onClick: () => setSettingsOpen(true),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Settings, { className: "size-5" }), state.serverUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `absolute right-2 top-2 size-2 rounded-full ${state.syncStatus === "error" ? "bg-danger" : "bg-sage"}` }) : null]
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "font-display text-display text-ink",
						children: header.title
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-1 text-sm text-muted",
						children: [header.sub, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "tabular-nums",
							children: [
								" · ",
								openCount,
								" ",
								state.view === "done" ? "finished" : "open"
							]
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "no-scrollbar mt-4 flex shrink-0 gap-2 overflow-x-auto px-5 pb-2",
				children: [VIEWS.map((view) => {
					const active = state.view === view.id;
					const count = countFor(state.tasks, state.categories, view.id, view.id === "day" ? focus : today, today, refine);
					const label = view.id === "day" ? focus === today ? "Today" : formatWhen(focus, today) : view.label;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Chip, {
						active,
						"aria-current": active ? "true" : void 0,
						onClick: () => state.setView(view.id),
						children: [label, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ml-2 tabular-nums",
							children: count
						})]
					}, view.id);
				}), state.view !== "repeats" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
					active: !state.showRepeating,
					"aria-pressed": !state.showRepeating,
					onClick: () => state.setShowRepeating(!state.showRepeating),
					children: state.showRepeating ? "Hide repeats" : "Repeats hidden"
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "shrink-0 px-5 pb-2",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					className: "field",
					type: "search",
					value: state.query,
					onChange: (event) => state.setQuery(event.target.value),
					placeholder: "Filter tasks",
					"aria-label": "Filter tasks"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-5 pb-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: !state.categoryFilter,
						onClick: () => state.setCategoryFilter(null),
						children: "All"
					}),
					categories.map((category) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: state.categoryFilter === category.id,
						onClick: () => state.setCategoryFilter(state.categoryFilter === category.id ? null : category.id),
						children: category.name
					}, category.id)),
					filtering ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "ghost",
						onClick: state.clearFilters,
						children: "Clear filters"
					}) : null
				]
			}),
			state.view === "day" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WeekStrip, {
				focus,
				today,
				tasks: state.tasks,
				categoryFilter: state.categoryFilter,
				showRepeating: state.showRepeating,
				onSelect: state.setFocusDate
			}) : null,
			state.view === "day" && focus === today && overdueCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "shrink-0 px-5 pb-3",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "flex min-h-11 w-full items-center justify-between rounded-2xl bg-danger-soft px-4 text-sm font-medium text-danger",
					onClick: () => state.setView("overdue"),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "tabular-nums",
						children: [overdueCount, " overdue"]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Show" })]
				})
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
				className: "min-h-0 flex-1 overflow-y-auto pb-4",
				children: groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
					view: state.view,
					filtering,
					onClear: state.clearFilters
				}) : groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [group.label ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "px-5 pt-4 font-display text-2xl text-ink",
					children: group.label
				}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: group.tasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
					task,
					category: categoryName(state.categories, task.categoryId),
					today,
					onOpen: () => setDetailId(task.id)
				}, task.id)) })] }, group.key))
			}),
			state.notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "shrink-0 px-5",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between gap-3 rounded-2xl bg-paper-2 px-4 py-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm",
						children: state.notice.text
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "ghost",
						onClick: state.undo,
						children: "Undo"
					})]
				})
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Composer, {
				view: state.view,
				focus,
				categoryFilter: state.categoryFilter
			}),
			detailId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Detail, {
				taskId: detailId,
				onClose: () => setDetailId(null)
			}) : null,
			settingsOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsDialog, { onClose: () => setSettingsOpen(false) }) : null,
			categoriesOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CategoriesDialog, { onClose: () => setCategoriesOpen(false) }) : null
		]
	});
}
function headerCopy(view, focus, today) {
	if (view === "day") {
		const when = focus === today ? "Today" : focus === addDays(today, 1) ? "Tomorrow" : focus === addDays(today, -1) ? "Yesterday" : "";
		return {
			title: weekdayName(focus),
			sub: [monthDay(focus), when].filter(Boolean).join(" · ")
		};
	}
	return {
		upcoming: {
			title: "Upcoming",
			sub: "Dated after today"
		},
		overdue: {
			title: "Overdue",
			sub: "Still open from earlier days"
		},
		later: {
			title: "Later",
			sub: "No date yet"
		},
		repeats: {
			title: "Repeats",
			sub: "Each one shows only its next time"
		},
		done: {
			title: "Done",
			sub: "One-time tasks you finished"
		}
	}[view];
}
function WeekStrip({ focus, today, tasks, categoryFilter, showRepeating, onSelect }) {
	const start = startOfWeek(focus);
	const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex shrink-0 items-center gap-1 px-3 pb-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "grid size-11 shrink-0 place-items-center rounded-full text-ink",
				"aria-label": "Previous week",
				onClick: () => onSelect(addDays(focus, -7)),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid min-w-0 flex-1 grid-cols-7 gap-1",
				children: days.map((day) => {
					const selected = day === focus;
					const count = tasks.filter((task) => {
						if (task.deleted || task.done || shownDate(task, today) !== day) return false;
						if (categoryFilter && task.categoryId !== categoryFilter) return false;
						if (!showRepeating && task.repeat.kind !== "none") return false;
						return true;
					}).length;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-pressed": selected,
						"aria-label": formatWhen(day, today),
						className: `flex min-h-11 flex-col items-center justify-center rounded-2xl text-ink ${selected ? "bg-ink text-paper" : day === today ? "bg-paper-2" : ""}`,
						onClick: () => onSelect(day),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: `text-xs ${selected ? "text-paper" : "text-muted"}`,
								children: DAY_SHORT[(/* @__PURE__ */ new Date(`${day}T12:00:00`)).getDay()]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-sm font-medium tabular-nums",
								children: Number(day.slice(-2))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `mt-0.5 size-1 rounded-full ${count ? selected ? "bg-paper" : "bg-ink" : "bg-transparent"}` })
						]
					}, day);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "grid size-11 shrink-0 place-items-center rounded-full text-ink",
				"aria-label": "Next week",
				onClick: () => onSelect(addDays(focus, 7)),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
			})
		]
	});
}
function TaskRow({ task, category, today, onOpen }) {
	const moveTask = useCadence((s) => s.moveTask);
	const toggleTask = useCadence((s) => s.toggleTask);
	const [moveOpen, setMoveOpen] = (0, import_react.useState)(false);
	const when = shownDate(task, today);
	const preview = notePreview(task.notes);
	const meta = [category, task.repeat.kind !== "none" ? repeatLabel(task.repeat, "short") : null].filter(Boolean).join(" · ");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "border-b border-line px-5 py-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start gap-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					role: "checkbox",
					"aria-checked": task.done,
					"aria-label": task.repeat.kind === "none" ? `Complete ${task.title}` : `Done. Move ${task.title} to the next time`,
					className: "grid size-11 shrink-0 place-items-center",
					onClick: () => toggleTask(task.id),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `size-5 rounded-full border border-ink ${task.done ? "bg-ink" : "bg-transparent"}` })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "min-w-0 flex-1 py-2 text-left",
					onClick: onOpen,
					"aria-label": `Details for ${task.title}`,
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: `block font-medium ${task.done ? "text-muted line-through" : "text-ink"}`,
							children: task.title
						}),
						meta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "mt-0.5 block text-sm text-muted",
							children: meta
						}) : null,
						preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "mt-1 block truncate text-sm text-pretty text-muted",
							children: preview
						}) : null
					]
				})]
			}),
			!task.done ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-1 flex items-center gap-1 pl-12",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "grid size-11 place-items-center rounded-full text-ink disabled:opacity-40",
						"aria-label": "One day earlier",
						disabled: !when,
						onClick: () => when && moveTask(task.id, addDays(when, -1)),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "min-w-0 flex-1 text-center text-sm tabular-nums text-muted",
						children: when ? formatWhen(when, today) : "No date"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "grid size-11 place-items-center rounded-full text-ink",
						"aria-label": when ? "One day later" : "Set to today",
						onClick: () => moveTask(task.id, when ? addDays(when, 1) : today),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "quiet",
						onClick: () => setMoveOpen(true),
						children: "Move"
					})
				]
			}) : null,
			moveOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, {
				open: true,
				onOpenChange: setMoveOpen,
				title: "Move",
				description: task.repeat.kind === "none" ? task.title : `${task.title}. Only this next time is shown. Moving it changes where that one sits.`,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DateChooser, {
					date: when,
					calendarDefaultOpen: true,
					onChange: (date) => {
						moveTask(task.id, date);
						setMoveOpen(false);
					}
				})
			}) : null
		]
	});
}
function Empty({ view, filtering, onClear }) {
	if (filtering) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-5 py-16 text-center",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-display text-2xl text-ink",
				children: "Nothing matches"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Those filters are hiding every task."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				className: "mt-4",
				onClick: onClear,
				children: "Clear filters"
			})
		]
	});
	const copy = {
		day: {
			title: "Nothing on this day",
			body: "Add a task below, then open it to write notes or choose a category."
		},
		upcoming: {
			title: "Nothing upcoming",
			body: "Tasks with a future date will gather here."
		},
		overdue: {
			title: "Nothing overdue",
			body: "Anything still open from an earlier day shows up here."
		},
		later: {
			title: "Nothing without a date",
			body: "Move a task off the calendar and it waits here."
		},
		repeats: {
			title: "No repeating tasks",
			body: "A repeat shows up once, on its next date. Checking it off moves that same task forward."
		},
		done: {
			title: "Nothing finished",
			body: "One-time tasks you check off land here. Repeats schedule their next date instead."
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-5 py-16 text-center",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-display text-2xl text-ink",
			children: copy[view].title
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-sm text-pretty text-muted",
			children: copy[view].body
		})]
	});
}
function Composer({ view, focus, categoryFilter }) {
	const categories = useCadence((s) => activeCategories(s.categories));
	const addTask = useCadence((s) => s.addTask);
	const addCategory = useCadence((s) => s.addCategory);
	const today = todayKey();
	const defaultDate = view === "later" ? null : view === "upcoming" ? addDays(today, 1) : view === "day" ? focus : today;
	const [title, setTitle] = (0, import_react.useState)("");
	const [notes, setNotes] = (0, import_react.useState)("");
	const [notesOpen, setNotesOpen] = (0, import_react.useState)(false);
	const [date, setDate] = (0, import_react.useState)(defaultDate);
	const [repeat, setRepeat] = (0, import_react.useState)(view === "repeats" ? { kind: "daily" } : { kind: "none" });
	const [categoryId, setCategoryId] = (0, import_react.useState)(categoryFilter);
	const [dateOpen, setDateOpen] = (0, import_react.useState)(false);
	const [repeatOpen, setRepeatOpen] = (0, import_react.useState)(false);
	const [categoryOpen, setCategoryOpen] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		setDate(defaultDate);
		setCategoryId(categoryFilter);
	}, [defaultDate, categoryFilter]);
	const category = categories.find((item) => item.id === categoryId)?.name ?? "Category";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "safe-bottom shrink-0 border-t border-line bg-paper px-5 pt-3",
		onSubmit: (event) => {
			event.preventDefault();
			if (!title.trim()) return;
			addTask({
				title,
				notes,
				categoryId,
				date,
				repeat
			});
			setTitle("");
			setNotes("");
			setNotesOpen(false);
			setRepeat(view === "repeats" ? { kind: "daily" } : { kind: "none" });
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "sr-only",
						htmlFor: "new-task",
						children: "New task"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						id: "new-task",
						className: "field",
						value: title,
						onChange: (event) => setTitle(event.target.value),
						placeholder: view === "later" ? "Add a task for later" : "Add a task"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						variant: "primary",
						disabled: !title.trim(),
						children: "Add"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						onClick: () => setDateOpen(true),
						children: date ? formatWhen(date, today) : "No date"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						onClick: () => setRepeatOpen(true),
						children: repeatLabel(repeat, "short")
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: !!categoryId,
						onClick: () => setCategoryOpen(true),
						children: category
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: notesOpen || notes.trim().length > 0,
						"aria-expanded": notesOpen,
						onClick: () => setNotesOpen((open) => !open),
						children: "Notes"
					})
				]
			}),
			notesOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "pb-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
					className: "text-sm font-medium text-muted",
					htmlFor: "new-notes",
					children: "Notes"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					id: "new-notes",
					className: "notes-area mt-2",
					value: notes,
					onChange: (event) => setNotes(event.target.value),
					placeholder: "Add the details you'll want later."
				})]
			}) : null,
			dateOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, {
				open: true,
				onOpenChange: setDateOpen,
				title: "Date",
				description: "Where this task should land.",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DateChooser, {
					date,
					calendarDefaultOpen: true,
					onChange: (next) => {
						setDate(next);
						setDateOpen(false);
					}
				})
			}) : null,
			repeatOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, {
				open: true,
				onOpenChange: setRepeatOpen,
				title: "Repeat",
				description: "The next date is set when you finish this one.",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RepeatChooser, {
					repeat,
					date,
					onChange: setRepeat
				})
			}) : null,
			categoryOpen ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Modal, {
				open: true,
				onOpenChange: setCategoryOpen,
				title: "Category",
				description: "Choose one category for this task.",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: !categoryId,
						onClick: () => {
							setCategoryId(null);
							setCategoryOpen(false);
						},
						children: "None"
					}), categories.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chip, {
						active: categoryId === item.id,
						onClick: () => {
							setCategoryId(item.id);
							setCategoryOpen(false);
						},
						children: item.name
					}, item.id))]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CategoryCreate, { onCreate: (name) => {
					const id = addCategory(name);
					if (id) setCategoryId(id);
					setCategoryOpen(false);
				} })]
			}) : null
		]
	});
}
function CategoryCreate({ onCreate }) {
	const [name, setName] = (0, import_react.useState)("");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "mt-3 flex gap-2",
		onSubmit: (event) => {
			event.preventDefault();
			if (!name.trim()) return;
			onCreate(name);
		},
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			className: "field",
			value: name,
			onChange: (event) => setName(event.target.value),
			placeholder: "New category",
			"aria-label": "New category",
			maxLength: 40
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			type: "submit",
			variant: "primary",
			disabled: !name.trim(),
			children: "Add"
		})]
	});
}
function Home() {
	const hydrated = useCadence((s) => s.hasHydrated);
	const [mounted, setMounted] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		setMounted(true);
		bootCadence();
	}, []);
	if (!mounted || !hydrated) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CadenceShell, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CadenceScreen, {});
}
//#endregion
export { Home as component };
