// Shows and edits a value of each property type.
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, CloseIcon, PlusIcon } from "#/components/icons";
import { Avatar, Popover, Spinner } from "#/components/ui";
import { uploadFile } from "#/functions/files";
import { errorText } from "#/lib/errors";
import { safeHref } from "#/lib/links";
import type { DatabaseStore } from "./store";
import { isComputedError } from "./store";
import type { Choice, DateValue, FileValue, Property } from "./types";
import { COLOR_CYCLE, isComputed } from "./types";
import { Chip, useListNav, useOpenFocus, useStoreVersion } from "./ui";
import {
	asArray,
	choiceById,
	displayText,
	formatDateTime,
	formatDateValue,
	formatNumberValue,
} from "./values";

// ---------- Display ----------

export function CellDisplay({
	store,
	rowId,
	prop,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
}) {
	const value = store.value(rowId, prop.id);
	if (isComputedError(value))
		return (
			<span className="truncate text-sm text-coral" title={value.error}>
				{value.label ?? "Error"}
			</span>
		);
	if (prop.type === "ai" && store.aiFilling.has(`${rowId}|${prop.id}`))
		return (
			<span className="flex w-full items-center gap-2">
				<span className="h-2 w-1/2 rounded-sm bg-link-soft" />
				<span className="text-sm text-link">Writing</span>
			</span>
		);
	return <ValueDisplay store={store} prop={prop} value={value} rowId={rowId} />;
}

export function ValueDisplay({
	store,
	prop,
	value,
}: {
	store: DatabaseStore;
	prop: Property;
	value: unknown;
	rowId?: string;
}) {
	switch (prop.type) {
		case "title":
			return (
				<span className="truncate font-medium text-ink">
					{String(value ?? "") || <span className="text-pencil">Untitled</span>}
				</span>
			);
		case "number":
			return (
				<span className="truncate text-graphite tabular-nums">
					{formatNumberValue(value, prop.options.format, prop.options.decimals)}
				</span>
			);
		case "select":
		case "status": {
			const choice = choiceById(prop, value);
			return choice ? <Chip color={choice.color}>{choice.name}</Chip> : null;
		}
		case "multi_select":
			return (
				<span className="flex min-w-0 items-center gap-1 overflow-hidden">
					{asArray(value).map((id) => {
						const choice = choiceById(prop, id);
						return choice ? (
							<Chip key={choice.id} color={choice.color}>
								{choice.name}
							</Chip>
						) : null;
					})}
				</span>
			);
		case "date":
			return (
				<span className="truncate text-graphite">
					{formatDateValue(value as DateValue)}
				</span>
			);
		case "person":
		case "created_by":
		case "edited_by":
			return (
				<span className="flex min-w-0 items-center gap-1 overflow-hidden">
					{asArray(value).map((id) => (
						<span key={String(id)} className="flex min-w-0 items-center gap-1">
							<Avatar
								id={String(id)}
								name={store.names.person(String(id))}
								size={18}
							/>
							<span className="truncate text-graphite">
								{store.names.person(String(id))}
							</span>
						</span>
					))}
				</span>
			);
		case "checkbox":
			return (
				<span
					className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${value ? "border-link bg-accent text-white" : "border-rule-strong"}`}
				>
					{Boolean(value) && <CheckIcon size={11} />}
				</span>
			);
		case "url": {
			if (!value) return null;
			const href = safeHref(String(value));
			if (!href) return <span className="truncate">{String(value)}</span>;
			return (
				<a
					href={href}
					target="_blank"
					rel="noreferrer"
					className="truncate text-link underline-offset-2 hover:underline"
					onClick={(e) => e.stopPropagation()}
				>
					{String(value)}
				</a>
			);
		}
		case "email":
			return value ? (
				<a
					href={`mailto:${value}`}
					className="truncate text-link underline-offset-2 hover:underline"
					onClick={(e) => e.stopPropagation()}
				>
					{String(value)}
				</a>
			) : null;
		case "phone":
			return value ? (
				<a
					href={`tel:${value}`}
					className="truncate text-link underline-offset-2 hover:underline"
					onClick={(e) => e.stopPropagation()}
				>
					{String(value)}
				</a>
			) : null;
		case "files":
			return (
				<span className="flex min-w-0 items-center gap-1 overflow-hidden">
					{asArray(value).map((file, i) => (
						<span
							key={(file as FileValue).fileId ?? i}
							className="truncate text-sm text-graphite"
						>
							{(file as FileValue).name}
						</span>
					))}
				</span>
			);
		case "relation": {
			const ids = asArray(value).map(String);
			if (!ids.length) return null;
			const targetId = prop.options.targetDatabaseId ?? "";
			return (
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-link">
						{store.names.row(targetId, ids[0])}
					</span>
					{ids.length > 1 && (
						<span className="shrink-0 text-pencil">+{ids.length - 1}</span>
					)}
				</span>
			);
		}
		case "created_time":
		case "edited_time":
			return (
				<span className="truncate text-graphite">
					{formatDateTime(String(value ?? ""))}
				</span>
			);
		default:
			return (
				<span className="truncate text-graphite">
					{displayText(prop, value, store.names)}
				</span>
			);
	}
}

// ---------- Editors ----------

export const inlineEditable = (prop: Property) =>
	prop.type === "title" ||
	prop.type === "text" ||
	prop.type === "number" ||
	prop.type === "url" ||
	prop.type === "email" ||
	prop.type === "phone" ||
	prop.type === "ai";

export function canEditType(prop: Property) {
	return !isComputed(prop.type);
}

function commitValue(
	store: DatabaseStore,
	rowId: string,
	prop: Property,
	value: unknown,
) {
	if (prop.type === "title") store.setTitle(rowId, String(value ?? ""));
	else if (prop.type === "relation")
		store.setRelation(rowId, prop, asArray(value).map(String));
	else store.setCell(rowId, prop.id, value);
}

// Text, number, URL, email, phone: an input over the cell.
export function InlineEditor({
	store,
	rowId,
	prop,
	initial,
	onDone,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	initial?: string;
	onDone: (move?: "next" | "down" | "up") => void;
}) {
	const value = store.value(rowId, prop.id);
	const [text, setText] = useState(
		initial ??
			(prop.type === "number"
				? value === null || value === undefined
					? ""
					: String(value)
				: String(value ?? "")),
	);
	const ref = useRef<HTMLInputElement>(null);
	const cancelled = useRef(false);
	const openedAt = useRef(0);
	const [badNumber, setBadNumber] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		openedAt.current = performance.now();
		el.focus();
		// A click edits at the end of the value; typing a letter into a cell replaces it.
		if (initial === undefined)
			el.setSelectionRange(el.value.length, el.value.length);
	}, [initial]);

	const commit = () => {
		if (cancelled.current) return true;
		if (prop.type === "number") {
			const trimmed = text.trim();
			const n = trimmed === "" ? null : Number(trimmed);
			if (n !== null && Number.isNaN(n)) {
				setBadNumber(true);
				return false;
			}
			if (n !== value) commitValue(store, rowId, prop, n);
		} else if (text !== (value ?? "")) {
			commitValue(store, rowId, prop, text);
		}
		return true;
	};

	return (
		<input
			ref={ref}
			aria-label={`Edit ${prop.name}`}
			className={`h-full w-full bg-transparent text-base text-ink outline-none ${badNumber ? "text-coral" : ""}`}
			value={text}
			inputMode={prop.type === "number" ? "decimal" : undefined}
			aria-invalid={badNumber}
			title={badNumber ? "Enter a number" : undefined}
			// A double-click on the cell means "replace this", as it does in a spreadsheet. Later
			// double-clicks are the browser's own word selection.
			onDoubleClick={(e) => {
				if (performance.now() - openedAt.current < 600)
					e.currentTarget.select();
			}}
			onChange={(e) => {
				setBadNumber(false);
				setText(e.target.value);
			}}
			onBlur={() => {
				commit();
				onDone();
			}}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter") {
					if (commit()) onDone("down");
				} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					// One line has nowhere to go up or down, so these keep moving through the grid.
					e.preventDefault();
					if (commit()) onDone(e.key === "ArrowDown" ? "down" : "up");
				} else if (e.key === "Tab") {
					e.preventDefault();
					if (commit()) onDone("next");
				} else if (e.key === "Escape") {
					cancelled.current = true;
					onDone();
				}
			}}
		/>
	);
}

// Select, multi-select and status.
export function ChoiceEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const multi = prop.type === "multi_select";
	const value = store.value(rowId, prop.id);
	const selected = asArray(value).map(String);
	const [query, setQuery] = useState("");
	const choiceInput = useOpenFocus<HTMLInputElement>();
	const choices = prop.options.choices ?? [];
	const filtered = choices.filter((c) =>
		c.name.toLowerCase().includes(query.toLowerCase()),
	);
	const exact = choices.some(
		(c) => c.name.toLowerCase() === query.trim().toLowerCase(),
	);

	const select = (id: string) => {
		if (multi) {
			const next = selected.includes(id)
				? selected.filter((x) => x !== id)
				: [...selected, id];
			commitValue(store, rowId, prop, next);
			setQuery("");
		} else {
			commitValue(store, rowId, prop, selected.includes(id) ? null : id);
			onClose();
		}
	};

	const create = () => {
		const name = query.trim();
		if (!name || exact) return;
		const choice: Choice = {
			id: `opt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			name,
			color: COLOR_CYCLE[choices.length % COLOR_CYCLE.length],
		};
		void store.updateProperty(prop.id, {
			options: { ...prop.options, choices: [...choices, choice] },
		});
		setQuery("");
		select(choice.id);
	};

	const nav = useListNav(filtered.length, (index) => {
		const choice = filtered[index];
		if (choice && (exact || !query.trim() || filtered.length === 1)) {
			// Enter sets a single choice even if it's already set; only a click clears it.
			if (!multi && selected.includes(choice.id)) onClose();
			else select(choice.id);
		} else if (query.trim()) create();
	});

	return (
		<Popover anchor={anchor} open onClose={onClose} className="w-[260px] p-1">
			<input
				ref={choiceInput}
				aria-label={`Find or add a ${prop.name} option`}
				className="mb-1 h-8 w-full rounded-md border border-rule bg-paper px-2 text-sm outline-none focus:border-link"
				placeholder="Find or add an option"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={nav.onKeyDown}
			/>
			<div className="max-h-[260px] overflow-auto">
				{filtered.map((choice, index) => (
					<button
						key={choice.id}
						type="button"
						onClick={() => select(choice.id)}
						onMouseEnter={() => nav.setActive(index)}
						className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left ${nav.active === index ? "bg-wash-2" : ""}`}
					>
						<Chip color={choice.color}>{choice.name}</Chip>
						<span className="flex-1" />
						{selected.includes(choice.id) && (
							<CheckIcon size={14} className="text-link" />
						)}
					</button>
				))}
				{query.trim() && !exact && (
					<button
						type="button"
						onClick={create}
						className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-link hover:bg-wash-2"
					>
						<PlusIcon size={12} /> Add "{query.trim()}"
					</button>
				)}
				{!filtered.length && !query.trim() && (
					<p className="px-2 py-1 text-sm text-pencil">No options yet.</p>
				)}
			</div>
		</Popover>
	);
}

// Person: anyone in the workspace.
export function PersonEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const selected = asArray(store.value(rowId, prop.id)).map(String);
	const [query, setQuery] = useState("");
	const personInput = useOpenFocus<HTMLInputElement>();
	const people = [...store.members.entries()].filter(([, name]) =>
		name.toLowerCase().includes(query.toLowerCase()),
	);
	const toggle = (id: string) => {
		commitValue(
			store,
			rowId,
			prop,
			selected.includes(id)
				? selected.filter((x) => x !== id)
				: [...selected, id],
		);
	};
	const nav = useListNav(people.length, (index) => {
		if (people[index]) toggle(people[index][0]);
	});
	return (
		<Popover anchor={anchor} open onClose={onClose} className="w-[260px] p-1">
			<input
				ref={personInput}
				aria-label="Find a person"
				className="mb-1 h-8 w-full rounded-md border border-rule bg-paper px-2 text-sm outline-none focus:border-link"
				placeholder="Find a person"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={nav.onKeyDown}
			/>
			<div className="max-h-[260px] overflow-auto">
				{people.map(([id, name], index) => (
					<button
						key={id}
						type="button"
						onClick={() => toggle(id)}
						onMouseEnter={() => nav.setActive(index)}
						className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${nav.active === index ? "bg-wash-2" : ""}`}
					>
						<Avatar id={id} name={name} size={20} />
						<span className="min-w-0 flex-1 truncate">{name}</span>
						{selected.includes(id) && (
							<CheckIcon size={14} className="text-link" />
						)}
					</button>
				))}
				{!people.length && (
					<p className="px-2 py-1 text-sm text-pencil">No one found.</p>
				)}
			</div>
		</Popover>
	);
}

// ---------- Date ----------

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toDay(d: Date) {
	return d.toISOString().slice(0, 10);
}

// Today in the person's own timezone, as YYYY-MM-DD.
export function localToday() {
	const d = new Date();
	return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
}

function MonthGrid({
	month,
	selected,
	onPick,
}: {
	month: Date;
	selected: string[];
	onPick: (day: string) => void;
}) {
	const first = new Date(
		Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
	);
	const startOffset = (first.getUTCDay() + 6) % 7;
	const days = Array.from({ length: 42 }, (_, i) => {
		const d = new Date(first);
		d.setUTCDate(1 - startOffset + i);
		return d;
	});
	return (
		<div className="grid grid-cols-7 gap-0.5 text-center text-xs">
			{WEEKDAYS.map((d) => (
				<div key={d} className="h-6 leading-6 text-pencil">
					{d}
				</div>
			))}
			{days.map((d) => {
				const day = toDay(d);
				const inMonth = d.getUTCMonth() === month.getUTCMonth();
				const isSelected = selected.includes(day);
				return (
					<button
						key={day}
						type="button"
						onClick={() => onPick(day)}
						className={`h-7 rounded-sm ${isSelected ? "bg-accent text-white" : inMonth ? "text-ink hover:bg-wash-2" : "text-pencil hover:bg-wash-2"}`}
					>
						{d.getUTCDate()}
					</button>
				);
			})}
		</div>
	);
}

export function DateEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const value = store.value(rowId, prop.id) as DateValue | null;
	const [start, setStart] = useState(value?.start ?? "");
	const [end, setEnd] = useState(value?.end ?? "");
	const [hasEnd, setHasEnd] = useState(Boolean(value?.end));
	const [editing, setEditing] = useState<"start" | "end">("start");
	const initialMonth = new Date(
		`${(start || localToday()).slice(0, 10)}T00:00:00Z`,
	);
	const [month, setMonth] = useState(
		new Date(
			Date.UTC(initialMonth.getUTCFullYear(), initialMonth.getUTCMonth(), 1),
		),
	);
	const label = month.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

	const save = (s: string, e: string) => {
		if (!s) store.setCell(rowId, prop.id, null);
		else
			store.setCell(
				rowId,
				prop.id,
				e && e >= s ? { start: s, end: e } : { start: s },
			);
	};

	const pick = (day: string) => {
		if (editing === "start" || !hasEnd) {
			setStart(day);
			save(day, hasEnd ? end : "");
			if (hasEnd) setEditing("end");
		} else if (start && day < start) {
			// The end picked is earlier than the start, so it becomes the new start.
			setStart(day);
			setEnd(start);
			save(day, start);
		} else {
			setEnd(day);
			save(start, day);
		}
	};

	const selected = [start, hasEnd ? end : ""]
		.filter(Boolean)
		.map((d) => d.slice(0, 10));

	return (
		<Popover anchor={anchor} open onClose={onClose} className="w-[260px] p-3">
			<div className="mb-2 flex gap-1.5">
				<button
					type="button"
					onClick={() => setEditing("start")}
					className={`h-[30px] flex-1 rounded-md border px-2 text-sm ${editing === "start" ? "border-link" : "border-rule-strong"}`}
				>
					{start ? formatDateValue({ start }) : "Start"}
				</button>
				{hasEnd && (
					<button
						type="button"
						onClick={() => setEditing("end")}
						className={`h-[30px] flex-1 rounded-md border px-2 text-sm ${editing === "end" ? "border-link" : "border-rule-strong"}`}
					>
						{end ? formatDateValue({ start: end }) : "End"}
					</button>
				)}
			</div>
			<div className="mb-1 flex items-center justify-between text-sm">
				<button
					type="button"
					aria-label="Previous month"
					className="rounded-sm px-1.5 hover:bg-wash-2"
					onClick={() =>
						setMonth(
							new Date(
								Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1),
							),
						)
					}
				>
					‹
				</button>
				<span className="font-medium">{label}</span>
				<button
					type="button"
					aria-label="Next month"
					className="rounded-sm px-1.5 hover:bg-wash-2"
					onClick={() =>
						setMonth(
							new Date(
								Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
							),
						)
					}
				>
					›
				</button>
			</div>
			<MonthGrid month={month} selected={selected} onPick={pick} />
			<button
				type="button"
				className="mt-2 text-sm text-link hover:underline"
				onClick={() => {
					const day = localToday();
					setMonth(new Date(`${day.slice(0, 7)}-01T00:00:00Z`));
					pick(day);
				}}
			>
				Today
			</button>
			<div className="mt-2 flex items-center justify-between border-t border-rule pt-2 text-sm">
				<label className="flex items-center gap-1.5">
					<input
						type="checkbox"
						checked={hasEnd}
						onChange={(e) => {
							setHasEnd(e.target.checked);
							if (!e.target.checked) {
								setEnd("");
								save(start, "");
							} else setEditing("end");
						}}
					/>
					End date
				</label>
				<button
					type="button"
					className="text-pencil hover:text-ink"
					onClick={() => {
						store.setCell(rowId, prop.id, null);
						onClose();
					}}
				>
					Clear
				</button>
			</div>
		</Popover>
	);
}

// ---------- Files ----------

export function FilesEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const files = asArray(store.value(rowId, prop.id)) as FileValue[];
	const input = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const upload = async (list: FileList) => {
		setUploading(true);
		setError(null);
		try {
			const uploaded: FileValue[] = [];
			for (const file of Array.from(list)) {
				const form = new FormData();
				form.append("pageId", rowId);
				form.append("file", file);
				const saved = await uploadFile({ data: form });
				uploaded.push({
					fileId: saved.fileId,
					name: saved.name,
					mime: saved.mimeType,
				});
			}
			store.setCell(rowId, prop.id, [...files, ...uploaded]);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setUploading(false);
		}
	};

	return (
		<Popover anchor={anchor} open onClose={onClose} className="w-[280px] p-2">
			{files.map((file) => (
				<div key={file.fileId} className="flex h-8 items-center gap-2 text-sm">
					<a
						className="min-w-0 flex-1 truncate text-link hover:underline"
						href={`/api/files/${file.fileId}`}
						target="_blank"
						rel="noreferrer"
					>
						{file.name}
					</a>
					<button
						type="button"
						aria-label={`Remove ${file.name}`}
						className="text-pencil hover:text-ink"
						onClick={() =>
							store.setCell(
								rowId,
								prop.id,
								files.filter((f) => f.fileId !== file.fileId),
							)
						}
					>
						<CloseIcon size={12} />
					</button>
				</div>
			))}
			{error && <p className="mb-1 text-xs text-coral">{error}</p>}
			<input
				ref={input}
				type="file"
				multiple
				hidden
				aria-label="Choose files"
				onChange={(e) => {
					if (e.target.files?.length) void upload(e.target.files);
					e.target.value = "";
				}}
			/>
			<button
				type="button"
				disabled={uploading}
				onClick={() => input.current?.click()}
				className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-graphite hover:bg-wash-2 disabled:opacity-60"
			>
				{uploading ? <Spinner size={12} /> : <PlusIcon size={12} />}
				{uploading ? "Uploading" : "Add a file"}
			</button>
		</Popover>
	);
}

// ---------- Relation ----------

export function RelationEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const targetId = prop.options.targetDatabaseId ?? "";
	const target = store.relatedStore(targetId);
	// The target's rows arrive after it reports ready, so this picker follows that store directly.
	useStoreVersion(target);
	const selected = asArray(store.value(rowId, prop.id)).map(String);
	const [query, setQuery] = useState("");
	const rowInput = useOpenFocus<HTMLInputElement>();
	const statusProp = target.properties.find(
		(p) => p.type === "status" || p.type === "select",
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: rows arrive after the target store is ready
	const rows = useMemo(() => {
		const q = query.toLowerCase();
		return target.rowIds
			.map((id) => target.rows.get(id))
			.filter((r): r is NonNullable<typeof r> => Boolean(r))
			.filter((r) => r.title.toLowerCase().includes(q))
			.slice(0, 80);
	}, [target, query, target.getVersion()]);

	const toggle = (id: string) => {
		const next = selected.includes(id)
			? selected.filter((x) => x !== id)
			: [...selected, id];
		store.setRelation(rowId, prop, next);
	};

	const nav = useListNav(rows.length, (index) => {
		if (rows[index]) toggle(rows[index].id);
	});

	const addNew = () => {
		const id = target.createRow({ title: query.trim() });
		store.setRelation(rowId, prop, [...selected, id]);
		setQuery("");
	};

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			className="w-[338px] max-w-[calc(100vw-16px)] p-0"
		>
			<div className="flex items-center gap-2 px-3 pt-3">
				<span className="flex-1 truncate text-base font-semibold">
					Link to {target.page?.title || "database"}
				</span>
				<span className="text-sm text-pencil">{selected.length} linked</span>
			</div>
			<div className="p-2.5">
				<input
					ref={rowInput}
					aria-label="Find a row"
					className="h-8 w-full rounded-md border border-rule-strong bg-paper px-2 text-sm outline-none focus:border-link"
					placeholder="Find a row"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={nav.onKeyDown}
				/>
			</div>
			<div className="max-h-[260px] overflow-auto px-1.5">
				{rows.map((row, index) => {
					const checked = selected.includes(row.id);
					const status = statusProp
						? choiceById(statusProp, target.value(row.id, statusProp.id))
						: undefined;
					return (
						<button
							key={row.id}
							type="button"
							onClick={() => toggle(row.id)}
							onMouseEnter={() => nav.setActive(index)}
							className={`flex h-[38px] w-full items-center gap-2.5 rounded-md px-2 text-left ${checked ? "bg-link-soft" : nav.active === index ? "bg-wash" : ""}`}
						>
							<span
								className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${checked ? "border-link bg-accent text-white" : "border-rule-strong"}`}
							>
								{checked && <CheckIcon size={11} />}
							</span>
							<span
								className={`min-w-0 flex-1 truncate text-base ${checked ? "text-link" : "text-ink"}`}
							>
								{row.title || "Untitled"}
							</span>
							{status && <Chip color={status.color}>{status.name}</Chip>}
						</button>
					);
				})}
				{!rows.length &&
					(target.status === "loading" ? (
						<p className="flex items-center gap-2 px-2 py-2 text-sm text-pencil">
							<Spinner size={12} /> Loading rows
						</p>
					) : (
						<p className="px-2 py-2 text-sm text-pencil">
							{query.trim() ? "No rows match." : "No rows yet."}
						</p>
					))}
			</div>
			<div className="mt-1 flex items-center justify-between border-t border-rule px-3 py-2 text-sm">
				<button
					type="button"
					className="text-graphite hover:text-ink"
					onClick={addNew}
				>
					+ New row
					{query.trim() ? ` "${query.trim()}"` : ""}
				</button>
				<button
					type="button"
					className="font-medium text-ink"
					onClick={onClose}
				>
					Done
				</button>
			</div>
		</Popover>
	);
}

// Picks the editor for a type. Returns null for types edited inline or not at all.
export function CellPopoverEditor({
	store,
	rowId,
	prop,
	anchor,
	onClose,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	anchor: React.RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const shared = { store, rowId, prop, anchor, onClose };
	switch (prop.type) {
		case "select":
		case "status":
		case "multi_select":
			return <ChoiceEditor {...shared} />;
		case "person":
			return <PersonEditor {...shared} />;
		case "date":
			return <DateEditor {...shared} />;
		case "files":
			return <FilesEditor {...shared} />;
		case "relation":
			return <RelationEditor {...shared} />;
		default:
			return null;
	}
}
