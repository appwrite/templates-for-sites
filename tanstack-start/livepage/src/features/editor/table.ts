// Tables: the grid's node view, its plus buttons and the row and column operations. Every operation
// takes an explicit table and cell, never the caret, so a menu or a plus button works no matter where
// the caret happens to be.
import { Extension } from "@tiptap/core";
import { TableKit, TableView } from "@tiptap/extension-table";
import type { NodeType, Node as PmNode } from "@tiptap/pm/model";
import {
	Plugin,
	PluginKey,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";
import {
	addColumn,
	addRow,
	fixTablesKey,
	removeColumn,
	removeRow,
	TableMap,
	tableNodeTypes,
} from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { BODY_FIELD, clientFor } from "./codec";

export const CELL_MIN_WIDTH = 120;

const PLUS_ICON =
	'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.500 6h9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

type TableAt = { pos: number; start: number; node: PmNode; map: TableMap };

function tableAtPos(view: EditorView, inside: number): TableAt | null {
	const $pos = view.state.doc.resolve(inside);
	for (let depth = $pos.depth; depth > 0; depth--) {
		const node = $pos.node(depth);
		if (node.type.spec.tableRole === "table")
			return {
				pos: $pos.before(depth),
				start: $pos.start(depth),
				node,
				map: TableMap.get(node),
			};
	}
	return null;
}

export type CellRef = TableAt & {
	cellPos: number;
	top: number;
	bottom: number;
	left: number;
	right: number;
};

export function cellRef(view: EditorView, cell: HTMLElement): CellRef | null {
	let inside: number;
	try {
		inside = view.posAtDOM(cell, 0);
	} catch {
		return null;
	}
	const table = tableAtPos(view, inside);
	if (!table) return null;
	const $pos = view.state.doc.resolve(inside);
	for (let depth = $pos.depth; depth > 0; depth--) {
		const role = $pos.node(depth).type.spec.tableRole;
		if (role === "cell" || role === "header_cell") {
			const cellPos = $pos.before(depth);
			const rect = table.map.findCell(cellPos - table.start);
			return { ...table, cellPos, ...rect };
		}
	}
	return null;
}

function rectOf(table: TableAt) {
	return {
		left: 0,
		top: 0,
		right: table.map.width,
		bottom: table.map.height,
		map: table.map,
		tableStart: table.start,
		table: table.node,
	};
}

function fresh(tr: Transaction, pos: number): TableAt | null {
	const node = tr.doc.nodeAt(pos);
	if (!node) return null;
	return { pos, start: pos + 1, node, map: TableMap.get(node) };
}

function caretIn(tr: Transaction, tablePos: number, row: number, col: number) {
	const table = fresh(tr, tablePos);
	if (!table) return tr;
	const r = Math.max(0, Math.min(row, table.map.height - 1));
	const c = Math.max(0, Math.min(col, table.map.width - 1));
	const cell = table.map.map[r * table.map.width + c];
	return tr.setSelection(
		TextSelection.near(tr.doc.resolve(table.start + cell + 1)),
	);
}

function rowCells(table: TableAt, row: number) {
	return table.map.cellsInRect({
		left: 0,
		right: table.map.width,
		top: row,
		bottom: row + 1,
	});
}

function setRowType(
	tr: Transaction,
	tablePos: number,
	row: number,
	type: NodeType,
) {
	const table = fresh(tr, tablePos);
	if (!table) return;
	for (const offset of rowCells(table, row)) {
		const cell = table.node.nodeAt(offset);
		if (cell && cell.type !== type)
			tr.setNodeMarkup(table.start + offset, type, cell.attrs, cell.marks);
	}
}

export function hasHeaderRow(table: TableAt) {
	const types = tableNodeTypes(table.node.type.schema);
	const cells = rowCells(table, 0);
	return (
		cells.length > 0 &&
		cells.every(
			(offset) => table.node.nodeAt(offset)?.type === types.header_cell,
		)
	);
}

function apply(view: EditorView, tr: Transaction) {
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

export function addRowAtEnd(view: EditorView, table: TableAt) {
	const tr = view.state.tr;
	addRow(tr, rectOf(table), table.map.height);
	caretIn(tr, table.pos, table.map.height, 0);
	apply(view, tr);
}

export function addColumnAtEnd(view: EditorView, table: TableAt) {
	const tr = view.state.tr;
	addColumn(tr, rectOf(table), table.map.width);
	caretIn(tr, table.pos, 0, table.map.width);
	apply(view, tr);
}

export function insertRow(
	view: EditorView,
	ref: CellRef,
	where: "above" | "below",
) {
	const tr = view.state.tr;
	const row = where === "above" ? ref.top : ref.bottom;
	const header = hasHeaderRow(ref);
	addRow(tr, rectOf(ref), row);
	// A row added above the header takes over as the header, the way a person expects it to read.
	if (header && row === 0) {
		const types = tableNodeTypes(ref.node.type.schema);
		setRowType(tr, ref.pos, 0, types.header_cell);
		setRowType(tr, ref.pos, 1, types.cell);
	}
	caretIn(tr, ref.pos, row, ref.left);
	apply(view, tr);
}

export function insertColumn(
	view: EditorView,
	ref: CellRef,
	where: "left" | "right",
) {
	const tr = view.state.tr;
	const col = where === "left" ? ref.left : ref.right;
	addColumn(tr, rectOf(ref), col);
	caretIn(tr, ref.pos, ref.top, col);
	apply(view, tr);
}

export function deleteTableRow(view: EditorView, ref: CellRef) {
	if (ref.map.height <= 1) return;
	const tr = view.state.tr;
	const header = ref.top === 0 && hasHeaderRow(ref);
	removeRow(tr, rectOf(ref), ref.top);
	// Removing the header row leaves the next row in its place, still as the header.
	if (header)
		setRowType(
			tr,
			ref.pos,
			0,
			tableNodeTypes(ref.node.type.schema).header_cell,
		);
	caretIn(tr, ref.pos, ref.top, ref.left);
	apply(view, tr);
}

export function deleteTableColumn(view: EditorView, ref: CellRef) {
	if (ref.map.width <= 1) return;
	const tr = view.state.tr;
	removeColumn(tr, rectOf(ref), ref.left);
	caretIn(tr, ref.pos, ref.top, ref.left);
	apply(view, tr);
}

export function toggleHeaderRow(view: EditorView, ref: CellRef) {
	const tr = view.state.tr;
	const types = tableNodeTypes(ref.node.type.schema);
	setRowType(
		tr,
		ref.pos,
		0,
		hasHeaderRow(ref) ? types.cell : types.header_cell,
	);
	caretIn(tr, ref.pos, ref.top, ref.left);
	apply(view, tr);
}

export function deleteWholeTable(view: EditorView, ref: CellRef) {
	const tr = view.state.tr;
	tr.delete(ref.pos, ref.pos + ref.node.nodeSize);
	tr.setSelection(
		TextSelection.near(tr.doc.resolve(Math.min(ref.pos, tr.doc.content.size))),
	);
	apply(view, tr);
}

// The grid inside a scroller, with the two plus buttons beside it. They live in the table's own DOM
// so each table on a page has its own, and they stay put however the table is scrolled.
class GridView extends TableView {
	private view: EditorView | undefined;
	private addRow: HTMLButtonElement;
	private addColumn: HTMLButtonElement;

	constructor(
		node: PmNode,
		cellMinWidth: number,
		view?: EditorView,
		attrs?: Record<string, unknown>,
	) {
		super(node, cellMinWidth, view, attrs);
		this.view = view;
		const scroller = this.dom;
		const outer = document.createElement("div");
		outer.className = "lp-table";
		this.addRow = this.plusButton("lp-table-add-row", "Add row");
		this.addColumn = this.plusButton("lp-table-add-column", "Add column");
		outer.append(scroller, this.addColumn, this.addRow);
		this.dom = outer;
	}

	private plusButton(className: string, label: string) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `lp-table-add ${className}`;
		button.setAttribute("aria-label", label);
		button.title = label;
		button.innerHTML = PLUS_ICON;
		// Keeps the caret and the editor's focus until the click has done its work.
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => this.add(label));
		return button;
	}

	private add(label: string) {
		const view = this.view;
		if (!view?.editable) return;
		const table = tableAtPos(view, view.posAtDOM(this.contentDOM, 0));
		if (!table) return;
		if (label === "Add row") addRowAtEnd(view, table);
		else {
			addColumnAtEnd(view, table);
			const scroller = this.table.parentElement;
			if (scroller) scroller.scrollLeft = scroller.scrollWidth;
		}
	}

	stopEvent(event: Event) {
		const target = event.target as globalThis.Node | null;
		return Boolean(
			target &&
				(this.addRow.contains(target) || this.addColumn.contains(target)),
		);
	}
}

// Marks the cell the caret is in, so a person can see where they're typing.
const ActiveCell = Extension.create({
	name: "activeCell",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					decorations(state) {
						const { selection, doc } = state;
						if (!(selection instanceof TextSelection)) return null;
						const { $head } = selection;
						for (let depth = $head.depth; depth > 0; depth--) {
							const role = $head.node(depth).type.spec.tableRole;
							if (role === "cell" || role === "header_cell") {
								const pos = $head.before(depth);
								const cell = doc.nodeAt(pos);
								if (!cell) return null;
								return DecorationSet.create(doc, [
									Decoration.node(pos, pos + cell.nodeSize, {
										class: "lp-cell-active",
									}),
								]);
							}
						}
						return null;
					},
				},
			}),
		];
	},
});

const remoteFixKey = new PluginKey<boolean>("remoteTableFix");

// A row added while someone else added a column arrives one cell short. Every browser would repair it
// in its own way (prosemirror-tables' fixTables) and the repairs add up to a phantom column. So only
// the editor's own edits are repaired that way; for remote ragged rows, each browser writes the same
// repair to the Yjs document, with ids derived from the row, and Yjs keeps one copy of it.
const RemoteTableFix = Extension.create({
	name: "remoteTableFix",
	addProseMirrorPlugins() {
		return [
			new Plugin<boolean>({
				key: remoteFixKey,
				state: {
					init: () => false,
					apply: (tr) => Boolean(tr.getMeta(ySyncPluginKey)),
				},
				filterTransaction: (tr, state) =>
					!(tr.getMeta(fixTablesKey) && remoteFixKey.getState(state)),
			}),
		];
	},
});

const REPAIR_ORIGIN = "tableRepair";

function rowWidth(row: Y.XmlElement) {
	let width = 0;
	for (const cell of row.toArray())
		if (cell instanceof Y.XmlElement)
			width += Number(cell.getAttribute("colspan")) || 1;
	return width;
}

function repairRow(doc: Y.Doc, row: Y.XmlElement, width: number) {
	const id = row._item?.id;
	const missing = width - rowWidth(row);
	if (!id || missing <= 0) return;
	const last = row.get(row.length - 1);
	const type = last instanceof Y.XmlElement ? last.nodeName : "tableCell";
	const own = doc.clientID;
	for (let i = 0; i < missing; i++) {
		doc.clientID = clientFor(`cell:${id.client}:${id.clock}:${width}:${i}`);
		try {
			doc.transact(() => {
				const cell = new Y.XmlElement(type);
				cell.setAttribute("colspan", 1 as never);
				cell.setAttribute("rowspan", 1 as never);
				const paragraph = new Y.XmlElement("paragraph");
				paragraph.insert(0, [new Y.XmlText()]);
				cell.insert(0, [paragraph]);
				row.insert(row.length, [cell]);
			}, REPAIR_ORIGIN);
		} finally {
			doc.clientID = own;
		}
	}
}

function repairTables(doc: Y.Doc, node: Y.XmlFragment) {
	for (const child of node.toArray()) {
		if (!(child instanceof Y.XmlElement)) continue;
		if (child.nodeName !== "table") {
			repairTables(doc, child);
			continue;
		}
		const rows = child
			.toArray()
			.filter(
				(row): row is Y.XmlElement =>
					row instanceof Y.XmlElement && row.nodeName === "tableRow",
			);
		const width = Math.max(0, ...rows.map(rowWidth));
		for (const row of rows) repairRow(doc, row, width);
	}
}

export function tableRepair(doc: Y.Doc) {
	let listener: ((transaction: Y.Transaction) => void) | null = null;
	return Extension.create({
		name: "tableRepair",
		onCreate() {
			const { editor } = this;
			let queued = false;
			const run = () => {
				queued = false;
				if (editor.isDestroyed || !editor.isEditable) return;
				repairTables(doc, doc.getXmlFragment(BODY_FIELD));
			};
			listener = (transaction) => {
				if (
					queued ||
					transaction.origin === ySyncPluginKey ||
					transaction.origin === REPAIR_ORIGIN
				)
					return;
				queued = true;
				queueMicrotask(run);
			};
			doc.on("afterTransaction", listener);
			listener({ origin: null } as Y.Transaction);
		},
		onDestroy() {
			if (listener) doc.off("afterTransaction", listener);
		},
	});
}

export const tableExtensions = [
	TableKit.configure({
		table: {
			resizable: true,
			cellMinWidth: CELL_MIN_WIDTH,
			lastColumnResizable: true,
			View: GridView,
		},
	}),
	ActiveCell,
	RemoteTableFix,
];
