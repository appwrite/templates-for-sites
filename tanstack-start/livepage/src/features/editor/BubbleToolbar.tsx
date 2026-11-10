import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEffect, useMemo, useRef, useState } from "react";
import { safeHref } from "#/lib/links";
import { Sparkle } from "./menu-icons";

function Tool({
	active,
	label,
	onClick,
	children,
}: {
	active?: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={active}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm coarse:h-10 coarse:min-w-10 ${active ? "bg-white/20 text-white" : "text-white/85 hover:bg-white/10 hover:text-white"}`}
		>
			{children}
		</button>
	);
}

export function BubbleToolbar({
	editor,
	onComment,
	canComment,
	canEdit,
}: {
	editor: Editor;
	onComment: () => void;
	canComment: boolean;
	canEdit: boolean;
}) {
	const touch = useMemo(
		() => window.matchMedia("(pointer: coarse)").matches,
		[],
	);
	const [linking, setLinking] = useState(false);
	const [url, setUrl] = useState("");
	const [linkError, setLinkError] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (linking) inputRef.current?.focus();
	}, [linking]);

	const closeLink = () => {
		setLinking(false);
		setLinkError(false);
		editor.commands.focus();
	};

	const removeLink = () => {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		closeLink();
	};

	const applyLink = () => {
		const value = url.trim();
		if (!value) {
			removeLink();
			return;
		}
		const href = /^[a-z][a-z0-9+.-]*:/i.test(value)
			? value
			: `https://${value}`;
		if (!safeHref(href)) {
			setLinkError(true);
			return;
		}
		// The caret moves past the link, so the next thing typed doesn't replace it.
		const { to } = editor.state.selection;
		editor
			.chain()
			.focus()
			.extendMarkRange("link")
			.setLink({ href })
			.setTextSelection(to)
			.run();
		closeLink();
	};

	return (
		<BubbleMenu
			editor={editor}
			className="z-40"
			options={{
				// Below the selection on touch, so it clears the phone's own text menu.
				placement: touch ? "bottom" : "top",
				offset: 8,
			}}
			shouldShow={({ editor: e, state }) => {
				if (e.isActive("codeBlock")) return false;
				if (state.selection instanceof NodeSelection) return false;
				const { from, to } = state.selection;
				return (
					(e.isEditable || canComment) && from !== to && !state.selection.empty
				);
			}}
		>
			<div className="lp-bubble flex items-center gap-0.5 rounded-lg bg-toolbar p-1 text-white shadow-pop">
				{linking ? (
					<form
						className="flex items-center gap-1 px-1"
						onSubmit={(e) => {
							e.preventDefault();
							applyLink();
						}}
					>
						<input
							ref={inputRef}
							value={url}
							onChange={(e) => {
								setUrl(e.target.value);
								setLinkError(false);
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") closeLink();
							}}
							placeholder="Paste a link"
							aria-label="Link address"
							className="h-7 w-60 max-w-[58vw] bg-transparent text-sm text-white outline-none placeholder:text-white/60 coarse:h-10"
						/>
						{linkError && (
							<span className="text-xs whitespace-nowrap text-coral">
								Not a valid link
							</span>
						)}
						{editor.isActive("link") && (
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={removeLink}
								className="h-7 px-1.5 text-sm text-white/70 hover:text-white coarse:h-10"
							>
								Remove
							</button>
						)}
						<button
							type="submit"
							className="h-7 px-1.5 text-sm text-link coarse:h-10"
						>
							Done
						</button>
					</form>
				) : (
					<>
						{canEdit && !touch && (
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() =>
									window.dispatchEvent(
										new CustomEvent("livepage:ai", {
											detail: { action: "selection" },
										}),
									)
								}
								className="flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-sm font-medium text-white hover:opacity-90"
							>
								<Sparkle size={13} /> Ask AI
							</button>
						)}
						{canEdit && (
							<>
								<Tool
									label="Bold"
									active={editor.isActive("bold")}
									onClick={() => editor.chain().focus().toggleBold().run()}
								>
									<b>B</b>
								</Tool>
								<Tool
									label="Italic"
									active={editor.isActive("italic")}
									onClick={() => editor.chain().focus().toggleItalic().run()}
								>
									<i className="font-serif">I</i>
								</Tool>
								<Tool
									label="Code"
									active={editor.isActive("code")}
									onClick={() => editor.chain().focus().toggleCode().run()}
								>
									<span className="font-mono text-xs">{"<>"}</span>
								</Tool>
								<Tool
									label="Link"
									active={editor.isActive("link")}
									onClick={() => {
										setUrl(String(editor.getAttributes("link").href ?? ""));
										setLinking(true);
									}}
								>
									Link
								</Tool>
								<Tool
									label="Highlight"
									active={editor.isActive("highlight")}
									onClick={() => editor.chain().focus().toggleHighlight().run()}
								>
									<span className="rounded-sm bg-amber-soft px-1 text-ink">
										H
									</span>
								</Tool>
								<span className="mx-0.5 h-4 w-px bg-white/20" />
							</>
						)}
						{canComment && !touch && (
							<Tool label="Comment" onClick={onComment}>
								Comment
							</Tool>
						)}
					</>
				)}
			</div>
		</BubbleMenu>
	);
}
