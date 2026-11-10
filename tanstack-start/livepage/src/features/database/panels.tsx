// Toolbar panels: filter, sort and group, properties, and adding a view (boards 62, 63, 75).
import { useRef, useState } from "react";
import { CloseIcon } from "#/components/icons";
import { Button, Popover, Switch, usePhone } from "#/components/ui";
import { errorText } from "#/lib/errors";
import { boardGroupProp, groupableProps } from "./BoardView";
import { dateProps } from "./CalendarView";
import { AddPropertyMenu, PropertyMenu } from "./property-menu";
import type { DatabaseStore } from "./store";
import { columnsFor } from "./TableView";
import type {
	FilterGroup,
	FilterItem,
	Property,
	SortItem,
	View,
	ViewType,
} from "./types";
import { Chip } from "./ui";
import {
	choiceById,
	conditionsFor,
	EMPTY_GROUP,
	groupLabel,
	isGroup,
} from "./values";

type Anchor = React.RefObject<HTMLElement | null>;

const selectClass =
	"h-8 rounded-md border border-rule-strong bg-paper px-1.5 text-sm text-ink outline-none focus:border-link";

function SharedFooter({ store, view }: { store: DatabaseStore; view: View }) {
	const canSave = store.access.canEdit && store.hasOverlay(view);
	return (
		<div className="flex items-center justify-between border-t border-rule px-3 py-2.5 text-sm">
			<span className="text-pencil">
				{store.hasOverlay(view) ? "Only you see this" : ""}
			</span>
			<span className="flex items-center gap-3">
				{store.hasOverlay(view) && (
					<button
						type="button"
						className="text-pencil hover:text-ink"
						onClick={() => store.clearOverlay(view)}
					>
						Reset
					</button>
				)}
				{canSave && (
					<button
						type="button"
						className="font-medium text-link"
						onClick={() => void store.saveConfig(view)}
					>
						Save for everyone
					</button>
				)}
			</span>
		</div>
	);
}

// ---------- Filter ----------

function ConditionValue({
	store,
	prop,
	item,
	onChange,
}: {
	store: DatabaseStore;
	prop: Property;
	item: FilterItem;
	onChange: (value: unknown) => void;
}) {
	const def = conditionsFor(prop.type).find((c) => c.id === item.condition);
	if (def && !def.needsValue) return null;
	if (
		prop.type === "select" ||
		prop.type === "status" ||
		prop.type === "multi_select"
	) {
		return (
			<select
				aria-label="Filter value"
				className={`${selectClass} min-w-0 flex-1`}
				value={String(item.value ?? "")}
				onChange={(e) => onChange(e.target.value)}
			>
				<option value="">Choose</option>
				{(prop.options.choices ?? []).map((c) => (
					<option key={c.id} value={c.id}>
						{c.name}
					</option>
				))}
			</select>
		);
	}
	if (
		prop.type === "person" ||
		prop.type === "created_by" ||
		prop.type === "edited_by"
	) {
		return (
			<select
				aria-label="Filter value"
				className={`${selectClass} min-w-0 flex-1`}
				value={String(item.value ?? "")}
				onChange={(e) => onChange(e.target.value)}
			>
				<option value="">Choose</option>
				<option value="me">Me</option>
				{[...store.members.entries()].map(([id, name]) => (
					<option key={id} value={id}>
						{name}
					</option>
				))}
			</select>
		);
	}
	if (prop.type === "checkbox") {
		return (
			<select
				aria-label="Filter value"
				className={`${selectClass} min-w-0 flex-1`}
				value={item.value ? "true" : "false"}
				onChange={(e) => onChange(e.target.value === "true")}
			>
				<option value="true">Checked</option>
				<option value="false">Not checked</option>
			</select>
		);
	}
	if (
		prop.type === "date" ||
		prop.type === "created_time" ||
		prop.type === "edited_time"
	) {
		return (
			<input
				aria-label="Filter value"
				type="date"
				className={`${selectClass} min-w-0 flex-1`}
				value={String(item.value ?? "")}
				onChange={(e) => onChange(e.target.value)}
			/>
		);
	}
	if (prop.type === "relation") {
		const target = store.relatedStore(prop.options.targetDatabaseId ?? "");
		return (
			<select
				aria-label="Filter value"
				className={`${selectClass} min-w-0 flex-1`}
				value={String(item.value ?? "")}
				onChange={(e) => onChange(e.target.value)}
			>
				<option value="">Choose</option>
				{target.rowIds.slice(0, 300).map((id) => (
					<option key={id} value={id}>
						{target.rows.get(id)?.title || "Untitled"}
					</option>
				))}
			</select>
		);
	}
	return (
		<input
			aria-label="Filter value"
			className={`${selectClass} min-w-0 flex-1`}
			placeholder="Value"
			inputMode={prop.type === "number" ? "decimal" : undefined}
			value={String(item.value ?? "")}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

function FilterRows({
	store,
	group,
	onChange,
	depth,
}: {
	store: DatabaseStore;
	group: FilterGroup;
	onChange: (group: FilterGroup) => void;
	depth: number;
}) {
	const props = store.properties;
	const patchItem = (index: number, patch: Partial<FilterItem>) => {
		const items = [...group.items];
		items[index] = { ...(items[index] as FilterItem), ...patch };
		onChange({ ...group, items });
	};
	const remove = (index: number) => {
		onChange({ ...group, items: group.items.filter((_, i) => i !== index) });
	};
	const addFilter = () => {
		const prop = props[0];
		if (!prop) return;
		onChange({
			...group,
			items: [
				...group.items,
				{
					id: `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
					propertyId: prop.id,
					condition: conditionsFor(prop.type)[0].id,
					value: "",
				},
			],
		});
	};
	const toggleOp = () =>
		onChange({ ...group, op: group.op === "and" ? "or" : "and" });
	const label = (i: number) =>
		i === 0 ? "Where" : group.op === "and" ? "And" : "Or";

	return (
		<div className="flex flex-col gap-2">
			{group.items.map((item, index) => {
				const rowKey = isGroup(item) ? `g-${index}` : item.id;
				if (isGroup(item)) {
					return (
						<div key={rowKey} className="flex items-start gap-2">
							<span className="w-10 pt-1.5 text-sm text-graphite">
								{label(index)}
							</span>
							<div className="min-w-0 flex-1 rounded-lg border border-rule bg-wash p-2">
								<FilterRows
									store={store}
									group={item}
									depth={depth + 1}
									onChange={(next) => {
										const items = [...group.items];
										items[index] = next;
										onChange({ ...group, items });
									}}
								/>
								<button
									type="button"
									className="mt-1.5 text-xs text-pencil hover:text-ink"
									onClick={() => remove(index)}
								>
									Remove group
								</button>
							</div>
						</div>
					);
				}
				const prop = store.propsById.get(item.propertyId) ?? props[0];
				const conditions = prop ? conditionsFor(prop.type) : [];
				return (
					<div
						key={rowKey}
						className="flex items-center gap-2 max-md:flex-wrap"
						data-testid="filter-row"
					>
						{index === 0 ? (
							<span className="w-[52px] shrink-0 text-sm text-graphite">
								Where
							</span>
						) : (
							<select
								aria-label="And or Or"
								className={`${selectClass} w-[52px] shrink-0 px-0.5`}
								value={group.op}
								onChange={(e) => {
									if (e.target.value !== group.op) toggleOp();
								}}
							>
								<option value="and">And</option>
								<option value="or">Or</option>
							</select>
						)}
						<select
							aria-label="Filter column"
							className={`${selectClass} w-[130px] max-md:w-0 max-md:min-w-0 max-md:flex-1`}
							value={item.propertyId}
							onChange={(e) => {
								const next = store.propsById.get(e.target.value);
								patchItem(index, {
									propertyId: e.target.value,
									condition: next ? conditionsFor(next.type)[0].id : "is",
									value: "",
								});
							}}
						>
							{props.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
						<select
							aria-label="Filter condition"
							className={`${selectClass} w-[120px] max-md:w-0 max-md:min-w-0 max-md:flex-1`}
							value={item.condition}
							onChange={(e) => patchItem(index, { condition: e.target.value })}
						>
							{conditions.map((c) => (
								<option key={c.id} value={c.id}>
									{c.label}
								</option>
							))}
						</select>
						{prop && (
							<div className="flex min-w-0 flex-1 empty:hidden max-md:order-last max-md:basis-full">
								<ConditionValue
									store={store}
									prop={prop}
									item={item}
									onChange={(value) => patchItem(index, { value })}
								/>
							</div>
						)}
						<button
							type="button"
							aria-label="Remove filter"
							className="shrink-0 p-1 text-pencil hover:text-ink coarse:p-2.5"
							onClick={() => remove(index)}
						>
							<CloseIcon size={12} />
						</button>
					</div>
				);
			})}
			<div className="flex items-center gap-3 pt-0.5">
				<button
					type="button"
					className="text-sm text-graphite hover:text-ink coarse:py-2.5"
					onClick={addFilter}
				>
					+ Add filter
				</button>
				{depth === 0 && (
					<button
						type="button"
						className="text-sm text-pencil hover:text-ink coarse:py-2.5"
						onClick={() =>
							onChange({
								...group,
								items: [...group.items, { op: "or", items: [] }],
							})
						}
					>
						+ Add a group
					</button>
				)}
			</div>
		</div>
	);
}

export function FilterPanel({
	anchor,
	store,
	view,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	view: View;
	onClose: () => void;
}) {
	const config = store.configFor(view);
	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			align="end"
			className="w-[520px] max-w-[calc(100vw-16px)]"
		>
			<div className="px-3 pt-3 pb-2.5">
				<div className="mb-2 text-base font-semibold">Filter {view.name}</div>
				<FilterRows
					store={store}
					group={config.filter}
					depth={0}
					onChange={(filter) => store.updateConfig(view, { filter })}
				/>
			</div>
			<SharedFooter store={store} view={view} />
		</Popover>
	);
}

// ---------- Sort and group ----------

export function SortGroupPanel({
	anchor,
	store,
	view,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	view: View;
	onClose: () => void;
}) {
	const config = store.configFor(view);
	const sorts = config.sorts;
	const props = store.properties.filter((p) => p.type !== "files");
	// A board is always grouped, by its first Status column when nothing was picked.
	const groupProp =
		view.type === "board"
			? boardGroupProp(store, view)
			: config.groupBy
				? store.propsById.get(config.groupBy)
				: null;
	const [dragKey, setDragKey] = useState<string | null>(null);

	const setSorts = (next: SortItem[]) =>
		store.updateConfig(view, { sorts: next });

	const groupKeys = groupProp
		? orderedGroupKeys(store, groupProp, config.groupOrder)
		: [];

	const reorderGroup = (over: string) => {
		if (!dragKey || dragKey === over) return;
		const keys = [...groupKeys];
		const from = keys.indexOf(dragKey);
		keys.splice(from, 1);
		keys.splice(keys.indexOf(over), 0, dragKey);
		store.updateConfig(view, { groupOrder: keys });
		setDragKey(null);
	};

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			align="end"
			className="w-[380px] max-w-[calc(100vw-16px)]"
		>
			<div className="p-4 pb-3">
				<div className="mb-2 text-base font-semibold">Sort</div>
				<div className="flex flex-col gap-2">
					{sorts.map((sort, i) => (
						<div
							key={sort.propertyId}
							className="flex items-center gap-2"
							data-testid="sort-row"
						>
							<select
								aria-label="Sort column"
								className={`${selectClass} min-w-0 flex-1`}
								value={sort.propertyId}
								onChange={(e) => {
									const next = [...sorts];
									next[i] = { ...sort, propertyId: e.target.value };
									setSorts(next);
								}}
							>
								{props.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
							<select
								aria-label="Sort direction"
								className={`${selectClass} w-[130px]`}
								value={sort.direction}
								onChange={(e) => {
									const next = [...sorts];
									next[i] = {
										...sort,
										direction: e.target.value as SortItem["direction"],
									};
									setSorts(next);
								}}
							>
								<option value="asc">Ascending</option>
								<option value="desc">Descending</option>
							</select>
							<button
								type="button"
								aria-label="Remove sort"
								className="p-1 text-pencil hover:text-ink coarse:p-2.5"
								onClick={() => setSorts(sorts.filter((_, x) => x !== i))}
							>
								<CloseIcon size={12} />
							</button>
						</div>
					))}
					{props.some((p) => !sorts.some((s) => s.propertyId === p.id)) && (
						<button
							type="button"
							className="self-start text-sm text-graphite hover:text-ink"
							onClick={() => {
								const used = new Set(sorts.map((s) => s.propertyId));
								const next = props.find((p) => !used.has(p.id));
								if (next)
									setSorts([
										...sorts,
										{ propertyId: next.id, direction: "asc" },
									]);
							}}
						>
							+ Add a sort
						</button>
					)}
				</div>
			</div>
			<div className="border-t border-rule p-4">
				<div className="mb-2 text-base font-semibold">Group</div>
				<label className="flex items-center gap-2 text-sm">
					<span className="w-16 text-graphite">Group by</span>
					<select
						aria-label="Group by"
						className={`${selectClass} min-w-0 flex-1`}
						value={groupProp?.id ?? ""}
						onChange={(e) =>
							store.updateConfig(view, {
								groupBy: e.target.value || null,
								groupOrder: [],
							})
						}
					>
						{view.type !== "board" && <option value="">No grouping</option>}
						{[
							...groupableProps(store),
							...store.properties.filter(
								(p) => p.type === "date" || p.type === "text",
							),
						]
							.filter((p, i, list) => list.indexOf(p) === i)
							.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
					</select>
				</label>
				{groupProp && (
					<>
						<div className="mt-3 flex flex-col gap-1">
							{groupKeys.map((key) => {
								const choice = choiceById(groupProp, key);
								return (
									// biome-ignore lint/a11y/noStaticElementInteractions: drag handle for reordering groups
									<div
										key={key}
										className={`flex h-7 items-center gap-2 ${dragKey === key ? "opacity-40" : ""}`}
										draggable
										onDragStart={() => setDragKey(key)}
										onDragOver={(e) => e.preventDefault()}
										onDrop={() => reorderGroup(key)}
										onDragEnd={() => setDragKey(null)}
									>
										<span
											className="cursor-grab text-pencil coarse:hidden"
											aria-hidden="true"
										>
											⠿
										</span>
										{choice ? (
											<Chip color={choice.color}>{choice.name}</Chip>
										) : (
											<span className="text-sm">
												{groupLabel(groupProp, key, store.names)}
											</span>
										)}
										{key === EMPTY_GROUP && (
											<button
												type="button"
												className="ml-auto text-sm text-link coarse:py-2.5 coarse:pl-3"
												onClick={() =>
													store.updateConfig(view, {
														showEmptyGroup: !config.showEmptyGroup,
													})
												}
											>
												{config.showEmptyGroup
													? "Show only with rows"
													: "Always show"}
											</button>
										)}
									</div>
								);
							})}
						</div>
						<div className="mt-3 flex items-center justify-between text-sm">
							<span>Hide empty groups</span>
							<Switch
								checked={config.hideEmptyGroups}
								onChange={(v) =>
									store.updateConfig(view, { hideEmptyGroups: v })
								}
								label="Hide empty groups"
							/>
						</div>
					</>
				)}
			</div>
			<SharedFooter store={store} view={view} />
		</Popover>
	);
}

function orderedGroupKeys(
	store: DatabaseStore,
	prop: Property,
	order: string[],
) {
	const choices = (prop.options.choices ?? []).map((c) => c.id);
	const keys = prop.type === "checkbox" ? ["true", "false"] : [...choices];
	keys.unshift(EMPTY_GROUP);
	const index = (key: string) => {
		const at = order.indexOf(key);
		return at < 0 ? order.length + keys.indexOf(key) : at;
	};
	void store;
	return keys.sort((a, b) => index(a) - index(b));
}

// ---------- Properties ----------

export function PropertiesPanel({
	anchor,
	store,
	view,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	view: View;
	onClose: () => void;
}) {
	const config = store.configFor(view);
	const shown = columnsFor(store, config);
	const hidden = store.properties.filter((p) => config.hidden.includes(p.id));
	const [drag, setDrag] = useState<string | null>(null);
	const addRef = useRef<HTMLButtonElement>(null);
	const [adding, setAdding] = useState(false);
	const phone = usePhone();
	const [editing, setEditing] = useState<string | null>(null);

	const reorder = (over: string) => {
		if (!drag || drag === over) return;
		const order = shown.map((p) => p.id);
		order.splice(order.indexOf(drag), 1);
		order.splice(order.indexOf(over), 0, drag);
		store.updateConfig(view, { order });
		setDrag(null);
	};

	// A phone has no column headers to tap, so a column's menu opens from its row here.
	const editingProp = editing ? store.propsById.get(editing) : undefined;
	if (editingProp)
		return (
			<PropertyMenu
				anchor={anchor}
				store={store}
				view={view}
				prop={editingProp}
				canEdit={store.access.canEdit}
				onClose={() => setEditing(null)}
			/>
		);

	const columnName = (prop: Property, indent = "") =>
		phone ? (
			<button
				type="button"
				aria-label={`Edit ${prop.name}`}
				className={`flex h-11 min-w-0 flex-1 items-center gap-1 text-left ${indent}`}
				onClick={() => setEditing(prop.id)}
			>
				<span className="truncate">{prop.name}</span>
				<span className="text-pencil" aria-hidden="true">
					›
				</span>
			</button>
		) : (
			<span className={`min-w-0 flex-1 truncate ${indent}`}>{prop.name}</span>
		);

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			align="end"
			className="w-[300px] max-w-[calc(100vw-16px)]"
		>
			<div className="max-h-[420px] overflow-auto p-1.5">
				{phone && (
					<p className="px-2 pt-1 pb-1 text-sm text-graphite">
						Tap a column to rename, change or delete it.
					</p>
				)}
				<div className="px-2 pt-1 pb-1 text-xs font-medium text-pencil">
					Shown
				</div>
				{shown.map((prop) => (
					// biome-ignore lint/a11y/noStaticElementInteractions: drag handle for column order
					<div
						key={prop.id}
						className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-wash-2 coarse:h-11"
						draggable={prop.type !== "title"}
						onDragStart={() => setDrag(prop.id)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={() => reorder(prop.id)}
						data-testid="property-row"
					>
						<span className="text-pencil coarse:hidden" aria-hidden="true">
							{prop.type === "title" ? "" : "⠿"}
						</span>
						{columnName(prop)}
						{prop.type !== "title" && (
							<button
								type="button"
								aria-label={`Hide ${prop.name}`}
								className="text-pencil hover:text-ink coarse:py-2.5 coarse:pl-3"
								onClick={() =>
									store.updateConfig(view, {
										hidden: [...config.hidden, prop.id],
									})
								}
							>
								Hide
							</button>
						)}
					</div>
				))}
				{hidden.length > 0 && (
					<div className="px-2 pt-2 pb-1 text-xs font-medium text-pencil">
						Hidden
					</div>
				)}
				{hidden.map((prop) => (
					<div
						key={prop.id}
						className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-graphite hover:bg-wash-2 coarse:h-11"
					>
						{columnName(prop, "pl-5 coarse:pl-0")}
						<button
							type="button"
							aria-label={`Show ${prop.name}`}
							className="text-link coarse:py-2.5 coarse:pl-3"
							onClick={() =>
								store.updateConfig(view, {
									hidden: config.hidden.filter((id) => id !== prop.id),
								})
							}
						>
							Show
						</button>
					</div>
				))}
			</div>
			{store.access.canEdit && (
				<div className="border-t border-rule p-1.5">
					<button
						ref={addRef}
						type="button"
						onClick={() => setAdding(true)}
						className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-graphite hover:bg-wash-2 hover:text-ink"
					>
						+ New column
					</button>
					{adding && (
						<AddPropertyMenu
							anchor={addRef}
							store={store}
							view={view}
							onClose={() => setAdding(false)}
						/>
					)}
				</div>
			)}
			<SharedFooter store={store} view={view} />
		</Popover>
	);
}

// ---------- Add a view ----------

const VIEW_TYPES: {
	type: ViewType;
	label: string;
	hint: string;
	about: string;
}[] = [
	{
		type: "table",
		label: "Table",
		hint: "Rows and columns",
		about: "Every row and column, with calculations, sorting and grouping.",
	},
	{
		type: "board",
		label: "Board",
		hint: "Cards in columns by status",
		about: "Move work between columns by dragging a card.",
	},
	{
		type: "calendar",
		label: "Calendar",
		hint: "Rows on a month",
		about: "Rows appear on their date. Drag one to change it.",
	},
	{
		type: "timeline",
		label: "Timeline",
		hint: "Bars across the year",
		about: "Work as bars you can drag and stretch across the year.",
	},
	{
		type: "gallery",
		label: "Gallery",
		hint: "Cards with a cover",
		about: "Each row becomes a card. Good for designs, photos and people.",
	},
];

export function AddViewPanel({
	anchor,
	store,
	onAdded,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	onAdded: (view: View) => void;
	onClose: () => void;
}) {
	const [selected, setSelected] = useState<ViewType>("table");
	const [cover, setCover] = useState<"first-image" | "page-cover" | "none">(
		"first-image",
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const info = VIEW_TYPES.find((v) => v.type === selected) ?? VIEW_TYPES[0];
	const needsDate =
		(selected === "calendar" || selected === "timeline") &&
		!dateProps(store).length;

	const uniqueName = () => {
		const names = new Set(store.views.map((v) => v.name.toLowerCase()));
		if (!names.has(info.label.toLowerCase())) return info.label;
		for (let i = 2; ; i++) {
			const candidate = `${info.label} ${i}`;
			if (!names.has(candidate.toLowerCase())) return candidate;
		}
	};

	const add = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const config = selected === "gallery" ? { cover } : {};
			const view = await store.createView({
				name: uniqueName(),
				type: selected,
				config,
			});
			setBusy(false);
			onAdded(view);
			onClose();
		} catch (err) {
			setBusy(false);
			setError(errorText(err));
		}
	};

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			className="flex w-[558px] max-w-[calc(100vw-16px)]"
		>
			<div
				className="w-[248px] shrink-0 border-r border-rule p-2 max-sm:w-[150px]"
				role="menu"
			>
				<div className="px-2 pt-1 pb-1.5 text-sm text-graphite">Add a view</div>
				{VIEW_TYPES.map((v) => (
					<button
						key={v.type}
						type="button"
						role="menuitem"
						onClick={() => setSelected(v.type)}
						className={`mb-0.5 flex w-full flex-col rounded-md px-2.5 py-1.5 text-left ${selected === v.type ? "bg-link-soft" : "hover:bg-wash-2"}`}
					>
						<span
							className={`text-base font-medium ${selected === v.type ? "text-link" : "text-ink"}`}
						>
							{v.label}
						</span>
						<span
							className={`text-sm ${selected === v.type ? "text-link" : "text-pencil"}`}
						>
							{v.hint}
						</span>
					</button>
				))}
			</div>
			<div className="flex min-w-0 flex-1 flex-col p-3">
				<ViewPreview type={selected} />
				<div className="mt-3 text-base font-medium">{info.label}</div>
				<p className="text-sm text-graphite">{info.about}</p>
				{needsDate && (
					<p className="mt-1.5 text-sm text-graphite">
						This view needs a Date column. You can add one from the view.
					</p>
				)}
				{selected === "gallery" && (
					<label className="mt-3 flex items-center justify-between gap-3 text-sm">
						<span className="text-graphite">Card cover</span>
						<select
							aria-label="Card cover"
							className={selectClass}
							value={cover}
							onChange={(e) => setCover(e.target.value as typeof cover)}
						>
							<option value="first-image">First image in the row</option>
							<option value="page-cover">Page cover</option>
							<option value="none">No cover</option>
						</select>
					</label>
				)}
				<div className="flex-1" />
				{error && <p className="mt-2 text-sm text-coral">{error}</p>}
				<div className="mt-3 flex justify-end">
					<Button variant="primary" loading={busy} onClick={add}>
						Add {info.label} view
					</Button>
				</div>
			</div>
		</Popover>
	);
}

const SKELETON_KEYS = Array.from({ length: 21 }, (_, i) => `box-${i}`);

function ViewPreview({ type }: { type: ViewType }) {
	const box = "rounded-[3px] bg-wash-2";
	return (
		<div className="flex h-[136px] items-center justify-center overflow-hidden rounded-lg bg-wash p-3">
			{type === "table" && (
				<div className="flex w-full flex-col gap-1.5">
					{[0, 1, 2, 3, 4].map((i) => (
						<div key={i} className="flex gap-1.5">
							<div className={`h-3 flex-[2] ${box}`} />
							<div className={`h-3 flex-1 ${box}`} />
							<div className={`h-3 flex-1 ${box}`} />
						</div>
					))}
				</div>
			)}
			{type === "board" && (
				<div className="flex w-full gap-2">
					{[3, 2, 1].map((n) => (
						<div key={n} className="flex flex-1 flex-col gap-1.5">
							{SKELETON_KEYS.slice(0, n).map((key) => (
								<div key={key} className={`h-7 ${box}`} />
							))}
						</div>
					))}
				</div>
			)}
			{type === "calendar" && (
				<div className="grid w-full grid-cols-7 gap-1">
					{SKELETON_KEYS.slice(0, 21).map((key) => (
						<div key={key} className={`h-7 ${box}`} />
					))}
				</div>
			)}
			{type === "timeline" && (
				<div className="flex w-full flex-col gap-2">
					{[
						["5%", "45%"],
						["20%", "60%"],
						["50%", "40%"],
						["10%", "30%"],
					].map(([left, width]) => (
						<div key={left} className="relative h-3">
							<div
								className={`absolute inset-y-0 ${box}`}
								style={{ left, width }}
							/>
						</div>
					))}
				</div>
			)}
			{type === "gallery" && (
				<div className="grid w-full grid-cols-3 gap-2">
					{SKELETON_KEYS.slice(0, 6).map((key) => (
						<div key={key} className={`h-[52px] ${box}`} />
					))}
				</div>
			)}
		</div>
	);
}
