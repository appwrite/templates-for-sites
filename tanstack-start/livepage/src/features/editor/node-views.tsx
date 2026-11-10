import { Link } from "@tanstack/react-router";
import {
	NodeViewContent,
	NodeViewWrapper,
	type ReactNodeViewProps,
} from "@tiptap/react";
import { useRef, useState } from "react";
import { PageIcon, TableIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Popover } from "#/components/ui";
import { displayName } from "#/lib/permissions";

export const fileUrl = (fileId: string) => `/api/files/${fileId}`;

export function formatBytes(bytes: number) {
	if (!bytes) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageView({
	node,
	selected,
	editor,
	getPos,
	updateAttributes,
}: ReactNodeViewProps) {
	const fileId = node.attrs.fileId as string | null;
	const width = node.attrs.width as number | null;
	const startX = useRef(0);
	const startWidth = useRef(0);
	const imgRef = useRef<HTMLImageElement>(null);

	const onResizeStart = (e: React.PointerEvent) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		startX.current = e.clientX;
		startWidth.current = imgRef.current?.getBoundingClientRect().width ?? 0;
	};
	const onResizeMove = (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId) || !imgRef.current)
			return;
		const next = Math.max(
			120,
			Math.round(startWidth.current + e.clientX - startX.current),
		);
		imgRef.current.style.width = `${next}px`;
	};
	const onResizeEnd = (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		e.currentTarget.releasePointerCapture(e.pointerId);
		const next = Math.round(imgRef.current?.getBoundingClientRect().width ?? 0);
		if (next) updateAttributes({ width: next });
	};

	return (
		<NodeViewWrapper
			as="figure"
			className={`lp-image ${selected ? "is-selected" : ""}`}
			data-drag-handle
		>
			{fileId ? (
				<div className="lp-image-frame" style={{ width: width ?? undefined }}>
					<img
						ref={imgRef}
						src={fileUrl(fileId)}
						alt={(node.attrs.alt as string) || ""}
						style={{ width: width ?? undefined }}
						draggable={false}
					/>
					{editor.isEditable && (
						<>
							<div className="lp-image-tools" contentEditable={false}>
								<button
									type="button"
									onClick={() => {
										const pos = getPos();
										if (typeof pos !== "number") return;
										window.dispatchEvent(
											new CustomEvent("livepage:ai", {
												detail: { action: "image-edit", fileId, pos },
											}),
										);
									}}
								>
									Edit with AI
								</button>
							</div>
							<div
								role="slider"
								aria-label="Resize image"
								aria-valuenow={width ?? 0}
								tabIndex={0}
								className="lp-image-resize"
								onPointerDown={onResizeStart}
								onPointerMove={onResizeMove}
								onPointerUp={onResizeEnd}
							/>
						</>
					)}
				</div>
			) : (
				<div className="lp-image-missing">Image not available</div>
			)}
		</NodeViewWrapper>
	);
}

export function AttachmentView({ node }: ReactNodeViewProps) {
	const { fileId, name, size } = node.attrs as {
		fileId: string;
		name: string;
		size: number;
	};
	return (
		<NodeViewWrapper className="lp-attachment" contentEditable={false}>
			<a href={`/api/files/${fileId}?download=1`}>
				<PageIcon size={16} />
				<span className="truncate">{name || "File"}</span>
				<span className="text-pencil">{formatBytes(size)}</span>
			</a>
		</NodeViewWrapper>
	);
}

export function PageLinkView({ node }: ReactNodeViewProps) {
	const { pageId, title } = node.attrs as { pageId: string; title: string };
	const { pages } = useWorkspace();
	const page = pages.find((p) => p.id === pageId);
	return (
		<NodeViewWrapper className="lp-page-link" contentEditable={false}>
			<Link to="/p/$pageId" params={{ pageId }}>
				<PageIcon size={16} />
				<span className="truncate">
					{page ? displayName(page) : title || "Page"}
				</span>
			</Link>
		</NodeViewWrapper>
	);
}

export function DatabaseEmbedView({ node }: ReactNodeViewProps) {
	const { databaseId, title } = node.attrs as {
		databaseId: string;
		title: string;
	};
	const { pages } = useWorkspace();
	const page = pages.find((p) => p.id === databaseId);
	return (
		<NodeViewWrapper className="lp-page-link" contentEditable={false}>
			<Link to="/p/$pageId" params={{ pageId: databaseId }}>
				<TableIcon size={16} />
				<span className="truncate">
					{page ? displayName(page) : title || "Database"}
				</span>
			</Link>
		</NodeViewWrapper>
	);
}

// The languages highlight.js ships in its common set, by the name shown in the picker.
const LANGUAGES: [string, string][] = [
	["plaintext", "Plain text"],
	["bash", "Bash"],
	["c", "C"],
	["cpp", "C++"],
	["csharp", "C#"],
	["css", "CSS"],
	["diff", "Diff"],
	["go", "Go"],
	["graphql", "GraphQL"],
	["ini", "INI"],
	["java", "Java"],
	["javascript", "JavaScript"],
	["json", "JSON"],
	["kotlin", "Kotlin"],
	["less", "Less"],
	["lua", "Lua"],
	["makefile", "Makefile"],
	["markdown", "Markdown"],
	["objectivec", "Objective-C"],
	["perl", "Perl"],
	["php", "PHP"],
	["python", "Python"],
	["r", "R"],
	["ruby", "Ruby"],
	["rust", "Rust"],
	["scss", "SCSS"],
	["shell", "Shell"],
	["sql", "SQL"],
	["swift", "Swift"],
	["typescript", "TypeScript"],
	["xml", "HTML"],
	["yaml", "YAML"],
];

export function CodeBlockView({
	node,
	editor,
	updateAttributes,
}: ReactNodeViewProps) {
	const language = (node.attrs.language as string | null) ?? "plaintext";
	const label = LANGUAGES.find(([id]) => id === language)?.[1] ?? language;
	return (
		<NodeViewWrapper
			as="pre"
			className="lp-code"
			spellCheck={false}
			style={{ whiteSpace: "pre" }}
		>
			{editor.isEditable ? (
				<select
					contentEditable={false}
					aria-label="Code language"
					className="lp-code-language"
					value={language}
					onChange={(e) => updateAttributes({ language: e.target.value })}
				>
					{LANGUAGES.map(([id, name]) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			) : (
				<span className="lp-code-language" contentEditable={false}>
					{label}
				</span>
			)}
			{/* @ts-expect-error tiptap's NodeViewContent accepts a tag in `as` */}
			<NodeViewContent as="code" className={`language-${language}`} />
		</NodeViewWrapper>
	);
}

export const EMOJI = [
	"📄",
	"📝",
	"📌",
	"📎",
	"📊",
	"📈",
	"📅",
	"🗓️",
	"🧭",
	"🚀",
	"💡",
	"🔥",
	"⭐",
	"✅",
	"❗",
	"❓",
	"🎯",
	"🛠️",
	"⚙️",
	"🔒",
	"🧪",
	"🐞",
	"🌱",
	"🌿",
	"🌍",
	"🗺️",
	"🏁",
	"🎉",
	"🧠",
	"💬",
	"📣",
	"📦",
	"🔍",
	"🧩",
	"🖼️",
	"🎨",
	"💼",
	"💰",
	"🕒",
	"👥",
];

export function CalloutView({
	node,
	editor,
	updateAttributes,
}: ReactNodeViewProps) {
	const anchor = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const emoji = (node.attrs.emoji as string) || "💡";
	// Back to the text, so typing carries on where it left off.
	const close = () => {
		setOpen(false);
		editor.commands.focus();
	};
	return (
		<NodeViewWrapper className="lp-callout" data-callout="">
			{editor.isEditable ? (
				<button
					ref={anchor}
					type="button"
					contentEditable={false}
					aria-label="Change callout icon"
					className="lp-callout-icon"
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => setOpen(true)}
				>
					{emoji}
				</button>
			) : (
				<span className="lp-callout-icon" contentEditable={false}>
					{emoji}
				</span>
			)}
			<NodeViewContent as="div" className="lp-callout-body" />
			<Popover anchor={anchor} open={open} onClose={close} className="p-2">
				<div className="grid w-[272px] grid-cols-8 gap-0.5 max-md:w-full">
					{EMOJI.map((e) => (
						<button
							key={e}
							type="button"
							onClick={() => {
								updateAttributes({ emoji: e });
								close();
							}}
							className="h-8 w-8 rounded-md text-[20px] hover:bg-wash-2 coarse:size-10"
						>
							{e}
						</button>
					))}
				</div>
			</Popover>
		</NodeViewWrapper>
	);
}
