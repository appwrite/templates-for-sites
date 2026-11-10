// biome-ignore-all lint/a11y/useSemanticElements: a virtualized data grid; div rows are what makes absolute positioning work
// biome-ignore-all lint/a11y/useFocusableInteractive: focus lives on the grid; arrow keys move the active cell
// The table view: virtualized rows, sticky first column, keyboard navigation, inline editors,
// resizable and reorderable columns, selection and footer calculations.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CheckIcon,
	ChevronDown,
	ChevronRight,
	PlusIcon,
} from "#/components/icons";
import { Menu, type MenuItem, useToast } from "#/components/ui";
import { copyText } from "#/lib/browser";
import {
	CellDisplay,
	CellPopoverEditor,
	canEditType,
	InlineEditor,
	inlineEditable,
} from "./cells";
import { AddPropertyMenu, PropertyMenu } from "./property-menu";
import type { DatabaseStore } from "./store";
import type { CalcFn, Property, View, ViewConfig } from "./types";
import { type CellPresence, Chip, presenceAt } from "./ui";
import {
	CALC_LABELS,
	calcsFor,
	calculate,
	choiceById,
	EMPTY_GROUP,
	groupLabel,
} from "./values";

const ROW_H = 44;
const HEAD_H = 36;
const FOOT_H = 36;
const GUTTER = 44;
const OVERSCAN = 6;

const defaultWidth = (prop: Property) =>
	prop.type === "title"
		? window.innerWidth < 640
			? 150
			: 280
		: prop.type === "checkbox"
			? 110
			: prop.type === "ai" || prop.type === "text"
				? 260
				: 170;

export function columnsFor(store: DatabaseStore, config: ViewConfig) {
	const order = new Map(config.order.map((id, i) => [id, i]));
	const props = store.properties
		.filter((p) => !config.hidden.includes(p.id))
		.sort((a, b) => {
			if (a.type === "title") return -1;
			if (b.type === "title") return 1;
			const x = order.get(a.id);
			const y = order.get(b.id);
			if (x !== undefined && y !== undefined) return x - y;
			if (x !== undefined) return -1;
			if (y !== undefined) return 1;
			return a.position - b.position;
		});
	return props;
}

type Item =
	| { kind: "row"; id: string; top: number; group?: string }
	| { kind: "group"; key: string; label: string; count: number; top: number }
	| { kind: "add"; key: string; top: number; group: string | null };

type Active = { row: string; col: string };

export function TableView({
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
	announce: (c: { rowId: string; propertyId: string | null } | null) => void;
}) {
	const config = store.configFor(view);
	const canEdit = store.access.canEdit;
	const { ids, groups } = store.rowsFor(view, search);
	const columns = columnsFor(store, config);
	const groupBy = config.groupBy ? store.propsById.get(config.groupBy) : null;

	const scrollRef = useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = useState({ top: 0, height: 700 });
	const [widths, setWidths] = useState<Record<string, number>>({});
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const anchorRow = useRef<string | null>(null);
	const [active, setActive] = useState<Active | null>(null);
	const [editing, setEditing] = useState<{ initial?: string } | null>(null);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [dragCol, setDragCol] = useState<string | null>(null);
	const [dropCol, setDropCol] = useState<string | null>(null);
	const [dragRow, setDragRow] = useState<string | null>(null);
	const [dropRow, setDropRow] = useState<{
		id: string;
		after: boolean;
	} | null>(null);
	const [rowMenu, setRowMenu] = useState<string | null>(null);
	const rowMenuAnchor = useRef<HTMLElement | null>(null);
	const toast = useToast();

	// Clear selection state that no longer points at real rows.
	useEffect(() => {
		setSelected((current) => {
			const next = new Set([...current].filter((id) => store.rows.has(id)));
			return next.size === current.size ? current : next;
		});
	});

	const widthOf = useCallback(
		(prop: Property) =>
			widths[prop.id] ?? config.widths[prop.id] ?? defaultWidth(prop),
		[widths, config.widths],
	);

	const items = useMemo<Item[]>(() => {
		const out: Item[] = [];
		let top = 0;
		const addRow = (id: string, group?: string) => {
			out.push({ kind: "row", id, top, group });
			top += ROW_H;
		};
		if (groups) {
			for (const group of groups) {
				out.push({
					kind: "group",
					key: group.key,
					label: group.label,
					count: group.ids.length,
					top,
				});
				top += ROW_H;
				if (collapsed.has(group.key)) continue;
				for (const id of group.ids) addRow(id, group.key);
				if (canEdit) {
					out.push({ kind: "add", key: group.key, top, group: group.key });
					top += ROW_H;
				}
			}
		} else {
			for (const id of ids) addRow(id);
			if (canEdit) {
				out.push({ kind: "add", key: "__end", top, group: null });
				top += ROW_H;
			}
		}
		return out;
	}, [groups, ids, collapsed, canEdit]);

	const totalHeight = items.length ? items[items.length - 1].top + ROW_H : 0;

	const firstVisible = useMemo(() => {
		let lo = 0;
		let hi = items.length;
		while (lo < hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (items[mid].top + ROW_H < viewport.top) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}, [items, viewport.top]);

	const start = Math.max(0, firstVisible - OVERSCAN);
	const end = Math.min(
		items.length,
		firstVisible + Math.ceil(viewport.height / ROW_H) + OVERSCAN,
	);
	const visible = items.slice(start, end);
	const scrollFrame = useRef(0);

	const syncViewport = useCallback(() => {
		const el = scrollRef.current;
		if (el) setViewport({ top: el.scrollTop, height: el.clientHeight });
	}, []);

	const onScroll = () => {
		cancelAnimationFrame(scrollFrame.current);
		scrollFrame.current = requestAnimationFrame(syncViewport);
	};

	useEffect(() => {
		syncViewport();
		const el = scrollRef.current;
		if (!el) return;
		const observer = new ResizeObserver(syncViewport);
		observer.observe(el);
		return () => observer.disconnect();
	}, [syncViewport]);

	const rowOrder = useMemo(
		() =>
			items
				.filter((i): i is Item & { kind: "row" } => i.kind === "row")
				.map((i) => i.id),
		[items],
	);

	const setActiveCell = useCallback(
		(next: Active | null) => {
			setActive(next);
			setEditing(null);
			announce(next ? { rowId: next.row, propertyId: next.col } : null);
		},
		[announce],
	);

	// Someone else deleted the row or column under the highlight: let go of it, and say so
	// if there was text being typed into it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: recomputed whenever the store changes
	useEffect(() => {
		if (!active) return;
		const rowGone = !store.rows.has(active.row);
		if (!rowGone && store.propsById.has(active.col)) return;
		if (editing)
			toast.show(
				rowGone
					? "This row was just deleted."
					: "This column was just deleted.",
			);
		setActiveCell(null);
	}, [active, editing, store, store.getVersion(), toast]);

	const beginEdit = useCallback(
		(cell: Active, initial?: string) => {
			const prop = store.propsById.get(cell.col);
			if (!prop || !canEdit || !canEditType(prop)) return;
			if (prop.type === "checkbox") {
				store.setCell(cell.row, prop.id, !store.value(cell.row, prop.id));
				setActive(cell);
				return;
			}
			setActive(cell);
			setEditing({ initial });
			announce({ rowId: cell.row, propertyId: cell.col });
		},
		[announce, canEdit, store],
	);

	const scrollToRow = useCallback(
		(rowId: string) => {
			const item = items.find((i) => i.kind === "row" && i.id === rowId);
			const el = scrollRef.current;
			if (!item || !el) return;
			const viewTop = el.scrollTop + HEAD_H;
			const viewBottom = el.scrollTop + el.clientHeight - FOOT_H;
			if (item.top < viewTop - HEAD_H) el.scrollTop = item.top;
			else if (item.top + ROW_H > viewBottom)
				el.scrollTop = item.top + ROW_H - el.clientHeight + FOOT_H + HEAD_H;
		},
		[items],
	);

	const scrollToCol = useCallback(
		(colId: string) => {
			const el = scrollRef.current;
			if (!el) return;
			let left = GUTTER;
			for (const col of columns) {
				if (col.id === colId) break;
				left += widthOf(col);
			}
			const width = widthOf(columns.find((c) => c.id === colId) ?? columns[0]);
			const titleWidth = widthOf(columns[0]) + GUTTER;
			if (left - titleWidth < el.scrollLeft) el.scrollLeft = left - titleWidth;
			else if (left + width > el.scrollLeft + el.clientWidth)
				el.scrollLeft = left + width - el.clientWidth;
		},
		[columns, widthOf],
	);

	const move = useCallback(
		(dx: number, dy: number) => {
			if (!active) return;
			const colIndex = columns.findIndex((c) => c.id === active.col);
			const rowIndex = rowOrder.indexOf(active.row);
			const nextCol =
				columns[Math.max(0, Math.min(columns.length - 1, colIndex + dx))];
			const nextRow =
				rowOrder[Math.max(0, Math.min(rowOrder.length - 1, rowIndex + dy))];
			if (!nextCol || !nextRow) return;
			setActiveCell({ row: nextRow, col: nextCol.id });
			scrollToRow(nextRow);
			scrollToCol(nextCol.id);
		},
		[active, columns, rowOrder, scrollToCol, scrollToRow, setActiveCell],
	);

	// A click edits where it lands, like Notion. Cells that can't be edited just take the highlight.
	const onCellClick = useCallback(
		(cell: Active) => {
			const prop = store.propsById.get(cell.col);
			if (prop && canEdit && canEditType(prop)) {
				beginEdit(cell);
				return;
			}
			setActiveCell(cell);
			scrollRef.current?.focus();
		},
		[beginEdit, canEdit, setActiveCell, store],
	);

	const onDoneEditing = useCallback(
		(moveDir?: "next" | "down" | "up") => {
			setEditing(null);
			if (moveDir === "next") move(1, 0);
			if (moveDir === "down") move(0, 1);
			if (moveDir === "up") move(0, -1);
			scrollRef.current?.focus();
		},
		[move],
	);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (editing || !active) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				move(0, 1);
				return;
			case "ArrowUp":
				e.preventDefault();
				move(0, -1);
				return;
			case "ArrowLeft":
				e.preventDefault();
				move(-1, 0);
				return;
			case "ArrowRight":
				e.preventDefault();
				move(1, 0);
				return;
			case "Tab":
				e.preventDefault();
				move(e.shiftKey ? -1 : 1, 0);
				return;
			case "Enter":
				e.preventDefault();
				beginEdit(active);
				return;
			case " ": {
				const prop = store.propsById.get(active.col);
				if (prop?.type === "checkbox") {
					e.preventDefault();
					beginEdit(active);
				}
				return;
			}
			case "Escape":
				setActiveCell(null);
				return;
			case "Backspace":
			case "Delete": {
				const prop = store.propsById.get(active.col);
				if (!prop || !canEdit || !canEditType(prop) || prop.type === "title")
					return;
				e.preventDefault();
				if (prop.type === "relation") store.setRelation(active.row, prop, []);
				else store.setCell(active.row, prop.id, null);
				return;
			}
			default:
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
			const text = store.text(active.row, active.col);
			void copyText(text);
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
			e.preventDefault();
			const prop = store.propsById.get(active.col);
			if (!prop || !canEdit || !inlineEditable(prop)) return;
			void navigator.clipboard?.readText().then((text) => {
				if (prop.type === "title") store.setTitle(active.row, text);
				else if (prop.type === "number") {
					const n = Number(text);
					if (!Number.isNaN(n)) store.setCell(active.row, prop.id, n);
				} else store.setCell(active.row, prop.id, text);
			});
			return;
		}
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const prop = store.propsById.get(active.col);
			if (prop && inlineEditable(prop)) {
				e.preventDefault();
				beginEdit(active, e.key);
			}
		}
	};

	const allSelected =
		rowOrder.length > 0 && rowOrder.every((id) => selected.has(id));

	const toggleSelect = (rowId: string, shift: boolean) => {
		setSelected((current) => {
			const next = new Set(current);
			if (shift && anchorRow.current) {
				const a = rowOrder.indexOf(anchorRow.current);
				const b = rowOrder.indexOf(rowId);
				const [from, to] = a < b ? [a, b] : [b, a];
				for (let i = from; i <= to; i++) next.add(rowOrder[i]);
			} else if (next.has(rowId)) next.delete(rowId);
			else next.add(rowId);
			return next;
		});
		anchorRow.current = rowId;
	};

	const startResize = (e: React.PointerEvent, prop: Property) => {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startWidth = widthOf(prop);
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		let latest = startWidth;
		const onMove = (ev: PointerEvent) => {
			latest = Math.max(80, startWidth + ev.clientX - startX);
			setWidths((w) => ({ ...w, [prop.id]: latest }));
		};
		const onUp = () => {
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerup", onUp);
			store.updateConfig(view, {
				widths: { ...config.widths, [prop.id]: latest },
			});
			setWidths((w) => {
				const copy = { ...w };
				delete copy[prop.id];
				return copy;
			});
		};
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerup", onUp);
	};

	const reorderColumns = (from: string, to: string) => {
		const order = columns.map((c) => c.id);
		const fromIndex = order.indexOf(from);
		const toIndex = order.indexOf(to);
		if (fromIndex < 0 || toIndex < 0) return;
		order.splice(fromIndex, 1);
		order.splice(toIndex, 0, from);
		store.updateConfig(view, { order });
	};

	const addRow = (group: string | null) => {
		if (!canEdit) return;
		const cells: Record<string, unknown> = {};
		if (group && groupBy && group !== EMPTY_GROUP && groupBy.type !== "date") {
			cells[groupBy.id] =
				groupBy.type === "multi_select" || groupBy.type === "person"
					? [group]
					: groupBy.type === "checkbox"
						? group === "true"
						: group;
		}
		const id = store.createRow({ cells });
		const title = columns.find((c) => c.type === "title");
		if (title) {
			setActive({ row: id, col: title.id });
			setEditing({});
			announce({ rowId: id, propertyId: title.id });
		}
		requestAnimationFrame(() => scrollToRow(id));
	};

	// Rows reorder by hand only when nothing else decides their order.
	const canReorderRows = canEdit && !config.sorts.length && !groupBy && !search;

	const moveRow = (rowId: string, targetId: string, after: boolean) => {
		if (rowId === targetId) return;
		const order = rowOrder.filter((id) => id !== rowId);
		const at = order.indexOf(targetId) + (after ? 1 : 0);
		const posOf = (id: string | undefined) =>
			id === undefined ? undefined : store.rows.get(id)?.position;
		const before = posOf(order[at - 1]);
		const next = posOf(order[at]);
		const position =
			before !== undefined && next !== undefined
				? (before + next) / 2
				: before !== undefined
					? before + 1
					: next !== undefined
						? next - 1
						: store.nextPosition();
		store.setPosition(rowId, position);
	};

	const openRowMenu = (rowId: string, anchor: HTMLElement) => {
		rowMenuAnchor.current = anchor;
		setRowMenu(rowId);
	};

	const trashRow = async (rowId: string) => {
		const ok = await store.trashRows([rowId]);
		if (ok)
			toast.show("Moved 1 row to Trash", {
				action: { label: "Undo", run: () => void store.restoreRows([rowId]) },
			});
	};

	const rowMenuItems: MenuItem[] = rowMenu
		? [
				{ id: "open", label: "Open", onSelect: () => onOpenRow(rowMenu) },
				{
					id: "duplicate",
					label: "Duplicate",
					onSelect: () => void store.duplicateRows([rowMenu]),
				},
				{
					id: "delete",
					label: "Delete",
					danger: true,
					onSelect: () => void trashRow(rowMenu),
				},
			]
		: [];

	const gridWidth = GUTTER + columns.reduce((n, c) => n + widthOf(c), 0) + 48;
	const titleWidth = columns.length ? widthOf(columns[0]) : 280;

	const footerValues = (prop: Property) =>
		rowOrder.map((id) => store.value(id, prop.id));

	const bulk = selected.size > 0 && canEdit;

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={scrollRef}
				role="grid"
				tabIndex={0}
				aria-label={view.name}
				aria-rowcount={rowOrder.length}
				onScroll={onScroll}
				onKeyDown={onKeyDown}
				data-testid="db-table"
				className="min-h-0 flex-1 overflow-auto outline-none"
			>
				<div style={{ width: gridWidth, minWidth: "100%" }}>
					{/* Header */}
					<div className="sticky top-0 z-30 flex h-9 bg-paper" role="row">
						<div
							role="columnheader"
							aria-label="Select"
							className="sticky left-0 z-30 flex items-center justify-center bg-paper"
							style={{ width: GUTTER, minWidth: GUTTER }}
						>
							{canEdit && (
								<button
									type="button"
									role="checkbox"
									aria-checked={allSelected}
									aria-label="Select all rows"
									onClick={() =>
										setSelected(allSelected ? new Set() : new Set(rowOrder))
									}
									className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${allSelected ? "border-link bg-accent text-white" : "border-rule-strong opacity-0 hover:opacity-100 focus:opacity-100"}`}
								>
									{allSelected && <CheckIcon size={11} />}
								</button>
							)}
						</div>
						{columns.map((prop, index) => (
							<div
								key={prop.id}
								role="columnheader"
								className={`group/head relative flex items-center border-b border-rule pr-2 text-sm text-pencil ${index === 0 ? "sticky left-[44px] z-30 bg-paper" : ""} ${dropCol === prop.id ? "bg-link-soft" : ""}`}
								style={{ width: widthOf(prop) }}
								draggable={prop.type !== "title"}
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = "move";
									e.dataTransfer.setData("text/plain", prop.id);
									setDragCol(prop.id);
								}}
								onDragOver={(e) => {
									if (dragCol && dragCol !== prop.id && prop.type !== "title") {
										e.preventDefault();
										setDropCol(prop.id);
									}
								}}
								onDrop={(e) => {
									e.preventDefault();
									if (dragCol) reorderColumns(dragCol, prop.id);
									setDragCol(null);
									setDropCol(null);
								}}
								onDragEnd={() => {
									setDragCol(null);
									setDropCol(null);
								}}
							>
								<HeaderLabel
									prop={prop}
									store={store}
									view={view}
									open={menuFor === prop.id}
									onToggle={() =>
										setMenuFor((v) => (v === prop.id ? null : prop.id))
									}
									onClose={() => setMenuFor(null)}
									canEdit={canEdit}
								/>
								{canEdit && (
									// biome-ignore lint/a11y/noStaticElementInteractions: a drag handle, not a control
									<div
										role="presentation"
										className="absolute top-0 right-0 z-40 h-full w-1.5 cursor-col-resize hover:bg-link/30"
										onPointerDown={(e) => startResize(e, prop)}
										onClick={(e) => e.stopPropagation()}
									/>
								)}
							</div>
						))}
						{canEdit && (
							<div
								role="columnheader"
								className="relative flex w-12 items-center border-b border-rule pl-2"
							>
								<AddColumnButton
									store={store}
									view={view}
									adding={adding}
									setAdding={setAdding}
								/>
							</div>
						)}
						<div className="min-w-0 flex-1 border-b border-rule" />
					</div>

					{/* Body */}
					<div className="relative" style={{ height: totalHeight }}>
						{visible.map((item) => {
							if (item.kind === "group") {
								return (
									<GroupHeader
										key={`g-${item.key}`}
										store={store}
										groupBy={groupBy ?? undefined}
										item={item}
										collapsed={collapsed.has(item.key)}
										onToggle={() =>
											setCollapsed((current) => {
												const next = new Set(current);
												if (next.has(item.key)) next.delete(item.key);
												else next.add(item.key);
												return next;
											})
										}
									/>
								);
							}
							if (item.kind === "add") {
								return (
									<div
										key={`a-${item.key}`}
										role="row"
										className="absolute right-0 left-0"
										style={{ top: item.top }}
									>
										<div role="gridcell" className="sticky left-[52px] w-fit">
											<button
												type="button"
												className="flex h-11 items-center text-base text-pencil hover:text-ink"
												onClick={() => addRow(item.group)}
											>
												+ New row
											</button>
										</div>
									</div>
								);
							}
							return (
								<TableRow
									key={item.id}
									store={store}
									rowId={item.id}
									top={item.top}
									columns={columns}
									widthOf={widthOf}
									titleWidth={titleWidth}
									selected={selected.has(item.id)}
									active={active}
									editing={editing}
									peers={peers}
									canEdit={canEdit}
									onSelectToggle={toggleSelect}
									onCellClick={onCellClick}
									canReorder={canReorderRows}
									dragging={dragRow === item.id}
									dropMark={dropRow?.id === item.id ? dropRow : null}
									onRowDragStart={() => setDragRow(item.id)}
									onRowDragOver={(after) =>
										setDropRow(
											dragRow && dragRow !== item.id
												? { id: item.id, after }
												: null,
										)
									}
									onRowDrop={(after) => {
										if (dragRow) moveRow(dragRow, item.id, after);
										setDragRow(null);
										setDropRow(null);
									}}
									onRowDragEnd={() => {
										setDragRow(null);
										setDropRow(null);
									}}
									onRowMenu={openRowMenu}
									onDoneEditing={onDoneEditing}
									onOpen={() => onOpenRow(item.id)}
								/>
							);
						})}
					</div>

					{/* Footer calculations */}
					<div className="sticky bottom-0 z-20 flex h-9 bg-paper" role="row">
						<div
							className="sticky left-0 z-20 border-t border-rule bg-paper"
							style={{ width: GUTTER, minWidth: GUTTER }}
						/>
						{columns.map((prop, index) => (
							<div
								key={prop.id}
								role="gridcell"
								className={`border-t border-rule ${index === 0 ? "sticky left-[44px] z-20 bg-paper" : ""}`}
								style={{ width: widthOf(prop) }}
							>
								<FooterCell
									store={store}
									view={view}
									prop={prop}
									values={footerValues}
									names={store.names}
								/>
							</div>
						))}
						<div className="min-w-[48px] flex-1 border-t border-rule" />
					</div>
				</div>
			</div>

			<Menu
				anchor={rowMenuAnchor}
				open={rowMenu !== null}
				onClose={() => setRowMenu(null)}
				items={rowMenuItems}
			/>

			{bulk && (
				<BulkBar
					store={store}
					columns={columns}
					selected={selected}
					toast={toast}
					onClear={() => setSelected(new Set())}
				/>
			)}
		</div>
	);
}

function HeaderLabel({
	prop,
	store,
	view,
	open,
	onToggle,
	onClose,
	canEdit,
}: {
	prop: Property;
	store: DatabaseStore;
	view: View;
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	canEdit: boolean;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button
				ref={ref}
				type="button"
				onClick={onToggle}
				aria-haspopup="menu"
				aria-expanded={open}
				className={`flex h-full min-w-0 flex-1 items-center gap-1.5 truncate rounded-sm pl-2 text-left hover:bg-wash ${prop.type === "ai" ? "text-link" : ""}`}
			>
				{prop.type === "ai" && <span aria-hidden="true">✦</span>}
				<span className="truncate">{prop.name}</span>
				{open && <ChevronDown size={12} />}
			</button>
			{open && (
				<PropertyMenu
					anchor={ref}
					store={store}
					view={view}
					prop={prop}
					canEdit={canEdit}
					onClose={onClose}
				/>
			)}
		</>
	);
}

function AddColumnButton({
	store,
	view,
	adding,
	setAdding,
}: {
	store: DatabaseStore;
	view: View;
	adding: boolean;
	setAdding: (v: boolean) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button
				ref={ref}
				type="button"
				aria-label="Add a column"
				onClick={() => setAdding(true)}
				className="rounded-sm p-1 text-pencil hover:bg-wash-2 hover:text-ink"
			>
				<PlusIcon size={14} />
			</button>
			{adding && (
				<AddPropertyMenu
					anchor={ref}
					store={store}
					view={view}
					onClose={() => setAdding(false)}
				/>
			)}
		</>
	);
}

function GroupHeader({
	store,
	groupBy,
	item,
	collapsed,
	onToggle,
}: {
	store: DatabaseStore;
	groupBy?: Property;
	item: { key: string; label: string; count: number; top: number };
	collapsed: boolean;
	onToggle: () => void;
}) {
	const choice = groupBy ? choiceById(groupBy, item.key) : undefined;
	return (
		<div
			role="row"
			className="absolute right-0 left-0 flex h-11 items-center gap-2 border-b border-rule"
			style={{ top: item.top }}
		>
			<div role="gridcell" className="contents">
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={!collapsed}
					aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.label}`}
					className="flex h-full items-center gap-2 pl-[52px] text-graphite"
				>
					{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
					{choice ? (
						<Chip color={choice.color}>{choice.name}</Chip>
					) : (
						<span className="text-sm font-medium text-ink">
							{item.label ||
								(groupBy ? groupLabel(groupBy, item.key, store.names) : "")}
						</span>
					)}
					<span className="text-sm text-pencil">{item.count}</span>
				</button>
			</div>
		</div>
	);
}

function TableRow({
	store,
	rowId,
	top,
	columns,
	widthOf,
	titleWidth,
	selected,
	active,
	editing,
	peers,
	canEdit,
	onSelectToggle,
	onCellClick,
	onDoneEditing,
	onOpen,
	canReorder,
	dragging,
	dropMark,
	onRowDragStart,
	onRowDragOver,
	onRowDrop,
	onRowDragEnd,
	onRowMenu,
}: {
	store: DatabaseStore;
	rowId: string;
	top: number;
	columns: Property[];
	widthOf: (p: Property) => number;
	titleWidth: number;
	selected: boolean;
	active: Active | null;
	editing: { initial?: string } | null;
	peers: Map<string, CellPresence>;
	canEdit: boolean;
	onSelectToggle: (rowId: string, shift: boolean) => void;
	onCellClick: (cell: Active) => void;
	onDoneEditing: (move?: "next" | "down" | "up") => void;
	onOpen: () => void;
	canReorder: boolean;
	dragging: boolean;
	dropMark: { id: string; after: boolean } | null;
	onRowDragStart: () => void;
	onRowDragOver: (after: boolean) => void;
	onRowDrop: (after: boolean) => void;
	onRowDragEnd: () => void;
	onRowMenu: (rowId: string, anchor: HTMLElement) => void;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLButtonElement>(null);
	const afterHalf = (e: React.DragEvent) => {
		const rect = rowRef.current?.getBoundingClientRect();
		return rect ? e.clientY > rect.top + rect.height / 2 : false;
	};
	return (
		<div
			ref={rowRef}
			className={`group/row absolute right-0 left-0 flex h-11 ${selected ? "bg-link-soft/50" : ""} ${dragging ? "opacity-40" : ""}`}
			style={{ top }}
			role="row"
			data-row={rowId}
			onContextMenu={(e) => {
				if (!canEdit || !handleRef.current) return;
				e.preventDefault();
				onRowMenu(rowId, handleRef.current);
			}}
			onDragOver={(e) => {
				if (!canReorder) return;
				e.preventDefault();
				onRowDragOver(afterHalf(e));
			}}
			onDrop={(e) => {
				if (!canReorder) return;
				e.preventDefault();
				onRowDrop(afterHalf(e));
			}}
		>
			{dropMark && (
				<div
					className="pointer-events-none absolute right-0 left-[44px] z-20 h-0.5 bg-link"
					style={{ top: dropMark.after ? 42 : -1 }}
				/>
			)}
			<div
				role="gridcell"
				className="sticky left-0 z-10 flex items-center justify-center gap-0.5 border-b border-rule bg-paper"
				style={{ width: GUTTER, minWidth: GUTTER }}
			>
				{canEdit && (
					<button
						ref={handleRef}
						type="button"
						draggable={canReorder}
						aria-label="Row options"
						title={
							canReorder ? "Drag to move, click for options" : "Row options"
						}
						onClick={(e) => onRowMenu(rowId, e.currentTarget)}
						onDragStart={(e) => {
							if (!canReorder) return;
							e.dataTransfer.effectAllowed = "move";
							e.dataTransfer.setData("text/plain", rowId);
							if (rowRef.current)
								e.dataTransfer.setDragImage(rowRef.current, 20, 20);
							onRowDragStart();
						}}
						onDragEnd={onRowDragEnd}
						className={`flex h-5 w-4 items-center justify-center rounded-sm text-pencil opacity-0 hover:bg-wash-2 hover:text-ink focus:opacity-100 group-hover/row:opacity-100 ${canReorder ? "cursor-grab" : "cursor-pointer"}`}
					>
						⠿
					</button>
				)}
				{canEdit && (
					<button
						type="button"
						role="checkbox"
						aria-checked={selected}
						aria-label="Select row"
						onClick={(e) => onSelectToggle(rowId, e.shiftKey)}
						className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${selected ? "border-link bg-accent text-white" : "border-rule-strong opacity-0 group-hover/row:opacity-100 focus:opacity-100"}`}
					>
						{selected && <CheckIcon size={11} />}
					</button>
				)}
			</div>
			{columns.map((prop, index) => (
				<TableCell
					key={prop.id}
					store={store}
					rowId={rowId}
					prop={prop}
					width={widthOf(prop)}
					sticky={index === 0}
					titleWidth={titleWidth}
					isActive={active?.row === rowId && active.col === prop.id}
					editing={
						active?.row === rowId && active.col === prop.id && editing
							? editing
							: null
					}
					peer={presenceAt(peers, rowId, prop.id)}
					onCellClick={onCellClick}
					onDoneEditing={onDoneEditing}
					onOpen={onOpen}
				/>
			))}
			<div className="min-w-[48px] flex-1 border-b border-rule" />
		</div>
	);
}

function TableCell({
	store,
	rowId,
	prop,
	width,
	sticky,
	isActive,
	editing,
	peer,
	onCellClick,
	onDoneEditing,
	onOpen,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	width: number;
	sticky: boolean;
	titleWidth: number;
	isActive: boolean;
	editing: { initial?: string } | null;
	peer: CellPresence | null;
	onCellClick: (cell: Active) => void;
	onDoneEditing: (move?: "next" | "down" | "up") => void;
	onOpen: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const cell = { row: rowId, col: prop.id };
	const inline = editing && inlineEditable(prop);
	const popover = editing && !inlineEditable(prop);
	return (
		<div
			ref={ref}
			role="gridcell"
			aria-selected={isActive}
			data-cell={`${rowId}|${prop.id}`}
			data-prop={prop.name}
			// Popover editors render in a portal but still bubble here, so only count clicks on the cell itself.
			onClick={(e) => {
				if (!ref.current?.contains(e.target as Node)) return;
				if (editing && inlineEditable(prop)) return;
				onCellClick(cell);
			}}
			onKeyDown={undefined}
			className={`relative flex h-11 items-center border-b border-rule pl-2 pr-2 text-base ${sticky ? "sticky left-[44px] z-10 bg-paper font-medium" : ""} ${peer ? "z-20" : ""} ${isActive ? "z-20" : ""}`}
			style={{
				width,
				boxShadow: peer
					? `inset 0 0 0 2px var(--color-green)`
					: isActive
						? `inset 0 0 0 2px var(--color-link)`
						: undefined,
			}}
		>
			{peer && (
				<span className="absolute -top-[20px] right-1 z-30 h-[18px] rounded-t-[3px] rounded-br-[3px] bg-green px-1.5 text-xs leading-[18px] font-medium text-paper">
					{peer.name}
				</span>
			)}
			{inline ? (
				<InlineEditor
					store={store}
					rowId={rowId}
					prop={prop}
					initial={editing.initial}
					onDone={onDoneEditing}
				/>
			) : (
				<CellDisplay store={store} rowId={rowId} prop={prop} />
			)}
			{popover && (
				<CellPopoverEditor
					store={store}
					rowId={rowId}
					prop={prop}
					anchor={ref}
					onClose={() => onDoneEditing()}
				/>
			)}
			{sticky && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onOpen();
					}}
					className="absolute right-1.5 hidden h-[22px] items-center rounded-sm border border-rule-strong bg-paper px-1.5 text-xs text-graphite group-hover/row:flex hover:text-ink"
				>
					Open
				</button>
			)}
		</div>
	);
}

function FooterCell({
	store,
	view,
	prop,
	values,
	names,
}: {
	store: DatabaseStore;
	view: View;
	prop: Property;
	values: (prop: Property) => unknown[];
	names: DatabaseStore["names"];
}) {
	const config = store.configFor(view);
	const fn = config.footer[prop.id] as CalcFn | undefined;
	const ref = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const items: MenuItem[] = [
		...(fn
			? [
					{
						id: "none",
						label: "None",
						onSelect: () => {
							const footer = { ...config.footer };
							delete footer[prop.id];
							store.updateConfig(view, { footer });
						},
					},
				]
			: []),
		...calcsFor(prop.type).map((calc) => ({
			id: calc,
			label: CALC_LABELS[calc],
			onSelect: () =>
				store.updateConfig(view, {
					footer: { ...config.footer, [prop.id]: calc },
				}),
		})),
	];
	const result = fn ? calculate(fn, prop, values(prop), names) : "";
	return (
		<>
			<button
				ref={ref}
				type="button"
				onClick={() => setOpen(true)}
				className="group/foot flex h-full w-full items-center justify-end gap-1.5 truncate px-2 text-sm text-pencil hover:bg-wash"
			>
				{fn ? (
					<>
						<span className="truncate text-pencil">{CALC_LABELS[fn]}</span>
						<span className="font-medium text-ink tabular-nums">{result}</span>
					</>
				) : (
					<span className="opacity-0 group-hover/foot:opacity-100">
						Calculate
					</span>
				)}
			</button>
			<Menu
				anchor={ref}
				open={open}
				onClose={() => setOpen(false)}
				items={items}
				side="top"
			/>
		</>
	);
}

function BulkBar({
	store,
	columns,
	selected,
	toast,
	onClear,
}: {
	store: DatabaseStore;
	columns: Property[];
	selected: Set<string>;
	toast: ReturnType<typeof useToast>;
	onClear: () => void;
}) {
	const ids = [...selected];
	const ref = useRef<HTMLButtonElement>(null);
	const [picker, setPicker] = useState(false);
	const settable = columns.filter(
		(p) => p.type === "select" || p.type === "status" || p.type === "checkbox",
	);
	const items: MenuItem[] = settable.flatMap((prop) => {
		if (prop.type === "checkbox")
			return [
				{
					id: `${prop.id}-on`,
					label: `Check ${prop.name}`,
					onSelect: () => void store.bulkSet(ids, prop.id, true),
				},
				{
					id: `${prop.id}-off`,
					label: `Uncheck ${prop.name}`,
					onSelect: () => void store.bulkSet(ids, prop.id, false),
				},
			];
		return (prop.options.choices ?? []).map((choice) => ({
			id: `${prop.id}-${choice.id}`,
			label: `${prop.name}: ${choice.name}`,
			onSelect: () => void store.bulkSet(ids, prop.id, choice.id),
		}));
	});
	return (
		<div className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm shadow-pop">
			<span className="px-2 text-ink">
				{ids.length} {ids.length === 1 ? "row" : "rows"} selected
			</span>
			{items.length > 0 && (
				<>
					<button
						ref={ref}
						type="button"
						onClick={() => setPicker(true)}
						className="rounded-md px-2 py-1 text-graphite hover:bg-wash-2 hover:text-ink"
					>
						Set value
					</button>
					<Menu
						anchor={ref}
						open={picker}
						onClose={() => setPicker(false)}
						items={items}
						side="top"
					/>
				</>
			)}
			<button
				type="button"
				onClick={() => {
					onClear();
					void store.duplicateRows(ids);
				}}
				className="rounded-md px-2 py-1 text-graphite hover:bg-wash-2 hover:text-ink"
			>
				Duplicate
			</button>
			<button
				type="button"
				onClick={async () => {
					onClear();
					const ok = await store.trashRows(ids);
					if (ok)
						toast.show(
							`Moved ${ids.length} ${ids.length === 1 ? "row" : "rows"} to Trash`,
							{
								action: {
									label: "Undo",
									run: () => void store.restoreRows(ids),
								},
							},
						);
				}}
				className="rounded-md px-2 py-1 text-coral hover:bg-coral-soft"
			>
				Delete
			</button>
			<button
				type="button"
				onClick={onClear}
				className="rounded-md px-2 py-1 text-pencil hover:text-ink"
			>
				Clear
			</button>
		</div>
	);
}
