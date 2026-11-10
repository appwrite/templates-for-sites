// The drag handle beside each block and its menu (board 77).

import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, TrashIcon } from "#/components/icons";
import { Menu, type MenuItem, useToast } from "#/components/ui";
import { copyText } from "#/lib/browser";
import {
	CommentIcon,
	CopyIcon,
	LinkIcon,
	MoveIcon,
	Sparkle,
	TurnIcon,
} from "./menu-icons";
import { moveBlockBy } from "./move-block";
import { canTurn, TURN_ITEMS, turnBlock } from "./turn-into";

type Block = { pos: number; node: PmNode; top: number; height: number };

export function blockAt(editor: Editor, selectionFrom: number) {
	const $pos = editor.state.doc.resolve(selectionFrom);
	if ($pos.depth < 1) return null;
	const pos = $pos.before(1);
	return { pos, node: editor.state.doc.nodeAt(pos) as PmNode };
}

export function duplicateBlock(editor: Editor, pos: number) {
	const node = editor.state.doc.nodeAt(pos);
	if (!node) return;
	editor.view.dispatch(
		editor.state.tr.insert(pos + node.nodeSize, node.copy(node.content)),
	);
}

export function BlockControls({
	editor,
	containerRef,
	surfaceRef,
	onComment,
	pageUrl,
}: {
	editor: Editor;
	containerRef: React.RefObject<HTMLDivElement | null>;
	surfaceRef: React.RefObject<HTMLDivElement | null>;
	onComment: (from: number, to: number) => void;
	pageUrl: string;
}) {
	const toast = useToast();
	const [block, setBlock] = useState<Block | null>(null);
	const blockRef = useRef<Block | null>(null);
	blockRef.current = block;
	const [menu, setMenu] = useState<"main" | "turn" | "move" | null>(null);
	const menuOpen = useRef(false);
	menuOpen.current = menu !== null;
	const handleRef = useRef<HTMLButtonElement>(null);

	const blockFromCoords = useCallback(
		(x: number, y: number) => {
			const view = editor.view;
			const found = view.posAtCoords({ left: x, top: y });
			if (!found) return null;
			const $pos = view.state.doc.resolve(found.pos);
			if ($pos.depth === 0) {
				const after = view.state.doc.nodeAt(found.pos);
				return after ? { pos: found.pos, node: after } : null;
			}
			const pos = $pos.before(1);
			const node = view.state.doc.nodeAt(pos);
			return node ? { pos, node } : null;
		},
		[editor],
	);

	const update = useCallback(
		(_x: number, y: number) => {
			if (menuOpen.current || !editor.isEditable) return;
			const surface = surfaceRef.current;
			if (!surface) return;
			const bounds = surface.getBoundingClientRect();
			const found = blockFromCoords(bounds.left + 12, y);
			if (!found) {
				setBlock(null);
				return;
			}
			const dom = editor.view.nodeDOM(found.pos) as HTMLElement | null;
			if (!dom?.getBoundingClientRect) return;
			const rect = dom.getBoundingClientRect();
			setBlock({
				pos: found.pos,
				node: found.node,
				top: rect.top - bounds.top,
				height: rect.height,
			});
		},
		[editor, surfaceRef, blockFromCoords],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onMove = (e: MouseEvent) => update(e.clientX, e.clientY);
		const onLeave = () => {
			if (!menuOpen.current) setBlock(null);
		};
		container.addEventListener("mousemove", onMove);
		container.addEventListener("mouseleave", onLeave);
		return () => {
			container.removeEventListener("mousemove", onMove);
			container.removeEventListener("mouseleave", onLeave);
		};
	}, [update, containerRef]);

	const close = useCallback(() => setMenu(null), []);

	const withBlock = (fn: (b: Block) => void) => {
		const current = blockRef.current;
		if (!current) return;
		fn(current);
		close();
	};

	const moveBlock = (to: "up" | "down" | "top" | "bottom") =>
		withBlock((b) => moveBlockBy(editor, b.pos, to));

	const turnItems: MenuItem[] = TURN_ITEMS.map((item) => ({
		id: item.id,
		label: item.label,
		onSelect: () => withBlock((b) => turnBlock(editor, b.pos, item.id)),
	}));

	const topLevel = (() => {
		const { doc } = editor.state;
		// The hovered block can be stale: someone may have just shortened the page.
		if (!block || block.pos > doc.content.size)
			return { isFirst: false, isLast: false };
		const index = doc.resolve(block.pos).index(0);
		return { isFirst: index === 0, isLast: index >= doc.childCount - 1 };
	})();
	// Images, files, page links and dividers have no text to turn, comment on or send to AI.
	const hasText = block
		? !block.node.isAtom && block.node.textContent.length > 0
		: false;

	const moveItems: MenuItem[] = [
		{
			id: "up",
			label: "Move up",
			disabled: topLevel.isFirst,
			onSelect: () => moveBlock("up"),
		},
		{
			id: "down",
			label: "Move down",
			disabled: topLevel.isLast,
			onSelect: () => moveBlock("down"),
		},
		{
			id: "top",
			label: "Move to top",
			disabled: topLevel.isFirst,
			onSelect: () => moveBlock("top"),
		},
		{
			id: "bottom",
			label: "Move to bottom",
			disabled: topLevel.isLast,
			onSelect: () => moveBlock("bottom"),
		},
	];

	const chevron = <ChevronRight size={12} />;
	const mainItems: MenuItem[] = [
		...(block && canTurn(block.node)
			? ([
					{
						id: "turn",
						label: "Turn into",
						icon: <TurnIcon />,
						hint: chevron,
						onSelect: () => setMenu("turn"),
					},
				] satisfies MenuItem[])
			: []),
		{
			id: "dup",
			label: "Duplicate",
			icon: <CopyIcon />,
			hint: "⌘D",
			onSelect: () => withBlock((b) => duplicateBlock(editor, b.pos)),
		},
		{
			id: "move",
			label: "Move to",
			icon: <MoveIcon />,
			hint: chevron,
			onSelect: () => setMenu("move"),
		},
		...(hasText
			? ([
					{
						id: "comment",
						label: "Comment",
						icon: <CommentIcon />,
						hint: "⌘⇧M",
						onSelect: () =>
							withBlock((b) =>
								onComment(b.pos + 1, b.pos + b.node.nodeSize - 1),
							),
					},
				] satisfies MenuItem[])
			: []),
		{
			id: "link",
			label: "Copy link",
			icon: <LinkIcon />,
			onSelect: () =>
				withBlock((b) => {
					const anchor =
						(b.node.attrs.anchor as string | null) ??
						`b-${Math.random().toString(36).slice(2, 10)}`;
					if (!b.node.attrs.anchor)
						editor.view.dispatch(
							editor.state.tr.setNodeAttribute(b.pos, "anchor", anchor),
						);
					void copyText(`${pageUrl}#${anchor}`).then(() =>
						toast.show("Link copied"),
					);
				}),
		},
		...(hasText
			? ([
					{
						id: "ai",
						label: "Ask AI",
						icon: (
							<span className="text-link">
								<Sparkle />
							</span>
						),
						onSelect: () =>
							withBlock((b) => {
								const { doc, tr } = editor.state;
								tr.setSelection(
									TextSelection.between(
										doc.resolve(b.pos + 1),
										doc.resolve(b.pos + b.node.nodeSize - 1),
									),
								);
								editor.view.dispatch(tr);
								editor.commands.focus();
								window.dispatchEvent(
									new CustomEvent("livepage:ai", {
										detail: { action: "selection" },
									}),
								);
							}),
					},
				] satisfies MenuItem[])
			: []),
		{ type: "separator", id: "sep" },
		{
			id: "del",
			label: "Delete",
			icon: <TrashIcon size={14} />,
			danger: true,
			onSelect: () =>
				withBlock((b) => {
					editor.view.dispatch(
						editor.state.tr.delete(b.pos, b.pos + b.node.nodeSize),
					);
				}),
		},
	];

	const onDragStart = (e: React.DragEvent) => {
		const current = blockRef.current;
		if (!current) return;
		const view = editor.view;
		const selection = NodeSelection.create(view.state.doc, current.pos);
		view.dispatch(view.state.tr.setSelection(selection));
		const slice = selection.content();
		const dom = view.nodeDOM(current.pos) as HTMLElement | null;
		e.dataTransfer.effectAllowed = "copyMove";
		e.dataTransfer.setData("text/plain", current.node.textContent);
		if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
		(view as unknown as { dragging: unknown }).dragging = {
			slice,
			move: true,
			node: selection,
		};
	};

	// Keep the row highlighted while its menu is open, as on the board.
	useEffect(() => {
		if (!block || !menu) return;
		const dom = editor.view.nodeDOM(block.pos) as HTMLElement | null;
		dom?.classList.add("lp-block-active");
		return () => dom?.classList.remove("lp-block-active");
	}, [menu, block, editor]);

	if (!block || !editor.isEditable) return null;
	return (
		<>
			<button
				ref={handleRef}
				type="button"
				draggable
				onDragStart={onDragStart}
				onClick={() => setMenu(menu ? null : "main")}
				aria-label="Block menu. Drag to move."
				className="lp-drag-handle"
				style={{ top: block.top + 2 }}
			>
				<svg
					width="10"
					height="14"
					viewBox="0 0 10 14"
					fill="currentColor"
					aria-hidden="true"
				>
					<circle cx="2" cy="2" r="1.3" />
					<circle cx="8" cy="2" r="1.3" />
					<circle cx="2" cy="7" r="1.3" />
					<circle cx="8" cy="7" r="1.3" />
					<circle cx="2" cy="12" r="1.3" />
					<circle cx="8" cy="12" r="1.3" />
				</svg>
			</button>
			<Menu
				anchor={handleRef}
				open={menu === "main"}
				onClose={close}
				items={mainItems}
				width={236}
			/>
			<Menu
				anchor={handleRef}
				open={menu === "turn"}
				onClose={close}
				items={turnItems}
				side="right"
				width={200}
			/>
			<Menu
				anchor={handleRef}
				open={menu === "move"}
				onClose={close}
				items={moveItems}
				side="right"
				width={200}
			/>
		</>
	);
}

export { TextSelection };
