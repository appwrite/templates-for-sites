// The column header menu and the "add a column" menu.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "#/components/icons";
import { Button, Dialog, Popover } from "#/components/ui";
import {
	AiColumnPanel,
	FormulaDialog,
	RelationDialog,
	RollupPanel,
} from "./config-panels";
import type { DatabaseStore } from "./store";
import { columnsFor } from "./TableView";
import type {
	Choice,
	NumberFormat,
	Property,
	PropertyType,
	View,
} from "./types";
import { CHIP_CLASSES, COLOR_CYCLE, DEFAULT_STATUS_CHOICES } from "./types";
import { NEW_PROPERTY_NAMES, nextPropertyName } from "./ui";
import { isEmptyValue } from "./values";

type Anchor = React.RefObject<HTMLElement | null>;

// The type list, in the order and groups of board 75.
const TYPE_GROUPS: {
	label: string;
	items: { type: PropertyType; label: string }[];
}[] = [
	{
		label: "Property type",
		items: [
			{ type: "text", label: "Text" },
			{ type: "number", label: "Number" },
			{ type: "status", label: "Status" },
			{ type: "select", label: "Select" },
			{ type: "multi_select", label: "Multi-select" },
			{ type: "date", label: "Date" },
			{ type: "person", label: "Person" },
			{ type: "files", label: "Files" },
			{ type: "checkbox", label: "Checkbox" },
			{ type: "url", label: "URL" },
			{ type: "email", label: "Email" },
			{ type: "phone", label: "Phone" },
		],
	},
	{
		label: "Connected",
		items: [
			{ type: "relation", label: "Relation" },
			{ type: "rollup", label: "Rollup" },
			{ type: "formula", label: "Formula" },
		],
	},
	{
		label: "Automatic",
		items: [
			{ type: "created_time", label: "Created time" },
			{ type: "created_by", label: "Created by" },
			{ type: "edited_time", label: "Last edited time" },
			{ type: "edited_by", label: "Last edited by" },
		],
	},
	{ label: "AI", items: [{ type: "ai", label: "Summary, category, extract" }] },
];

function TypeList({
	current,
	onPick,
	label,
}: {
	current?: PropertyType;
	onPick: (type: PropertyType) => void;
	label?: string;
}) {
	const groups = current
		? TYPE_GROUPS
		: [TYPE_GROUPS[0], TYPE_GROUPS[1], TYPE_GROUPS[2], TYPE_GROUPS[3]];
	return (
		<div className="p-1.5" role="menu" aria-label={label ?? "Property type"}>
			{groups.map((group) => (
				<div key={group.label}>
					<div className="px-2 pt-1 pb-1 text-xs font-medium text-pencil">
						{group.label}
					</div>
					{group.items.map((item) => (
						<button
							key={item.type}
							type="button"
							role="menuitem"
							onClick={() => onPick(item.type)}
							className={`flex h-[30px] w-full items-center rounded-md px-2 text-left text-base coarse:h-11 ${item.type === "ai" ? "text-link" : ""} ${current === item.type ? "bg-link-soft font-medium text-link" : "text-ink hover:bg-wash-2"}`}
						>
							{item.label}
						</button>
					))}
				</div>
			))}
		</div>
	);
}

function defaultOptions(type: PropertyType): Property["options"] {
	if (type === "status") return { choices: DEFAULT_STATUS_CHOICES };
	if (type === "select" || type === "multi_select") return { choices: [] };
	if (type === "number") return { format: "number" };
	return {};
}

function MenuRow({
	onClick,
	children,
	danger,
	label,
	disabled,
}: {
	onClick: () => void;
	children: ReactNode;
	danger?: boolean;
	label?: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-wash-2 coarse:h-11 disabled:opacity-40 disabled:hover:bg-transparent coarse:h-11 coarse:text-[15px] ${danger ? "text-coral" : "text-ink"}`}
		>
			{children}
		</button>
	);
}

const NUMBER_FORMATS: { value: NumberFormat; label: string }[] = [
	{ value: "number", label: "Number" },
	{ value: "comma", label: "Number with commas" },
	{ value: "percent", label: "Percent" },
	{ value: "dollar", label: "Dollar" },
	{ value: "euro", label: "Euro" },
	{ value: "pound", label: "Pound" },
	{ value: "rupee", label: "Rupee" },
];

function ChoicesEditor({
	store,
	prop,
}: {
	store: DatabaseStore;
	prop: Property;
}) {
	const choices = prop.options.choices ?? [];
	const save = (next: Choice[]) => {
		void store.updateProperty(prop.id, {
			options: { ...prop.options, choices: next },
		});
	};
	return (
		<div className="border-t border-rule px-2 py-1.5">
			<div className="px-1 pb-1 text-xs font-medium text-pencil">Options</div>
			{choices.map((choice, i) => (
				<div
					key={choice.id}
					className="flex h-8 items-center gap-1.5 coarse:h-11"
				>
					<button
						type="button"
						aria-label={`Change color of ${choice.name}`}
						className={`relative h-5 w-5 shrink-0 rounded-sm coarse:before:absolute coarse:before:-inset-2.5 ${CHIP_CLASSES[choice.color]}`}
						onClick={() => {
							const next = [...choices];
							next[i] = {
								...choice,
								color:
									COLOR_CYCLE[
										(COLOR_CYCLE.indexOf(choice.color) + 1) % COLOR_CYCLE.length
									],
							};
							save(next);
						}}
					/>
					<input
						aria-label="Option name"
						className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none focus:bg-wash coarse:h-10"
						defaultValue={choice.name}
						onBlur={(e) => {
							if (e.target.value !== choice.name) {
								const next = [...choices];
								next[i] = { ...choice, name: e.target.value };
								save(next);
							}
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") (e.target as HTMLInputElement).blur();
						}}
					/>
					<button
						type="button"
						aria-label={`Delete ${choice.name}`}
						className="text-pencil hover:text-coral coarse:p-2.5"
						onClick={() => save(choices.filter((_, x) => x !== i))}
					>
						<TrashIcon size={13} />
					</button>
				</div>
			))}
			<button
				type="button"
				className="mt-0.5 flex h-7 items-center gap-1 px-1 text-sm text-pencil hover:text-ink coarse:h-10"
				onClick={() =>
					save([
						...choices,
						{
							id: `opt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
							name: `Option ${choices.length + 1}`,
							color: COLOR_CYCLE[choices.length % COLOR_CYCLE.length],
						},
					])
				}
			>
				<PlusIcon size={12} /> Add an option
			</button>
		</div>
	);
}

// Header menu for one column.
export function PropertyMenu({
	anchor,
	store,
	view,
	prop,
	canEdit,
	onClose,
}: {
	anchor: Anchor;
	store: DatabaseStore;
	view: View;
	prop: Property;
	canEdit: boolean;
	onClose: () => void;
}) {
	const [name, setName] = useState(prop.name);
	const [mode, setMode] = useState<"root" | "type">("root");
	const [dialog, setDialog] = useState<null | PropertyType>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const config = store.configFor(view);
	const movable = columnsFor(store, config)
		.filter((p) => p.type !== "title")
		.map((p) => p.id);
	const columnIndex = movable.indexOf(prop.id);
	const moveColumn = (direction: -1 | 1) => {
		const order = [...movable];
		const from = order.indexOf(prop.id);
		const to = from + direction;
		if (from < 0 || to < 0 || to >= order.length) return;
		order.splice(from, 1);
		order.splice(to, 0, prop.id);
		store.updateConfig(view, { order });
		onClose();
	};

	const commitName = () => {
		const trimmed = name.trim();
		if (trimmed && trimmed !== prop.name) {
			void store.updateProperty(prop.id, { name: trimmed });
		}
	};

	// Closing the menu saves the name, so the latest closure has to run on unmount.
	const commitLatest = useRef(commitName);
	commitLatest.current = commitName;
	useEffect(() => () => commitLatest.current(), []);

	const changeType = (type: PropertyType) => {
		if (type === prop.type) return setMode("root");
		if (
			type === "relation" ||
			type === "rollup" ||
			type === "formula" ||
			type === "ai"
		) {
			setDialog(type);
			return;
		}
		void store.convertProperty(prop, type, defaultOptions(type));
		onClose();
	};

	if (dialog === "formula")
		return <FormulaDialog store={store} prop={prop} onClose={onClose} />;
	if (dialog === "relation")
		return (
			<RelationDialog
				store={store}
				view={view}
				name={prop.name}
				replaces={prop}
				onClose={onClose}
			/>
		);
	if (dialog === "rollup")
		return (
			<RollupPanel
				anchor={anchor}
				store={store}
				view={view}
				prop={prop}
				onClose={onClose}
			/>
		);
	if (dialog === "ai")
		return (
			<AiColumnPanel store={store} view={view} prop={prop} onClose={onClose} />
		);
	if (confirmDelete)
		return (
			<Dialog open onClose={onClose} title={`Delete ${prop.name}?`} width={400}>
				<p className="text-sm text-graphite">
					The column and every value in it go away, in every view. This can't be
					undone.
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							void store.deleteProperty(prop.id);
							onClose();
						}}
					>
						Delete column
					</Button>
				</div>
			</Dialog>
		);

	const editable = canEdit && prop.type !== "title";
	const choiceBased =
		prop.type === "select" ||
		prop.type === "status" ||
		prop.type === "multi_select";

	return (
		<Popover anchor={anchor} open onClose={onClose} className="w-[280px]">
			{mode === "type" ? (
				<TypeList current={prop.type} onPick={changeType} />
			) : (
				<div className="p-1.5">
					<input
						aria-label="Column name"
						readOnly={!canEdit}
						className="mb-1.5 h-8 w-full rounded-md border border-rule-strong bg-paper px-2 text-sm coarse:h-10 text-ink outline-none focus:border-link"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onBlur={commitName}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								commitName();
								onClose();
							}
						}}
					/>
					{editable && (
						<MenuRow onClick={() => setMode("type")}>
							<span className="flex-1">Type</span>
							<span className="text-pencil">{typeName(prop.type)} ›</span>
						</MenuRow>
					)}
					{prop.type === "number" && canEdit && (
						<label className="flex h-8 items-center gap-2 px-2 text-sm">
							<span className="flex-1">Format</span>
							<select
								className="h-7 rounded-sm border border-rule bg-paper text-sm"
								value={prop.options.format ?? "number"}
								onChange={(e) =>
									void store.updateProperty(prop.id, {
										options: {
											...prop.options,
											format: e.target.value as NumberFormat,
										},
									})
								}
							>
								{NUMBER_FORMATS.map((f) => (
									<option key={f.value} value={f.value}>
										{f.label}
									</option>
								))}
							</select>
						</label>
					)}
					{prop.type === "formula" && canEdit && (
						<MenuRow onClick={() => setDialog("formula")}>Edit formula</MenuRow>
					)}
					{prop.type === "rollup" && canEdit && (
						<MenuRow onClick={() => setDialog("rollup")}>Edit rollup</MenuRow>
					)}
					{prop.type === "ai" && canEdit && (
						<>
							<MenuRow onClick={() => setDialog("ai")}>Edit AI column</MenuRow>
							{store.aiEnabled && (
								<>
									<MenuRow
										onClick={() => {
											void store.fillAi(
												prop,
												store.rowIds.filter((id) =>
													isEmptyValue(store.value(id, prop.id)),
												),
											);
											onClose();
										}}
									>
										Fill empty cells
									</MenuRow>
									<MenuRow
										onClick={() => {
											void store.fillAi(prop, store.rowIds);
											onClose();
										}}
									>
										Fill all {store.rowIds.length}{" "}
										{store.rowIds.length === 1 ? "row" : "rows"} again
									</MenuRow>
								</>
							)}
						</>
					)}
					<hr className="my-1 h-px border-0 bg-rule" />
					<MenuRow
						onClick={() => {
							store.updateConfig(view, {
								sorts: [
									...config.sorts.filter((s) => s.propertyId !== prop.id),
									{ propertyId: prop.id, direction: "asc" },
								],
							});
							onClose();
						}}
					>
						Sort ascending
					</MenuRow>
					<MenuRow
						onClick={() => {
							store.updateConfig(view, {
								sorts: [
									...config.sorts.filter((s) => s.propertyId !== prop.id),
									{ propertyId: prop.id, direction: "desc" },
								],
							});
							onClose();
						}}
					>
						Sort descending
					</MenuRow>
					{prop.type !== "title" && (
						<>
							<MenuRow
								disabled={columnIndex <= 0}
								onClick={() => moveColumn(-1)}
							>
								Move left
							</MenuRow>
							<MenuRow
								disabled={columnIndex >= movable.length - 1}
								onClick={() => moveColumn(1)}
							>
								Move right
							</MenuRow>
							<MenuRow
								onClick={() => {
									store.updateConfig(view, {
										hidden: [...config.hidden, prop.id],
									});
									onClose();
								}}
							>
								Hide column
							</MenuRow>
						</>
					)}
					{editable && (
						<>
							<MenuRow
								onClick={() => {
									void store.duplicateProperty(prop);
									onClose();
								}}
							>
								Duplicate
							</MenuRow>
							<MenuRow danger onClick={() => setConfirmDelete(true)}>
								<TrashIcon size={14} /> Delete column
							</MenuRow>
						</>
					)}
				</div>
			)}
			{mode === "root" && choiceBased && canEdit && (
				<ChoicesEditor store={store} prop={prop} />
			)}
		</Popover>
	);
}

function typeName(type: PropertyType) {
	for (const group of TYPE_GROUPS) {
		const found = group.items.find((i) => i.type === type);
		if (found) return found.label;
	}
	return type === "title" ? "Name" : type;
}

// The + at the end of the header, and the empty state's add buttons.
export function AddPropertyMenu({
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
	const [dialog, setDialog] = useState<null | PropertyType>(null);

	const pick = (type: PropertyType) => {
		if (
			type === "formula" ||
			type === "relation" ||
			type === "ai" ||
			type === "rollup"
		) {
			setDialog(type);
			return;
		}
		void store.createProperty({
			name: nextPropertyName(store, NEW_PROPERTY_NAMES[type] ?? "Column"),
			type,
			options: defaultOptions(type),
		});
		onClose();
	};

	if (dialog === "formula")
		return <FormulaDialog store={store} onClose={onClose} />;
	if (dialog === "relation")
		return (
			<RelationDialog
				store={store}
				view={view}
				name={nextPropertyName(store, "Related")}
				onClose={onClose}
			/>
		);
	if (dialog === "rollup")
		return (
			<RollupPanel
				anchor={anchor}
				store={store}
				view={view}
				onClose={onClose}
			/>
		);
	if (dialog === "ai")
		return <AiColumnPanel store={store} view={view} onClose={onClose} />;

	return (
		<Popover
			anchor={anchor}
			open
			onClose={onClose}
			className="max-h-[80vh] w-[280px] overflow-auto"
		>
			<TypeList label="New column" onPick={pick} />
		</Popover>
	);
}
