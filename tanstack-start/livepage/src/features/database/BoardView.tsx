// Board view: cards in columns, dragged between columns and within one.
import { useState } from "react";
import { MoreIcon, PlusIcon } from "#/components/icons";
import { Button, Menu, type MenuItem, useMenu } from "#/components/ui";
import { ValueDisplay } from "./cells";
import type { DatabaseStore } from "./store";
import { columnsFor } from "./TableView";
import type { Property, View } from "./types";
import { COLOR_CYCLE, DEFAULT_STATUS_CHOICES } from "./types";
import type { CellPresence } from "./ui";
import { Chip, dragPresenceAt, nextPropertyName } from "./ui";
import { choiceById, EMPTY_GROUP, isEmptyValue } from "./values";

export function groupableProps(store: DatabaseStore) {
	return store.properties.filter(
		(p) =>
			p.type === "status" ||
			p.type === "select" ||
			p.type === "multi_select" ||
			p.type === "person" ||
			p.type === "checkbox",
	);
}

export function boardGroupProp(store: DatabaseStore, view: View) {
	const config = store.configFor(view);
	const chosen = config.groupBy
		? store.propsById.get(config.groupBy)
		: undefined;
	if (chosen) return chosen;
	return (
		groupableProps(store).find((p) => p.type === "status") ??
		groupableProps(store)[0] ??
		null
	);
}

function moveGroupValue(
	prop: Property,
	current: unknown,
	from: string,
	to: string,
) {
	if (to === EMPTY_GROUP) {
		if (prop.type === "multi_select" || prop.type === "person") {
			return Array.isArray(current) ? current.filter((x) => x !== from) : [];
		}
		return prop.type === "checkbox" ? false : null;
	}
	if (prop.type === "checkbox") return to === "true";
	if (prop.type === "multi_select" || prop.type === "person") {
		const list = Array.isArray(current)
			? current.filter((x) => x !== from)
			: [];
		return list.includes(to) ? list : [...list, to];
	}
	return to;
}

export function BoardView({
	store,
	view,
	search,
	onOpenRow,
	peers,
	announce,
}: {
	store: DatabaseStore;
	view: View;
	search: string;
	onOpenRow: (rowId: string) => void;
	peers: Map<string, CellPresence>;
	announce: (
		c: { rowId: string; propertyId: string | null; drag?: boolean } | null,
	) => void;
}) {
	const config = store.configFor(view);
	const groupProp = boardGroupProp(store, view);
	const canEdit = store.access.canEdit;
	// Runs the same pipeline as the table, with the board's group column applied.
	const result = store.rowsFor(view, search, groupProp?.id);
	const columns = result.groups ?? [];
	const cardProps = columnsFor(store, config).filter(
		(p) => p.id !== groupProp?.id && p.type !== "title",
	);
	const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
	const [dropAt, setDropAt] = useState<{ group: string; index: number } | null>(
		null,
	);
	const [groupDraft, setGroupDraft] = useState<string | null>(null);

	if (!groupProp) {
		return (
			<div className="px-4 py-12 text-base text-graphite md:px-8">
				<p>A board needs a Status or Select column to group its cards.</p>
				{canEdit && (
					<Button
						className="mt-3"
						onClick={() =>
							void store.createProperty({
								name: nextPropertyName(store, "Status"),
								type: "status",
								options: { choices: DEFAULT_STATUS_CHOICES },
							})
						}
					>
						Add a Status column
					</Button>
				)}
			</div>
		);
	}

	const commitDrop = (group: string, index: number) => {
		if (!drag) return;
		const list = columns.find((c) => c.key === group)?.ids ?? [];
		const others = list.filter((id) => id !== drag.id);
		const before = others[index - 1];
		const after = others[index];
		const posOf = (id: string | undefined) =>
			id === undefined ? undefined : store.rows.get(id)?.position;
		if (group !== drag.from) {
			const current = store.value(drag.id, groupProp.id);
			store.setCell(
				drag.id,
				groupProp.id,
				moveGroupValue(groupProp, current, drag.from, group),
			);
		}
		if (!config.sorts.length) {
			const b = posOf(before);
			const a = posOf(after);
			let position: number;
			if (b !== undefined && a !== undefined) position = (b + a) / 2;
			else if (b !== undefined) position = b + 1;
			else if (a !== undefined) position = a - 1;
			else position = store.nextPosition();
			store.setPosition(drag.id, position);
		}
		setDrag(null);
		setDropAt(null);
		announce(null);
	};

	// Fingers can't use HTML5 drag, so a card also moves through its menu.
	const moveCard = (id: string, from: string, to: string) => {
		if (from === to) return;
		store.setCell(
			id,
			groupProp.id,
			moveGroupValue(groupProp, store.value(id, groupProp.id), from, to),
		);
		if (!config.sorts.length) store.setPosition(id, store.nextPosition());
	};

	const groupColor = (key: string) => {
		const choice = choiceById(groupProp, key);
		return choice?.color ?? "gray";
	};

	const canAddGroup =
		canEdit && (groupProp.type === "status" || groupProp.type === "select");

	const addGroup = (raw: string) => {
		const name = raw.trim();
		if (!name) return;
		const choices = groupProp.options.choices ?? [];
		void store.updateProperty(groupProp.id, {
			options: {
				...groupProp.options,
				choices: [
					...choices,
					{
						id: `opt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
						name,
						color: COLOR_CYCLE[choices.length % COLOR_CYCLE.length],
					},
				],
			},
		});
	};

	return (
		<div className="flex min-h-0 flex-1 gap-4 overflow-auto px-4 md:px-8 pt-5 pb-6 max-md:snap-x max-md:snap-proximity max-md:scroll-px-4">
			{columns.map((column) => {
				const list = column.ids;
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: a drop target, cards inside are the controls
					<div
						key={column.key}
						data-board-column={column.label}
						className="flex w-[268px] shrink-0 flex-col max-md:w-[78vw] max-md:snap-start"
						onDragOver={(e) => {
							if (!drag) return;
							e.preventDefault();
							const items = [
								...e.currentTarget.querySelectorAll<HTMLElement>(
									"[data-board-card]",
								),
							];
							let index = items.length;
							for (let i = 0; i < items.length; i++) {
								const rect = items[i].getBoundingClientRect();
								if (e.clientY < rect.top + rect.height / 2) {
									index = i;
									break;
								}
							}
							setDropAt({ group: column.key, index });
						}}
						onDrop={(e) => {
							e.preventDefault();
							if (dropAt) commitDrop(dropAt.group, dropAt.index);
						}}
					>
						<div className="mb-3 flex items-center gap-2 text-sm">
							{choiceById(groupProp, column.key) ? (
								<Chip color={groupColor(column.key)}>{column.label}</Chip>
							) : (
								<span className="font-medium text-ink">{column.label}</span>
							)}
							<span className="text-pencil">{list.length}</span>
						</div>
						<div className="flex min-h-[60px] flex-col gap-2">
							{list.map((id, index) => (
								<div key={id}>
									{dropAt?.group === column.key &&
										dropAt.index === index &&
										drag && <DropMarker />}
									<Card
										store={store}
										id={id}
										props={cardProps}
										groupProp={groupProp}
										peer={dragPresenceAt(peers, id)}
										dragging={drag?.id === id}
										onOpen={() => onOpenRow(id)}
										moveItems={
											canEdit
												? [
														// "No Status" hides while empty, but a card can always be moved there.
														...(columns.some((c) => c.key === EMPTY_GROUP)
															? []
															: [
																	{
																		key: EMPTY_GROUP,
																		label: `No ${groupProp.name}`,
																	},
																]),
														...columns,
													]
														.filter((c) => c.key !== column.key)
														.map((c) => ({
															id: c.key,
															label: `Move to ${c.label}`,
															onSelect: () => moveCard(id, column.key, c.key),
														}))
												: []
										}
										draggable={canEdit}
										onDragStart={() => {
											setDrag({ id, from: column.key });
											announce({ rowId: id, propertyId: null, drag: true });
										}}
										onDragEnd={() => {
											setDrag(null);
											setDropAt(null);
											announce(null);
										}}
									/>
								</div>
							))}
							{dropAt?.group === column.key &&
								dropAt.index === list.length &&
								drag && <DropMarker />}
							{canEdit && (
								<button
									type="button"
									onClick={() => {
										const value = moveGroupValue(
											groupProp,
											null,
											"",
											column.key,
										);
										const id = store.createRow({
											cells:
												isEmptyValue(value) || column.key === EMPTY_GROUP
													? {}
													: { [groupProp.id]: value },
										});
										onOpenRow(id);
									}}
									className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-pencil hover:bg-wash hover:text-ink"
								>
									<PlusIcon size={12} /> New
								</button>
							)}
						</div>
					</div>
				);
			})}
			{canAddGroup &&
				(groupDraft !== null ? (
					<input
						// biome-ignore lint/a11y/noAutofocus: the person just asked to name a new group
						autoFocus
						aria-label="New group name"
						placeholder="Group name"
						className="h-8 w-40 shrink-0 rounded-md border border-link bg-paper px-2 text-sm outline-none"
						value={groupDraft}
						onChange={(e) => setGroupDraft(e.target.value)}
						onBlur={() => {
							addGroup(groupDraft);
							setGroupDraft(null);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
							if (e.key === "Escape") setGroupDraft(null);
						}}
					/>
				) : (
					<button
						type="button"
						onClick={() => setGroupDraft("")}
						className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm whitespace-nowrap text-pencil hover:bg-wash hover:text-ink"
					>
						<PlusIcon size={12} /> Add a group
					</button>
				))}
		</div>
	);
}

function CardMenu({ items }: { items: MenuItem[] }) {
	const menu = useMenu();
	return (
		<span className="absolute right-1.5 top-1.5">
			<button
				ref={menu.anchor}
				type="button"
				aria-label="Move card"
				aria-haspopup="menu"
				onClick={menu.toggle}
				className="hidden items-center justify-center rounded-sm text-pencil hover:bg-wash-2 coarse:flex coarse:size-10"
			>
				<MoreIcon size={14} />
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				items={items}
				align="end"
			/>
		</span>
	);
}

function DropMarker() {
	return (
		<div className="mb-2 h-16 rounded-lg border border-dashed border-link bg-link-soft/60" />
	);
}

function Card({
	store,
	id,
	props,
	groupProp,
	peer,
	dragging,
	onOpen,
	moveItems,
	draggable,
	onDragStart,
	onDragEnd,
}: {
	store: DatabaseStore;
	moveItems: MenuItem[];
	id: string;
	props: Property[];
	groupProp: Property;
	peer: CellPresence | null;
	dragging: boolean;
	onOpen: () => void;
	draggable: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
}) {
	const row = store.rows.get(id);
	const line = props.find(
		(p) =>
			(p.type === "text" || p.type === "ai" || p.type === "formula") &&
			!isEmptyValue(store.value(id, p.id)),
	);
	const footer = props.filter(
		(p) =>
			p.id !== line?.id &&
			(p.type === "person" ||
				p.type === "select" ||
				p.type === "date" ||
				p.type === "number") &&
			!isEmptyValue(store.value(id, p.id)),
	);
	void groupProp;
	return (
		<div className="relative">
			{/* biome-ignore lint/a11y/useSemanticElements: cards are draggable and hold chips, so they can't be buttons */}
			<div
				data-board-card={row?.title ?? ""}
				className={`relative cursor-pointer rounded-lg border border-rule bg-card p-3.5 hover:border-pencil ${dragging ? "opacity-40" : ""}`}
				draggable={draggable}
				onDragStart={(e) => {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", id);
					onDragStart();
				}}
				onDragEnd={onDragEnd}
				onClick={onOpen}
				onKeyDown={(e) => {
					if (e.key === "Enter") onOpen();
				}}
				role="button"
				tabIndex={0}
			>
				{peer && (
					<span className="absolute -top-2.5 right-2 rounded-sm bg-coral px-1.5 text-xs font-medium leading-[18px] text-paper">
						{peer.name} is moving this
					</span>
				)}
				<div className="truncate text-base font-medium text-ink coarse:pr-7">
					{row?.title || <span className="text-pencil">Untitled</span>}
				</div>
				{line && (
					<div className="mt-1 line-clamp-2 text-sm leading-[19px] text-graphite">
						{store.text(id, line.id)}
					</div>
				)}
				{footer.length > 0 && (
					<div className="mt-2 flex items-center justify-between gap-2 text-sm">
						<span className="flex min-w-0 items-center gap-2">
							{footer
								.filter((p) => p.type === "person")
								.slice(0, 1)
								.map((p) => (
									<ValueDisplay
										key={p.id}
										store={store}
										prop={p}
										value={store.value(id, p.id)}
										rowId={id}
									/>
								))}
						</span>
						<span className="flex shrink-0 items-center gap-2 text-sm text-graphite">
							{footer
								.filter((p) => p.type !== "person")
								.slice(0, 1)
								.map((p) => (
									<span key={p.id}>
										<ValueDisplay
											store={store}
											prop={p}
											value={store.value(id, p.id)}
											rowId={id}
										/>
									</span>
								))}
						</span>
					</div>
				)}
			</div>
			{moveItems.length > 0 && <CardMenu items={moveItems} />}
		</div>
	);
}
