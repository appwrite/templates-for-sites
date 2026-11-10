// The row and column handles of a table: a small grip on the row and the column under the pointer, or
// under the caret on touch screens, each opening a menu for that row or column.
import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { TrashIcon } from "#/components/icons";
import { Menu, type MenuItem } from "#/components/ui";
import {
	type CellRef,
	cellRef,
	deleteTableColumn,
	deleteTableRow,
	deleteWholeTable,
	hasHeaderRow,
	insertColumn,
	insertRow,
	toggleHeaderRow,
} from "./table";

type MenuKind = "row" | "column";

function activeCell(editor: Editor): HTMLElement | null {
	// Not gated on focus: tapping a handle blurs the editor, and the handle has to survive that tap.
	return editor.view.dom.querySelector<HTMLElement>(
		"td.lp-cell-active, th.lp-cell-active",
	);
}

export function TableTools({
	editor,
	canEdit,
	surfaceRef,
}: {
	editor: Editor;
	canEdit: boolean;
	surfaceRef: React.RefObject<HTMLDivElement | null>;
}) {
	const [hovered, setHovered] = useState<HTMLElement | null>(null);
	const [menu, setMenu] = useState<MenuKind | null>(null);
	const [ref, setRef] = useState<CellRef | null>(null);
	const [menuCell, setMenuCell] = useState<HTMLElement | null>(null);
	const [, tick] = useState(0);
	const menuOpen = useRef(false);
	menuOpen.current = menu !== null;
	const rowHandle = useRef<HTMLButtonElement>(null);
	const columnHandle = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface || !canEdit) return;
		const onMove = (event: MouseEvent) => {
			if (menuOpen.current) return;
			const target = event.target as HTMLElement;
			if (target.closest?.("[data-table-handle]")) return;
			setHovered(
				target.closest?.(".lp-editor td, .lp-editor th") as HTMLElement | null,
			);
		};
		const onLeave = () => {
			if (!menuOpen.current) setHovered(null);
		};
		surface.addEventListener("mousemove", onMove);
		surface.addEventListener("mouseleave", onLeave);
		return () => {
			surface.removeEventListener("mousemove", onMove);
			surface.removeEventListener("mouseleave", onLeave);
		};
	}, [surfaceRef, canEdit]);

	// Positions follow typing, growing rows, scrolling and window size.
	useEffect(() => {
		const update = () => tick((n) => n + 1);
		editor.on("transaction", update);
		editor.on("focus", update);
		editor.on("blur", update);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			editor.off("transaction", update);
			editor.off("focus", update);
			editor.off("blur", update);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [editor]);

	if (!canEdit) return null;
	const touch = window.matchMedia("(hover: none)").matches;
	const pointed = touch
		? activeCell(editor)
		: hovered?.isConnected
			? hovered
			: null;
	const cell = menuCell?.isConnected ? menuCell : pointed;
	const surface = surfaceRef.current;
	const table = cell?.closest("table");
	const scroller = table?.parentElement;
	if (!cell || !table || !scroller || !surface) {
		return null;
	}

	const bounds = surface.getBoundingClientRect();
	const cellRect = cell.getBoundingClientRect();
	const tableRect = table.getBoundingClientRect();
	const scrollerRect = scroller.getBoundingClientRect();
	const centerX = Math.max(
		scrollerRect.left + 12,
		Math.min(cellRect.left + cellRect.width / 2, scrollerRect.right - 12),
	);
	const left = Math.max(tableRect.left, scrollerRect.left);

	const open = (kind: MenuKind) => {
		const found = cellRef(editor.view, cell);
		if (!found) return;
		setRef(found);
		setMenuCell(cell);
		setMenu(kind);
	};
	const close = () => {
		setMenu(null);
		setMenuCell(null);
		setHovered(null);
	};
	const run = (action: (ref: CellRef) => void) => () => {
		if (ref) action(ref);
	};

	const shared = (found: CellRef | null): MenuItem[] => [
		{ type: "separator", id: "sep" },
		{
			id: "header",
			label: "Header row",
			hint: found && hasHeaderRow(found) ? "On" : undefined,
			onSelect: run((r) => toggleHeaderRow(editor.view, r)),
		},
		{
			id: "delete-table",
			label: "Delete table",
			danger: true,
			icon: <TrashIcon size={14} />,
			onSelect: run((r) => deleteWholeTable(editor.view, r)),
		},
	];
	const rowItems: MenuItem[] = [
		{
			id: "above",
			label: "Insert row above",
			onSelect: run((r) => insertRow(editor.view, r, "above")),
		},
		{
			id: "below",
			label: "Insert row below",
			onSelect: run((r) => insertRow(editor.view, r, "below")),
		},
		{
			id: "delete-row",
			label: "Delete row",
			disabled: (ref?.map.height ?? 2) <= 1,
			onSelect: run((r) => deleteTableRow(editor.view, r)),
		},
		...shared(ref),
	];
	const columnItems: MenuItem[] = [
		{
			id: "left",
			label: "Insert column left",
			onSelect: run((r) => insertColumn(editor.view, r, "left")),
		},
		{
			id: "right",
			label: "Insert column right",
			onSelect: run((r) => insertColumn(editor.view, r, "right")),
		},
		{
			id: "delete-column",
			label: "Delete column",
			disabled: (ref?.map.width ?? 2) <= 1,
			onSelect: run((r) => deleteTableColumn(editor.view, r)),
		},
		...shared(ref),
	];

	return (
		<>
			<button
				ref={rowHandle}
				type="button"
				data-table-handle="row"
				aria-label="Row options"
				title="Row options"
				className="lp-table-handle lp-table-handle-row"
				style={{
					left: left - bounds.left,
					top: cellRect.top + cellRect.height / 2 - bounds.top,
				}}
				onMouseDown={(e) => e.preventDefault()}
				onClick={() => open("row")}
			>
				<GripDots vertical />
			</button>
			<button
				ref={columnHandle}
				type="button"
				data-table-handle="column"
				aria-label="Column options"
				title="Column options"
				className="lp-table-handle lp-table-handle-column"
				style={{
					left: centerX - bounds.left,
					top: tableRect.top - bounds.top,
				}}
				onMouseDown={(e) => e.preventDefault()}
				onClick={() => open("column")}
			>
				<GripDots />
			</button>
			<Menu
				anchor={rowHandle}
				open={menu === "row"}
				onClose={close}
				items={rowItems}
				side="right"
				width={200}
			/>
			<Menu
				anchor={columnHandle}
				open={menu === "column"}
				onClose={close}
				items={columnItems}
				width={200}
			/>
		</>
	);
}

function GripDots({ vertical }: { vertical?: boolean }) {
	const dots = [2, 7, 12];
	return (
		<svg
			width={vertical ? 4 : 14}
			height={vertical ? 14 : 4}
			viewBox={vertical ? "0 0 4 14" : "0 0 14 4"}
			fill="currentColor"
			aria-hidden="true"
		>
			{dots.map((d) => (
				<circle key={d} cx={vertical ? 2 : d} cy={vertical ? d : 2} r="1.3" />
			))}
		</svg>
	);
}
