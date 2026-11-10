// The bar that takes the place of the drag handle and block menu on touch screens (board 93).

import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { TrashIcon } from "#/components/icons";
import { Popover, useToast } from "#/components/ui";
import { copyText } from "#/lib/browser";
import { blockAt, duplicateBlock } from "./BlockControls";
import {
	CommentIcon,
	CopyIcon,
	LinkIcon,
	MoveIcon,
	Sparkle,
} from "./menu-icons";
import { moveBlockBy } from "./move-block";
import { TURN_ITEMS, turnBlock } from "./turn-into";

// How far the on-screen keyboard pushes up the fixed bars on this page.
function useKeyboardOffset() {
	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const root = document.documentElement;
		const apply = () => {
			const covered = window.innerHeight - viewport.height - viewport.offsetTop;
			root.style.setProperty(
				"--lp-kb",
				`${Math.max(0, Math.round(covered))}px`,
			);
		};
		apply();
		viewport.addEventListener("resize", apply);
		viewport.addEventListener("scroll", apply);
		return () => {
			viewport.removeEventListener("resize", apply);
			viewport.removeEventListener("scroll", apply);
			root.style.removeProperty("--lp-kb");
		};
	}, []);
}

function BarButton({
	label,
	onClick,
	children,
	className = "",
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			// Keeps the caret and the keyboard where they are.
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className={`flex h-11 min-w-10 shrink-0 items-center justify-center rounded-lg px-2 text-[15px] font-medium text-white/90 active:bg-white/15 ${className}`}
		>
			{children}
		</button>
	);
}

export function MobileBar({
	editor,
	canEdit,
	canComment,
	pageUrl,
	onComment,
	onComments,
}: {
	editor: Editor;
	canEdit: boolean;
	canComment: boolean;
	pageUrl: string;
	onComment: (from: number, to: number) => void;
	onComments: () => void;
}) {
	useKeyboardOffset();
	const anchor = useRef<HTMLSpanElement>(null);
	const [sheet, setSheet] = useState(false);
	const toast = useToast();

	if (!canEdit && !canComment) return null;

	// Slash and mention menus open only after a space or at the start of a block.
	const insertTrigger = (char: "/" | "@") => {
		const { from, empty } = editor.state.selection;
		const before = empty
			? editor.state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n")
			: "";
		editor
			.chain()
			.focus()
			.insertContent(`${before && !/\s/.test(before) ? " " : ""}${char}`)
			.run();
	};

	const current = () => blockAt(editor, editor.state.selection.from);

	const withBlock = (fn: (pos: number, node: PmNode) => void) => {
		const found = current();
		setSheet(false);
		if (found?.node) fn(found.pos, found.node);
	};

	const move = (to: "up" | "down") =>
		withBlock((pos) => moveBlockBy(editor, pos, to));

	const hasSelection = () => !editor.state.selection.empty;

	const openAi = () =>
		window.dispatchEvent(
			new CustomEvent("livepage:ai", {
				detail: { action: hasSelection() ? "selection" : "write" },
			}),
		);

	const row =
		"flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-ink active:bg-wash-2";

	return (
		<>
			{/* Sits above the keyboard, in the safe area. */}
			<div
				role="toolbar"
				aria-label="Editing tools"
				className="fixed inset-x-3 z-[45] lg:hidden"
				style={{
					bottom:
						"calc(12px + env(safe-area-inset-bottom) + var(--lp-kb, 0px))",
				}}
			>
				<div className="flex items-center gap-0.5 rounded-[14px] bg-toolbar p-1 shadow-pop">
					{canEdit && (
						<>
							<BarButton label="Block options" onClick={() => setSheet(true)}>
								<span ref={anchor}>Aa</span>
							</BarButton>
							<BarButton
								label="Insert a block"
								onClick={() => insertTrigger("/")}
							>
								/
							</BarButton>
							<BarButton
								label="Mention someone or link a page"
								onClick={() => insertTrigger("@")}
							>
								@
							</BarButton>
							<BarButton
								label="To-do"
								onClick={() => editor.chain().focus().toggleTaskList().run()}
							>
								<svg
									width="18"
									height="18"
									viewBox="0 0 18 18"
									fill="none"
									aria-hidden="true"
								>
									<rect
										x="2.5"
										y="2.5"
										width="13"
										height="13"
										rx="2.5"
										stroke="currentColor"
										strokeWidth="1.5"
									/>
									<path
										d="M5.5 9.2l2.4 2.4 4.6-5"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</BarButton>
						</>
					)}
					<BarButton
						label="Comment"
						className="px-3"
						onClick={() => {
							const { from, to, empty } = editor.state.selection;
							if (empty) onComments();
							else onComment(from, to);
						}}
					>
						Comment
					</BarButton>
					{canEdit && (
						<button
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={openAi}
							className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[15px] font-medium text-white active:opacity-85"
						>
							<Sparkle size={13} />
							Ask AI
						</button>
					)}
				</div>
			</div>
			<Popover anchor={anchor} open={sheet} onClose={() => setSheet(false)}>
				<div className="px-1 pb-2 text-xs font-medium text-pencil">
					Turn into
				</div>
				<div className="grid grid-cols-5 gap-1.5 px-1 pb-2">
					{TURN_ITEMS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() =>
								withBlock((pos) => turnBlock(editor, pos, item.id))
							}
							className="flex h-11 items-center justify-center rounded-lg bg-wash text-sm text-ink active:bg-wash-2"
						>
							{item.short}
						</button>
					))}
				</div>
				<hr className="my-1 border-0 border-t border-rule" />
				<button type="button" className={row} onClick={() => move("up")}>
					<MoveIcon /> Move up
				</button>
				<button type="button" className={row} onClick={() => move("down")}>
					<MoveIcon /> Move down
				</button>
				<button
					type="button"
					className={row}
					onClick={() => withBlock((pos) => duplicateBlock(editor, pos))}
				>
					<CopyIcon /> Duplicate
				</button>
				<button
					type="button"
					className={row}
					onClick={() =>
						withBlock((pos, node) =>
							onComment(pos + 1, pos + node.nodeSize - 1),
						)
					}
				>
					<CommentIcon /> Comment
				</button>
				<button
					type="button"
					className={row}
					onClick={() =>
						withBlock((pos, node) => {
							const id =
								(node.attrs.anchor as string | null) ??
								`b-${Math.random().toString(36).slice(2, 10)}`;
							if (!node.attrs.anchor)
								editor.view.dispatch(
									editor.state.tr.setNodeAttribute(pos, "anchor", id),
								);
							void copyText(`${pageUrl}#${id}`).then(() =>
								toast.show("Link copied"),
							);
						})
					}
				>
					<LinkIcon /> Copy link
				</button>
				<button
					type="button"
					className={`${row} text-coral`}
					onClick={() =>
						withBlock((pos, node) =>
							editor.view.dispatch(
								editor.state.tr.delete(pos, pos + node.nodeSize),
							),
						)
					}
				>
					<TrashIcon size={14} /> Delete
				</button>
			</Popover>
		</>
	);
}
