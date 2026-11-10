// Relation, rollup, formula and AI column settings (boards 64, 65, 66).
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, SparkleFilled } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Dialog, Popover, Spinner, Switch } from "#/components/ui";
import { errorText } from "#/lib/errors";
import { FUNCTION_NAMES, type RefInfo, type Val } from "./formula";
import type { DatabaseStore } from "./store";
import { isComputedError } from "./store";
import type { Property, RollupFn, View } from "./types";
import { TYPE_LABELS } from "./types";
import { nextPropertyName, useMaybeStoreVersion } from "./ui";
import { formatFormulaResult } from "./values";

type Anchor = React.RefObject<HTMLElement | null>;

// ---------- Relation ----------

export function RelationDialog({
	store,
	name,
	replaces,
	onClose,
}: {
	store: DatabaseStore;
	view: View;
	name: string;
	replaces?: Property;
	onClose: () => void;
}) {
	const { pages } = useWorkspace();
	const targets = pages.filter((p) => p.kind === "database");
	const others = targets.filter((p) => p.id !== store.databaseId);
	const [targetId, setTargetId] = useState(
		others[0]?.id ?? targets[0]?.id ?? "",
	);
	const [propName, setPropName] = useState(name);
	const [twoWay, setTwoWay] = useState(true);
	const [reverseName, setReverseName] = useState(
		store.page?.title ? `Related to ${store.page.title}` : "Related",
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		if (!targetId) return;
		setBusy(true);
		setError(null);
		try {
			await store.createProperty({
				name: propName.trim() || "Related",
				type: "relation",
				options: { targetDatabaseId: targetId, side: "source" },
				reverseName:
					twoWay && targetId !== store.databaseId
						? reverseName.trim() || "Related"
						: undefined,
			});
			if (replaces) await store.deleteProperty(replaces.id);
			onClose();
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<Dialog
			open
			onClose={onClose}
			title={
				replaces ? `Turn ${replaces.name} into a relation` : "New relation"
			}
			width={420}
		>
			<div className="flex flex-col gap-3">
				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium">Column name</span>
					<input
						className="h-[34px] rounded-md border border-rule-strong bg-paper px-2.5 outline-none focus:border-link"
						value={propName}
						onChange={(e) => setPropName(e.target.value)}
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium">Connect to</span>
					<select
						className="h-[34px] rounded-md border border-rule-strong bg-paper px-2"
						value={targetId}
						onChange={(e) => setTargetId(e.target.value)}
					>
						{targets.map((p) => (
							<option key={p.id} value={p.id}>
								{p.title || "Untitled"}
							</option>
						))}
					</select>
				</label>
				{!others.length && (
					<p className="text-sm text-graphite">
						There are no other databases in this workspace yet, so this relation
						links rows in this one.
					</p>
				)}
				{targetId !== store.databaseId && (
					<div className="flex items-start gap-3">
						<div className="flex-1">
							<div className="text-sm font-medium">Show on the other side</div>
							<div className="text-sm text-pencil">
								Adds a column there that stays in sync with this one.
							</div>
						</div>
						<Switch checked={twoWay} onChange={setTwoWay} label="Two-way" />
					</div>
				)}
				{twoWay && targetId !== store.databaseId && (
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Its name on the other side</span>
						<input
							className="h-[34px] rounded-md border border-rule-strong bg-paper px-2.5 outline-none focus:border-link"
							value={reverseName}
							onChange={(e) => setReverseName(e.target.value)}
						/>
					</label>
				)}
				{error && <p className="text-xs text-coral">{error}</p>}
				<div className="flex justify-end gap-2 pt-1">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!targetId}
						loading={busy}
						onClick={save}
					>
						Add relation
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

// ---------- Rollup ----------

const ROLLUP_SHOW: { value: RollupFn; label: string }[] = [
	{ value: "count", label: "Count" },
	{ value: "open_of_total", label: "Open out of total" },
	{ value: "count_values", label: "Count filled" },
	{ value: "unique", label: "Count unique" },
	{ value: "sum", label: "Sum" },
	{ value: "average", label: "Average" },
	{ value: "median", label: "Median" },
	{ value: "min", label: "Smallest" },
	{ value: "max", label: "Largest" },
	{ value: "earliest", label: "Earliest date" },
	{ value: "latest", label: "Latest date" },
	{ value: "date_range", label: "Date range" },
	{ value: "percent_checked", label: "Percent checked" },
	{ value: "show_original", label: "Show the values" },
];

export function RollupPanel({
	anchor,
	store,
	prop,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	view: View;
	prop?: Property;
	onClose: () => void;
}) {
	const relations = store.properties.filter((p) => p.type === "relation");
	const [name, setName] = useState(
		prop?.name ?? nextPropertyName(store, "Rollup"),
	);
	const [relationId, setRelationId] = useState(
		prop?.options.relationId ?? relations[0]?.id ?? "",
	);
	const relation = store.propsById.get(relationId);
	const targetStore = relation?.options.targetDatabaseId
		? store.relatedStore(relation.options.targetDatabaseId)
		: null;
	useMaybeStoreVersion(targetStore);
	const targetProps = targetStore?.properties ?? [];
	const targetLoading =
		Boolean(targetStore) && targetStore?.status === "loading";
	const [targetId, setTargetId] = useState(
		prop?.options.targetPropertyId ?? "",
	);
	const [show, setShow] = useState<RollupFn>(prop?.options.show ?? "count");
	const target = targetProps.find((p) => p.id === targetId);
	const choices = target?.options.choices ?? [];
	const [openChoice, setOpenChoice] = useState(
		prop?.options.openChoiceId ?? choices[choices.length - 1]?.id ?? "",
	);
	const previewRow = store.rowIds[0];

	if (!relations.length) {
		return (
			<Popover
				anchor={anchor}
				open
				onClose={onClose}
				className="w-[300px] max-w-[calc(100vw-16px)] p-4 text-sm"
			>
				<p className="mb-2 font-medium">Add a relation first</p>
				<p className="text-graphite">
					A rollup shows values from rows connected by a Relation column.
				</p>
			</Popover>
		);
	}

	const options = {
		relationId,
		targetPropertyId: targetId,
		show,
		openChoiceId: openChoice,
	};
	const save = () => {
		if (prop) void store.updateProperty(prop.id, { name, options });
		else void store.createProperty({ name, type: "rollup", options });
		onClose();
	};

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			className="w-[362px] max-w-[calc(100vw-16px)]"
		>
			<div className="flex items-center border-b border-rule px-4 py-3">
				<span className="flex-1 text-base font-semibold">Rollup settings</span>
			</div>
			<div className="flex flex-col gap-3 p-4 text-sm">
				<Labelled label="Column name">
					<input
						aria-label="Column name"
						className="h-8 w-full rounded-md border border-rule-strong bg-paper px-2 outline-none focus:border-link"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</Labelled>
				<Labelled label="Connected to">
					<select
						aria-label="Connected to"
						className="h-8 w-full rounded-md border border-rule-strong bg-paper px-1.5"
						value={relationId}
						onChange={(e) => setRelationId(e.target.value)}
					>
						{relations.map((r) => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</select>
				</Labelled>
				<Labelled label="Column">
					<select
						aria-label="Column"
						className="h-8 w-full rounded-md border border-rule-strong bg-paper px-1.5"
						value={targetId}
						onChange={(e) => setTargetId(e.target.value)}
					>
						<option value="">
							{targetLoading ? "Loading columns" : "Pick a column"}
						</option>
						{targetProps.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</Labelled>
				<Labelled label="Show">
					<select
						aria-label="Show"
						className="h-8 w-full rounded-md border border-rule-strong bg-paper px-1.5"
						value={show}
						onChange={(e) => setShow(e.target.value as RollupFn)}
					>
						{ROLLUP_SHOW.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</select>
				</Labelled>
				{show === "open_of_total" && choices.length > 0 && (
					<Labelled label="Done means">
						<select
							aria-label="Done means"
							className="h-8 w-full rounded-md border border-rule-strong bg-paper px-1.5"
							value={openChoice}
							onChange={(e) => setOpenChoice(e.target.value)}
						>
							{choices.map((c) => (
								<option key={c.id} value={c.id}>
									{target?.name} is {c.name}
								</option>
							))}
						</select>
					</Labelled>
				)}
			</div>
			{previewRow && prop && (
				<div className="border-t border-rule bg-wash px-4 py-3 text-sm">
					<div className="text-graphite">
						{store.rows.get(previewRow)?.title || "First row"} shows
					</div>
					<div className="mt-0.5 font-serif text-lg font-medium">
						{String(store.value(previewRow, prop.id) ?? "Nothing yet")}
					</div>
				</div>
			)}
			<div className="flex justify-end border-t border-rule p-3">
				<Button
					variant="primary"
					disabled={!relationId || (!targetId && show !== "count")}
					onClick={save}
				>
					Save rollup
				</Button>
			</div>
		</Popover>
	);
}

function Labelled({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3">
			<span className="w-24 shrink-0 text-graphite">{label}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

// ---------- Formula ----------

function Highlighted({
	source,
	refs,
	errorRange,
}: {
	source: string;
	refs: RefInfo[];
	errorRange: { start: number; end: number } | null;
}) {
	const segments = useMemo(() => scanSegments(source, refs), [source, refs]);
	return (
		<>
			{segments.map((seg) => {
				const inError =
					errorRange &&
					seg.start < errorRange.end &&
					seg.end > errorRange.start;
				return (
					<span
						key={seg.start}
						className={`${seg.kind === "ref" ? "rounded-sm bg-link-soft text-link" : seg.kind === "str" ? "text-green" : ""} ${inError ? "rounded-sm bg-coral-soft text-coral" : ""}`}
					>
						{source.slice(seg.start, seg.end)}
					</span>
				);
			})}
			{"\n"}
		</>
	);
}

function isIdentChar(c: string) {
	return (
		(c >= "a" && c <= "z") ||
		(c >= "A" && c <= "Z") ||
		(c >= "0" && c <= "9") ||
		c === "_"
	);
}

function scanSegments(source: string, refs: RefInfo[]) {
	const names = new Map(refs.map((r) => [r.name.toLowerCase(), r.name]));
	const lengths = [...names.keys()].map((n) => n.length).sort((a, b) => b - a);
	const segs: { start: number; end: number; kind: string }[] = [];
	let i = 0;
	const push = (start: number, end: number, kind: string) => {
		if (end > start) segs.push({ start, end, kind });
	};
	while (i < source.length) {
		const c = source[i];
		if (c === '"' || c === "'") {
			const start = i++;
			while (i < source.length && source[i] !== c) i++;
			i = Math.min(i + 1, source.length);
			push(start, i, "str");
			continue;
		}
		let matched = false;
		const before = i > 0 ? source[i - 1] : " ";
		if (!isIdentChar(before)) {
			for (const len of lengths) {
				if (i + len > source.length) continue;
				const chunk = source.slice(i, i + len).toLowerCase();
				if (names.has(chunk)) {
					const after = source[i + len] ?? " ";
					if (isIdentChar(after)) continue;
					push(i, i + len, "ref");
					i += len;
					matched = true;
					break;
				}
			}
		}
		if (matched) continue;
		const start = i++;
		while (
			i < source.length &&
			source[i] !== '"' &&
			source[i] !== "'" &&
			!wordStartsColumn(source, i, lengths, names)
		)
			i++;
		push(start, i, "plain");
	}
	return segs;
}

function wordStartsColumn(
	source: string,
	i: number,
	lengths: number[],
	names: Map<string, string>,
) {
	const before = source[i - 1];
	if (before !== undefined && isIdentChar(before)) return false;
	for (const len of lengths) {
		if (i + len > source.length) continue;
		if (names.has(source.slice(i, i + len).toLowerCase())) return true;
	}
	return false;
}

export function FormulaDialog({
	store,
	prop,
	onClose,
}: {
	store: DatabaseStore;
	prop?: Property;
	onClose: () => void;
}) {
	const [name, setName] = useState(
		prop?.name ?? nextPropertyName(store, "Formula"),
	);
	const [expression, setExpression] = useState(
		prop ? store.formulaSource(prop) : "",
	);
	const [find, setFind] = useState("");
	const textarea = useRef<HTMLTextAreaElement>(null);
	const refs = store.formulaRefs(prop?.id);
	const lastGood = useRef<{ rowId: string; text: string }[]>([]);

	const check = store.checkFormula(expression, prop?.id ?? null);
	const error = !check.ok ? check.error : null;
	const previewRows = store.rowIds.slice(0, 4);

	let previews: { rowId: string; text: string }[] = [];
	if (check.ok) {
		previews = previewRows.map((rowId) => {
			const value = store.evalFormulaAst(rowId, check.ast);
			return {
				rowId,
				text: isComputedError(value)
					? value.error
					: formatFormulaResult(value as Val),
			};
		});
		lastGood.current = previews;
	} else {
		previews = lastGood.current;
	}

	const insertAtCursor = (text: string, cursorOffset = 0) => {
		const el = textarea.current;
		if (!el) {
			setExpression((v) => v + text);
			return;
		}
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const next = expression.slice(0, start) + text + expression.slice(end);
		setExpression(next);
		requestAnimationFrame(() => {
			el.focus();
			const at = start + text.length + cursorOffset;
			el.setSelectionRange(at, at);
		});
	};

	const useSuggestion = () => {
		if (!error?.suggestion) return;
		setExpression(
			expression.slice(0, error.start) +
				error.suggestion +
				expression.slice(error.end),
		);
	};

	const save = () => {
		if (error || !expression.trim()) return;
		const options = {
			...(prop?.options ?? {}),
			...store.formulaOptions(expression, prop?.id ?? null),
		};
		if (prop)
			void store.updateProperty(prop.id, { name, type: "formula", options });
		else void store.createProperty({ name, type: "formula", options });
		onClose();
	};

	const filter = (name: string) =>
		name.toLowerCase().includes(find.toLowerCase());

	return (
		<Dialog open onClose={onClose} title={`Formula: ${name}`} width={832}>
			<div className="flex min-h-[460px] gap-0">
				<div className="w-[240px] shrink-0 border-r border-rule pr-3">
					<div className="relative mb-2">
						<SearchIcon
							size={14}
							className="absolute top-2 left-2 text-pencil"
						/>
						<input
							aria-label="Find a column"
							placeholder="Find a column"
							className="h-[30px] w-full rounded-md border border-rule-strong bg-paper pr-2 pl-7 text-sm outline-none focus:border-link"
							value={find}
							onChange={(e) => setFind(e.target.value)}
						/>
					</div>
					<div className="max-h-[400px] overflow-auto">
						<div className="px-1 pt-1 pb-1 text-xs font-medium text-pencil">
							Columns
						</div>
						{refs
							.filter((r) => filter(r.name))
							.map((ref) => {
								const column = store.propsById.get(ref.id);
								return (
									<button
										key={ref.id}
										type="button"
										onClick={() => insertAtCursor(ref.name)}
										className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-link-soft"
									>
										<span className="min-w-0 flex-1 truncate">{ref.name}</span>
										<span className="text-xs text-pencil">
											{column ? TYPE_LABELS[column.type] : ""}
										</span>
									</button>
								);
							})}
						<div className="px-1 pt-3 pb-1 text-xs font-medium text-pencil">
							Functions
						</div>
						{FUNCTION_NAMES.filter(filter).map((fn) => (
							<button
								key={fn}
								type="button"
								onClick={() => insertAtCursor(`${fn}()`, -1)}
								className="flex h-7 w-full items-center rounded-md px-2 text-left font-mono text-[13px] hover:bg-wash-2"
							>
								{fn}
							</button>
						))}
					</div>
				</div>

				<div className="flex min-w-0 flex-1 flex-col pl-5">
					<label className="mb-2 flex items-center gap-2 text-sm">
						<span className="text-graphite">Column name</span>
						<input
							aria-label="Column name"
							className="h-[30px] flex-1 rounded-md border border-rule-strong bg-paper px-2 outline-none focus:border-link"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<div className="mb-1 text-sm text-graphite">Expression</div>
					<div className="relative rounded-lg border border-rule bg-wash font-mono text-[14px] leading-[24px]">
						<pre
							aria-hidden="true"
							className="pointer-events-none min-h-[120px] whitespace-pre-wrap break-words p-3"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							<Highlighted
								source={expression}
								refs={refs}
								errorRange={
									error ? { start: error.start, end: error.end } : null
								}
							/>
						</pre>
						<textarea
							ref={textarea}
							aria-label="Formula expression"
							spellCheck={false}
							placeholder='if(Status == "Shipped", "Done", "Open")'
							value={expression}
							onChange={(e) => setExpression(e.target.value)}
							className="absolute inset-0 h-full w-full resize-none bg-transparent p-3 text-transparent caret-ink outline-none placeholder:text-pencil"
							style={{ fontFamily: "var(--font-mono)" }}
						/>
					</div>

					{error ? (
						<div
							className="mt-3 flex items-center gap-3 rounded-lg bg-coral-soft px-3 py-2.5"
							role="alert"
						>
							<span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-coral text-xs font-bold text-paper">
								!
							</span>
							<div className="min-w-0 flex-1">
								<div className="text-base font-medium text-coral">
									{error.message}
								</div>
								<div className="text-sm text-graphite">
									Line {error.line}.
									{error.suggestion ? ` Did you mean ${error.suggestion}?` : ""}
								</div>
							</div>
							{error.suggestion && (
								<button
									type="button"
									onClick={useSuggestion}
									className="shrink-0 rounded-md border border-coral px-2.5 py-1 text-sm text-coral hover:bg-paper"
								>
									Use {error.suggestion}
								</button>
							)}
						</div>
					) : null}

					<div className="mt-4 flex items-center justify-between">
						<span className="text-sm text-graphite">
							Result on {previews.length}{" "}
							{previews.length === 1 ? "row" : "rows"}
						</span>
						{error && previews.length > 0 && (
							<span className="rounded-sm bg-amber-soft px-1.5 py-0.5 text-sm text-amber">
								Last result that worked
							</span>
						)}
					</div>
					<div className="mt-1 border-t border-rule">
						{previews.length === 0 && (
							<p className="py-3 text-sm text-pencil">
								Add a row to see a result.
							</p>
						)}
						{previews.map((p) => (
							<div
								key={p.rowId}
								className="flex h-[38px] items-center justify-between border-b border-rule text-base"
							>
								<span className="truncate font-medium">
									{store.rows.get(p.rowId)?.title || "Untitled"}
								</span>
								<span
									className="truncate pl-3 text-graphite"
									data-testid="formula-result"
								>
									{p.text}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="-mx-5 mt-4 flex items-center justify-between border-t border-rule px-5 pt-3">
				<span className="text-sm text-pencil">
					{error
						? "Fix the error to save."
						: !expression.trim()
							? "Write an expression to save."
							: ""}
				</span>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={Boolean(error) || !expression.trim()}
						onClick={save}
					>
						Save formula
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

// ---------- AI column ----------

export function AiColumnPanel({
	store,
	prop,
	onClose,
}: {
	store: DatabaseStore;
	view: View;
	prop?: Property;
	onClose: () => void;
}) {
	const candidates = store.properties.filter(
		(p) => p.type !== "ai" && p.id !== prop?.id,
	);
	const [name, setName] = useState(
		prop?.name ?? nextPropertyName(store, "AI summary"),
	);
	const [prompt, setPrompt] = useState(prop?.options.prompt ?? "");
	const [sources, setSources] = useState<string[]>(
		prop?.options.sources ??
			store.properties.filter((p) => p.type === "title").map((p) => p.id),
	);
	const [refill, setRefill] = useState(prop?.options.refill ?? true);
	const [preview, setPreview] = useState<{ rowId: string; text: string }[]>([]);
	const [previewing, setPreviewing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const draft = useRef<Property | null>(prop ?? null);
	const saved = useRef(false);
	const rowCount = store.rowIds.length;
	const rowsLabel = `${rowCount} ${rowCount === 1 ? "row" : "rows"}`;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	// A draft column that was only used for the preview goes away with the panel.
	useEffect(
		() => () => {
			if (!prop && draft.current && !saved.current)
				void store.deleteProperty(draft.current.id);
		},
		[prop, store],
	);

	const toggleSource = (id: string) =>
		setSources((list) =>
			list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
		);

	const ensureDraft = async () => {
		const options = { prompt, sources, refill };
		if (draft.current) {
			await store.updateProperty(draft.current.id, { name, options });
			return draft.current;
		}
		const created = await store.createProperty({ name, type: "ai", options });
		draft.current = created;
		return created;
	};

	const runPreview = async () => {
		if (!prompt.trim()) return;
		setPreviewing(true);
		setError(null);
		try {
			const column = await ensureDraft();
			const rowIds = store.rowIds.slice(0, 3);
			await store.fillAi(column, rowIds, { throwOnError: true });
			// Results land over Realtime just after the request returns, so give them a moment.
			for (let i = 0; i < 20; i++) {
				if (rowIds.every((rowId) => store.text(rowId, column.id))) break;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			setPreview(
				rowIds.map((rowId) => ({ rowId, text: store.text(rowId, column.id) })),
			);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setPreviewing(false);
		}
	};

	const save = async () => {
		setError(null);
		try {
			const column = await ensureDraft();
			saved.current = true;
			onClose();
			void store.fillAi(column, store.rowIds);
		} catch (err) {
			setError(errorText(err));
		}
	};

	if (!store.aiEnabled) {
		return (
			<Dialog open onClose={onClose} title="New AI column" width={420}>
				<p className="text-sm text-graphite">
					Add an AI key in Settings, then come back. AI columns use your own AI
					account, so nothing is billed by Livepage.
				</p>
				<div className="mt-4 flex justify-end">
					<Button variant="primary" onClick={onClose}>
						Close
					</Button>
				</div>
			</Dialog>
		);
	}

	return (
		<div
			role="dialog"
			aria-label={prop ? `Edit ${prop.name}` : "New AI column"}
			className="fixed top-0 right-0 z-50 flex h-dvh w-[480px] max-w-full flex-col border-l border-rule bg-paper shadow-pop"
		>
			<div className="flex items-center gap-2 border-b border-rule px-6 py-4">
				<span className="text-link">
					<SparkleFilled size={14} />
				</span>
				<h2 className="flex-1 font-serif text-[22px] leading-7 font-medium">
					{prop ? "Edit AI column" : "New AI column"}
				</h2>
				<button
					type="button"
					aria-label="Close"
					className="text-pencil hover:text-ink"
					onClick={onClose}
				>
					×
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-auto px-6 py-5">
				<div className="mb-1 block text-sm text-graphite">Column name</div>
				<input
					aria-label="Column name"
					className="mb-4 h-[34px] w-full rounded-md border border-rule-strong bg-paper px-2.5 text-base outline-none focus:border-link"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<div className="mb-1 block text-sm text-graphite">
					What should AI write?
				</div>
				<textarea
					aria-label="What should AI write?"
					rows={4}
					className="mb-4 w-full resize-none rounded-md border border-rule-strong bg-paper p-2.5 text-base outline-none focus:border-link"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
				/>
				<div className="mb-2 text-sm text-graphite">AI reads these columns</div>
				<div className="mb-5 flex flex-wrap gap-1.5">
					{[
						...candidates,
						{ id: "__body", name: "Page content" },
						{ id: "__comments", name: "Comments" },
					].map((c) => {
						const on = sources.includes(c.id);
						return (
							<button
								key={c.id}
								type="button"
								aria-pressed={on}
								onClick={() => toggleSource(c.id)}
								className={`h-[26px] rounded-sm px-2 text-sm ${on ? "bg-link-soft text-link" : "bg-wash-2 text-graphite"}`}
							>
								{on ? "✓ " : ""}
								{c.name}
							</button>
						);
					})}
				</div>
				<div className="mb-1 flex items-center justify-between text-sm">
					<span className="text-graphite">
						Preview on {Math.min(3, rowCount)} {rowCount === 1 ? "row" : "rows"}
					</span>
					<button
						type="button"
						disabled={previewing || !prompt.trim() || !rowCount}
						onClick={runPreview}
						className="text-link disabled:opacity-50"
					>
						{previewing ? (
							<Spinner size={12} />
						) : preview.length ? (
							"Try again"
						) : (
							"Preview"
						)}
					</button>
				</div>
				<div className="mb-5 border-t border-rule">
					{preview.map((p) => (
						<Fragment key={p.rowId}>
							<div className="flex gap-3 border-b border-rule py-2.5 text-base">
								<span className="w-28 shrink-0 truncate font-medium">
									{store.rows.get(p.rowId)?.title || "Untitled"}
								</span>
								<span className="min-w-0 flex-1 text-graphite">{p.text}</span>
							</div>
						</Fragment>
					))}
					{!preview.length && (
						<p className="py-2.5 text-sm text-pencil">
							{rowCount
								? "Run a preview to check the answers before you fill the column."
								: "Add a row to preview answers."}
						</p>
					)}
				</div>
				<div className="flex items-start gap-3">
					<div className="flex-1">
						<div className="text-base">Refill when a row changes</div>
						<div className="text-sm text-pencil">
							Rewrites the answer when the columns above change.
						</div>
					</div>
					<Switch
						checked={refill}
						onChange={setRefill}
						label="Refill when a row changes"
					/>
				</div>
				{error && <p className="mt-3 text-sm text-coral">{error}</p>}
			</div>
			<div className="flex items-start gap-2.5 bg-link-soft px-6 py-3.5">
				<span className="mt-[3px] shrink-0 text-link">
					<SparkleFilled size={14} />
				</span>
				<div className="text-sm">
					<div className="font-semibold">Uses your AI account</div>
					<div className="text-graphite">
						{rowCount
							? `Filling these ${rowsLabel} runs one request per row on your provider. Change this in AI settings.`
							: "Each row you add runs one request on your provider. Change this in AI settings."}
					</div>
				</div>
			</div>
			<div className="flex items-center justify-end gap-3 border-t border-rule px-6 py-3">
				<button
					type="button"
					className="text-sm text-graphite hover:text-ink"
					onClick={onClose}
				>
					Cancel
				</button>
				<Button
					variant="primary"
					disabled={!prompt.trim() || !name.trim()}
					onClick={save}
				>
					{prop
						? rowCount
							? `Save and fill ${rowsLabel}`
							: "Save"
						: rowCount
							? `Add column and fill ${rowsLabel}`
							: "Add column"}
				</Button>
			</div>
		</div>
	);
}
