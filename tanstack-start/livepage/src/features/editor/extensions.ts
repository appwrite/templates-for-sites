// The editor's schema and behaviour: blocks, marks, input rules and the Yjs bindings.
import {
	type Editor,
	Extension,
	InputRule,
	mergeAttributes,
	Node,
	type Range,
} from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Collaboration } from "@tiptap/extension-collaboration";
import { Document } from "@tiptap/extension-document";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Placeholder } from "@tiptap/extensions";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Suggestion } from "@tiptap/suggestion";
import { yCursorPlugin, ySyncPluginKey } from "@tiptap/y-tiptap";
import { common, createLowlight } from "lowlight";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { safeHref } from "#/lib/links";
import { BODY_FIELD, clientFor, TITLE_FIELD } from "./codec";
import {
	AttachmentView,
	CalloutView,
	CodeBlockView,
	DatabaseEmbedView,
	ImageView,
	PageLinkView,
} from "./node-views";
import { type PopupStore, popupRender } from "./popup";
import { tableExtensions, tableRepair } from "./table";

export const lowlight = createLowlight(common);

// ---------- suggestions ----------

export type SlashItem = {
	id: string;
	label: string;
	hint?: string;
	group?: string;
	keywords?: string[];
	icon: string;
	run: (editor: Editor, range: Range) => void;
};

export type MentionItem = {
	group: "People" | "Pages" | "Dates";
	kind: "person" | "page" | "date";
	id: string;
	label: string;
	detail?: string;
	here?: boolean;
};

// ---------- blocks ----------

const Callout = Node.create({
	name: "callout",
	group: "block",
	content: "inline*",
	defining: true,
	addAttributes() {
		return { emoji: { default: "💡" } };
	},
	parseHTML() {
		return [{ tag: "div[data-callout]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-callout": "",
				class: "lp-callout",
			}),
			[
				"span",
				{ class: "lp-callout-icon", contenteditable: "false" },
				node.attrs.emoji,
			],
			["div", { class: "lp-callout-body" }, 0],
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(CalloutView);
	},
	addInputRules() {
		return [
			new InputRule({
				find: /^!\s$/,
				handler: ({ state, range, chain }) => {
					const $from = state.doc.resolve(range.from);
					if (
						$from.depth > 1 &&
						$from.node($from.depth - 1).type.name === "callout"
					)
						return null;
					chain().deleteRange(range).setNode("callout").run();
				},
			}),
		];
	},
});

const ToggleTitle = Node.create({
	name: "toggleTitle",
	content: "inline*",
	defining: true,
	parseHTML() {
		return [{ tag: "div[data-toggle-title]" }];
	},
	renderHTML() {
		return ["div", { "data-toggle-title": "", class: "lp-toggle-title" }, 0];
	},
});

const ToggleBody = Node.create({
	name: "toggleBody",
	content: "block+",
	parseHTML() {
		return [{ tag: "div[data-toggle-body]" }];
	},
	renderHTML() {
		return ["div", { "data-toggle-body": "", class: "lp-toggle-body" }, 0];
	},
});

const Toggle = Node.create({
	name: "toggle",
	group: "block",
	content: "toggleTitle toggleBody",
	defining: true,
	addAttributes() {
		return { open: { default: true } };
	},
	parseHTML() {
		return [{ tag: "div[data-toggle]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-toggle": "",
				"data-open": String(node.attrs.open),
				class: "lp-toggle",
			}),
			0,
		];
	},
	addNodeView() {
		return ({ node, editor, getPos }) => {
			let current = node;
			const dom = document.createElement("div");
			dom.className = "lp-toggle";
			dom.setAttribute("data-toggle", "");
			const button = document.createElement("button");
			button.type = "button";
			button.className = "lp-toggle-chevron";
			button.setAttribute("contenteditable", "false");
			button.setAttribute("aria-label", "Open or close this toggle");
			button.innerHTML =
				'<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 7 5l-4 3.500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			button.addEventListener("mousedown", (e) => e.preventDefault());
			button.addEventListener("click", () => {
				const pos = getPos();
				if (typeof pos !== "number") return;
				editor.view.dispatch(
					editor.state.tr.setNodeAttribute(pos, "open", !current.attrs.open),
				);
			});
			const content = document.createElement("div");
			content.className = "lp-toggle-content";
			dom.append(button, content);
			const paint = (n: typeof node) =>
				dom.setAttribute("data-open", String(n.attrs.open));
			paint(node);
			return {
				dom,
				contentDOM: content,
				update(updated) {
					if (updated.type.name !== "toggle") return false;
					current = updated;
					paint(updated);
					return true;
				},
			};
		};
	},
	addKeyboardShortcuts() {
		return {
			// At the start of the title, a toggle gives way to plain text, keeping whatever was inside.
			Backspace: ({ editor }) => {
				const { $from, empty } = editor.state.selection;
				if (
					!empty ||
					$from.parent.type.name !== "toggleTitle" ||
					$from.parentOffset !== 0
				)
					return false;
				const pos = $from.before($from.depth - 1);
				const toggle = editor.state.doc.nodeAt(pos);
				if (!toggle) return false;
				const { schema, tr } = editor.state;
				const title = toggle.child(0);
				const body = toggle.child(1);
				const nodes = [schema.nodes.paragraph.create(null, title.content)];
				body.forEach((child) => {
					if (body.childCount > 1 || child.content.size > 0) nodes.push(child);
				});
				tr.replaceWith(pos, pos + toggle.nodeSize, nodes);
				tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
				editor.view.dispatch(tr);
				return true;
			},
			Enter: ({ editor }) => {
				const { $from } = editor.state.selection;
				if ($from.parent.type.name !== "toggleTitle") return false;
				const pos = $from.before($from.depth - 1);
				const toggle = editor.state.doc.nodeAt(pos);
				if (!toggle) return false;
				const start = pos + 1 + toggle.child(0).nodeSize + 2;
				const tr = editor.state.tr.setNodeAttribute(pos, "open", true);
				tr.setSelection(TextSelection.near(tr.doc.resolve(start)));
				editor.view.dispatch(tr);
				return true;
			},
		};
	},
	addInputRules() {
		return [
			new InputRule({
				find: /^>\s$/,
				handler: ({ state, range }) => {
					const $from = state.doc.resolve(range.from);
					const blockStart = $from.before();
					const blockEnd = $from.after();
					const { schema } = state;
					const toggle = schema.nodes.toggle.create(null, [
						schema.nodes.toggleTitle.create(),
						schema.nodes.toggleBody.create(
							null,
							schema.nodes.paragraph.create(),
						),
					]);
					const tr = state.tr.replaceWith(blockStart, blockEnd, toggle);
					// The caret goes into the new title.
					tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart + 2)));
				},
			}),
		];
	},
});

const QuoteRule = Extension.create({
	name: "quoteRule",
	addInputRules() {
		return [
			new InputRule({
				find: /^"\s$/,
				handler: ({ range, chain }) => {
					chain().deleteRange(range).toggleWrap("blockquote").run();
				},
			}),
		];
	},
});

export const ImageBlock = Node.create({
	name: "image",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			fileId: { default: null },
			alt: { default: "" },
			width: { default: null },
		};
	},
	parseHTML() {
		return [
			{
				tag: "img[data-file-id]",
				getAttrs: (el) => ({
					fileId: el.getAttribute("data-file-id"),
					alt: el.getAttribute("alt"),
				}),
			},
		];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"img",
			mergeAttributes(HTMLAttributes, {
				src: `/api/files/${node.attrs.fileId}`,
				"data-file-id": node.attrs.fileId,
				alt: node.attrs.alt,
			}),
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(ImageView);
	},
});

export const Attachment = Node.create({
	name: "attachment",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return {
			fileId: { default: null },
			name: { default: "" },
			size: { default: 0 },
			mimeType: { default: "" },
		};
	},
	parseHTML() {
		return [{ tag: "div[data-attachment]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"a",
			mergeAttributes(HTMLAttributes, {
				"data-attachment": "",
				href: `/api/files/${node.attrs.fileId}?download=1`,
			}),
			node.attrs.name,
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(AttachmentView);
	},
});

export const PageLink = Node.create({
	name: "pageLink",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return { pageId: { default: null }, title: { default: "" } };
	},
	parseHTML() {
		return [{ tag: "div[data-page-link]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-page-link": node.attrs.pageId,
			}),
			node.attrs.title || "Untitled",
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(PageLinkView);
	},
});

export const DatabaseEmbed = Node.create({
	name: "databaseEmbed",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return { databaseId: { default: null }, title: { default: "" } };
	},
	parseHTML() {
		return [{ tag: "div[data-database-embed]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			"div",
			mergeAttributes(HTMLAttributes, {
				"data-database-embed": node.attrs.databaseId,
			}),
			node.attrs.title || "Database",
		];
	},
	addNodeView() {
		return ReactNodeViewRenderer(DatabaseEmbedView);
	},
});

const MentionNode = Node.create({
	name: "mention",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	addAttributes() {
		return {
			kind: { default: "person" },
			id: { default: null },
			label: { default: "" },
		};
	},
	parseHTML() {
		return [{ tag: "span[data-mention]" }];
	},
	renderHTML({ node, HTMLAttributes }) {
		const prefix = node.attrs.kind === "person" ? "@" : "";
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				"data-mention": node.attrs.id,
				"data-kind": node.attrs.kind,
				class: "lp-mention",
			}),
			`${prefix}${node.attrs.label}`,
		];
	},
	renderText({ node }) {
		return `${node.attrs.kind === "person" ? "@" : ""}${node.attrs.label}`;
	},
});

// ---------- suggestion plugins ----------

const SlashExtension = Extension.create<{
	store: PopupStore<SlashItem>;
	items: (query: string) => SlashItem[];
	onAiSpace: () => void;
	onAiEmptyLine?: () => boolean;
}>({
	name: "slashMenu",
	addKeyboardShortcuts() {
		return {
			// Space on an empty paragraph opens the AI menu, as the Getting started page says it does.
			Space: ({ editor }) => {
				const { $from, empty } = editor.state.selection;
				if (
					!empty ||
					$from.parent.type.name !== "paragraph" ||
					$from.parent.content.size !== 0 ||
					$from.depth !== 1
				)
					return false;
				return this.options.onAiEmptyLine?.() ?? false;
			},
		};
	},
	addProseMirrorPlugins() {
		return [
			Suggestion<SlashItem, SlashItem>({
				editor: this.editor,
				char: "/",
				allowedPrefixes: null,
				// "/Heading 1" has a space in it. Past the point where nothing matches, it's just a sentence.
				allowSpaces: true,
				allow: ({ state, range }) => {
					const query = state.doc.textBetween(range.from + 1, range.to);
					return !query.includes(" ") || this.options.items(query).length > 0;
				},
				pluginKey: new PluginKey("slashMenu"),
				items: ({ query }) => this.options.items(query),
				command: ({ editor, range, props }) => props.run(editor, range),
				render: popupRender(this.options.store, () => {
					if (this.options.store.getSnapshot().query) return false;
					this.options.onAiSpace();
					return true;
				}),
			}),
		];
	},
});

const MentionExtension = Extension.create<{
	char: string;
	store: PopupStore<MentionItem>;
	items: (query: string, char: string) => MentionItem[];
	onPick: (item: MentionItem) => void;
	insert?: (editor: Editor, range: Range, item: MentionItem) => boolean;
	onDismiss?: (editor: Editor, range: Range) => void;
	pluginKeyName: string;
}>({
	name: "mentionPicker",
	addProseMirrorPlugins() {
		const { char, items, store, onPick, insert, onDismiss, pluginKeyName } =
			this.options;
		return [
			Suggestion<MentionItem, MentionItem>({
				editor: this.editor,
				char,
				allowedPrefixes: char === "@" ? [" ", " "] : null,
				pluginKey: new PluginKey(pluginKeyName),
				items: ({ query }) => items(query, char),
				command: ({ editor, range, props }) => {
					if (insert?.(editor, range, props)) return;
					editor
						.chain()
						.focus()
						.insertContentAt(range, [
							{
								type: "mention",
								attrs: {
									kind: props.kind,
									id: props.id,
									// A date mention keeps its actual date: "Today" would be wrong tomorrow.
									label:
										props.kind === "date"
											? (props.detail ?? props.label)
											: props.label,
								},
							},
							{ type: "text", text: " " },
						])
						.run();
					onPick(props);
				},
				render: popupRender(store, undefined, onDismiss),
			}),
		];
	},
});

// ---------- paste and drop ----------

// A click's caret is set by the browser, and ProseMirror only reads it a moment later. An update landing
// in that gap, like another person typing, put the old selection back and the click was lost. So a
// plain click on text sets the caret itself, from where the pointer is.
const ClickKeeper = Extension.create({
	name: "clickKeeper",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("clickKeeper"),
				props: {
					handleClick(view, pos, event) {
						const plain =
							event.button === 0 &&
							event.detail === 1 &&
							!event.shiftKey &&
							!event.metaKey &&
							!event.ctrlKey &&
							!event.altKey;
						if (!plain || matchMedia("(hover: none)").matches) return false;
						const target = event.target as HTMLElement;
						if (
							target.closest(
								'button, a, input, select, textarea, [contenteditable="false"]',
							)
						)
							return false;
						const { doc, selection, tr } = view.state;
						const $pos = doc.resolve(pos);
						if (!$pos.parent.isTextblock) return false;
						if (selection.empty && selection.head === pos) return false;
						view.dispatch(tr.setSelection(TextSelection.create(doc, pos)));
						return false;
					},
				},
			}),
		];
	},
});

export type FileUploader = (files: File[], pos: number) => void;

function filesFrom(data: DataTransfer | null) {
	const files = Array.from(data?.files ?? []);
	if (!files.length) return [];
	return files;
}

const uploadKey = new PluginKey<DecorationSet>("uploads");

export const UploadExtension = Extension.create<{ upload: FileUploader }>({
	name: "uploads",
	addProseMirrorPlugins() {
		const { upload } = this.options;
		return [
			new Plugin({
				key: uploadKey,
				props: {
					handlePaste(view, event) {
						const files = filesFrom(event.clipboardData);
						if (!files.length) return false;
						event.preventDefault();
						upload(files, view.state.selection.from);
						return true;
					},
					handleDrop(view, event) {
						const files = filesFrom(event.dataTransfer);
						if (!files.length) return false;
						event.preventDefault();
						let pos =
							view.posAtCoords({
								left: event.clientX,
								top: event.clientY,
							})?.pos ?? view.state.selection.from;
						// Files land between blocks, never in the middle of a sentence.
						const $pos = view.state.doc.resolve(pos);
						if ($pos.depth > 0) {
							const dom = view.nodeDOM($pos.before(1));
							const box =
								dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
							pos =
								box && event.clientY < box.top + box.height / 2
									? $pos.before(1)
									: $pos.after(1);
						}
						upload(files, pos);
						return true;
					},
				},
			}),
		];
	},
});

// ---------- comment highlights ----------

export type HighlightThread = { id: string; from: number; to: number };

export const commentsKey = new PluginKey<{
	decorations: DecorationSet;
	threads: HighlightThread[];
	active: string | null;
}>("comments");

export const CommentHighlights = Extension.create<{
	resolve: (editor: Editor) => HighlightThread[];
}>({
	name: "commentHighlights",
	addProseMirrorPlugins() {
		const build = (
			doc: import("@tiptap/pm/model").Node,
			threads: HighlightThread[],
			active: string | null,
		) =>
			DecorationSet.create(
				doc,
				threads
					.filter((t) => t.from < t.to && t.to <= doc.content.size)
					.map((t) =>
						Decoration.inline(t.from, t.to, {
							class:
								t.id === active ? "lp-comment lp-comment-active" : "lp-comment",
							"data-thread": t.id,
						}),
					),
			);
		return [
			new Plugin({
				key: commentsKey,
				state: {
					init: (_, { doc }) => ({
						decorations: DecorationSet.empty,
						threads: [] as HighlightThread[],
						active: null as string | null,
						doc,
					}),
					apply: (tr, value, _old, state) => {
						const meta = tr.getMeta(commentsKey) as
							| { threads?: HighlightThread[]; active?: string | null }
							| undefined;
						if (!meta && !tr.docChanged) return value;
						const threads = meta?.threads ?? this.options.resolve(this.editor);
						const active =
							meta && "active" in meta ? (meta.active ?? null) : value.active;
						return {
							decorations: build(state.doc, threads, active),
							threads,
							active,
							doc: state.doc,
						};
					},
				},
				props: {
					decorations(state) {
						return commentsKey.getState(state)?.decorations;
					},
				},
			}),
		];
	},
});

// ---------- full editors ----------

export type BodyExtensionOptions = {
	doc: Y.Doc;
	awareness: Awareness;
	userId: string;
	upload: FileUploader;
	slashStore: PopupStore<SlashItem>;
	slashItems: (query: string) => SlashItem[];
	onAiSpace: () => void;
	onAiEmptyLine?: () => boolean;
	mentionStore: PopupStore<MentionItem>;
	mentionItems: (query: string, char: string) => MentionItem[];
	onMention: (item: MentionItem) => void;
	insertMention: (editor: Editor, range: Range, item: MentionItem) => boolean;
	dismissMention: (editor: Editor, range: Range) => void;
	resolveComments: (editor: Editor) => HighlightThread[];
	placeholder: () => string;
};

const AnchorAttr = Extension.create({
	name: "blockAnchor",
	addGlobalAttributes() {
		return [
			{
				types: [
					"paragraph",
					"heading",
					"bulletList",
					"orderedList",
					"taskList",
					"blockquote",
					"codeBlock",
					"callout",
					"toggle",
					"table",
					"image",
					"attachment",
					"pageLink",
					"databaseEmbed",
				],
				attributes: {
					anchor: {
						default: null,
						renderHTML: (attrs) =>
							attrs.anchor
								? { id: attrs.anchor, "data-anchor": attrs.anchor }
								: {},
						parseHTML: (el) => el.getAttribute("data-anchor"),
					},
				},
			},
		];
	},
});

// Every empty block gets its Yjs text node when it's created, not on its first keystroke. If two
// people type into a new paragraph at once, each would create a text node of their own, and the
// repair in y-prosemirror then writes one person's characters a second time. Mirrors what
// seedUpdate does for a page's first paragraph.
function emptyBlockText(doc: Y.Doc) {
	let listener: ((transaction: Y.Transaction) => void) | null = null;
	return Extension.create({
		name: "emptyBlockText",
		onCreate() {
			const { schema } = this.editor;
			const collect = (node: Y.XmlFragment, empty: Y.XmlElement[]) => {
				if (node instanceof Y.XmlElement && node.length === 0) {
					if (schema.nodes[node.nodeName]?.inlineContent) empty.push(node);
					return;
				}
				for (const child of node.toArray())
					if (child instanceof Y.XmlElement) collect(child, empty);
			};
			listener = (transaction) => {
				// Only this person's own editing: remote updates carry their creator's text node.
				if (transaction.origin !== ySyncPluginKey) return;
				const empty: Y.XmlElement[] = [];
				for (const type of transaction.changed.keys())
					if (type instanceof Y.XmlFragment) collect(type, empty);
				if (!empty.length) return;
				doc.transact(() => {
					for (const element of empty) element.insert(0, [new Y.XmlText()]);
				}, ySyncPluginKey);
			};
			doc.on("afterTransaction", listener);
		},
		onDestroy() {
			if (listener) doc.off("afterTransaction", listener);
		},
	});
}

// A page has to end in an empty paragraph, or there's nowhere to click below a table or a heading.
// StarterKit's trailingNode adds one in each browser as soon as it sees the page ending in another
// block, so two people opening the page each add their own and the page ends up with two. This adds
// it to the Yjs document instead, with an id derived from the block it follows: every browser
// produces the identical item, and Yjs keeps one.
const TRAILING_ORIGIN = "trailingParagraph";

function trailingParagraph(doc: Y.Doc) {
	let listener: (() => void) | null = null;
	return Extension.create({
		name: "trailingParagraph",
		onCreate() {
			const { editor } = this;
			let queued = false;
			const add = () => {
				queued = false;
				if (editor.isDestroyed || !editor.isEditable) return;
				const fragment = doc.getXmlFragment(BODY_FIELD);
				const last = fragment.get(fragment.length - 1);
				if (!(last instanceof Y.XmlElement) || last.nodeName === "paragraph")
					return;
				const id = last._item?.id;
				if (!id) return;
				const own = doc.clientID;
				doc.clientID = clientFor(`trailing:${id.client}:${id.clock}`);
				try {
					doc.transact(() => {
						const paragraph = new Y.XmlElement("paragraph");
						paragraph.insert(0, [new Y.XmlText()]);
						fragment.insert(fragment.length, [paragraph]);
					}, TRAILING_ORIGIN);
				} finally {
					doc.clientID = own;
				}
			};
			// After the transaction, never inside one: it runs on every change, remote ones included.
			listener = () => {
				if (queued) return;
				queued = true;
				queueMicrotask(add);
			};
			doc.on("afterTransaction", listener);
			listener();
		},
		onDestroy() {
			if (listener) doc.off("afterTransaction", listener);
		},
	});
}

export function bodyExtensions(opts: BodyExtensionOptions) {
	return [
		AnchorAttr,
		StarterKit.configure({
			undoRedo: false,
			heading: { levels: [1, 2, 3] },
			codeBlock: false,
			blockquote: { HTMLAttributes: { class: "lp-quote" } },
			link: {
				openOnClick: true,
				autolink: true,
				isAllowedUri: (url) => safeHref(url) !== null,
				HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
			},
			dropcursor: { color: "var(--color-link)", width: 2 },
			trailingNode: false,
		}),
		QuoteRule,
		Highlight.configure({ multicolor: false }),
		TaskList,
		TaskItem.configure({ nested: true }),
		CodeBlockLowlight.extend({
			addNodeView() {
				return ReactNodeViewRenderer(CodeBlockView);
			},
		}).configure({
			lowlight,
			defaultLanguage: "plaintext",
			enableTabIndentation: true,
		}),
		...tableExtensions,
		Callout,
		ToggleTitle,
		ToggleBody,
		Toggle,
		ImageBlock,
		Attachment,
		PageLink,
		DatabaseEmbed,
		MentionNode,
		Placeholder.configure({
			// editor.css paints the paragraph hint only on top-level paragraphs: it reads badly in a cell or a list.
			placeholder: ({ editor, node }) => {
				// A viewer sees only "This page is empty." on a page with nothing on it.
				if (!editor.isEditable) return editor.isEmpty ? opts.placeholder() : "";
				if (node.type.name === "heading")
					return `Heading ${node.attrs.level as number}`;
				if (node.type.name === "toggleTitle") return "Toggle";
				return node.type.name === "paragraph" ? opts.placeholder() : "";
			},
			includeChildren: true,
			showOnlyCurrent: true,
			showOnlyWhenEditable: false,
		}),
		Collaboration.configure({ document: opts.doc, field: BODY_FIELD }),
		ClickKeeper,
		trailingParagraph(opts.doc),
		tableRepair(opts.doc),
		emptyBlockText(opts.doc),
		Extension.create({
			name: "carets",
			addProseMirrorPlugins() {
				return [
					yCursorPlugin(opts.awareness, {
						cursorBuilder: caretElement,
						selectionBuilder: caretSelection,
						// One person's own other tab is not shown as someone else's caret.
						awarenessStateFilter: (me, them, state) =>
							me !== them &&
							(state as { userId?: string }).userId !== opts.userId,
					}),
				];
			},
		}),
		SlashExtension.configure({
			store: opts.slashStore,
			items: opts.slashItems,
			onAiSpace: opts.onAiSpace,
			onAiEmptyLine: opts.onAiEmptyLine,
		}),
		MentionExtension.configure({
			char: "@",
			store: opts.mentionStore,
			items: opts.mentionItems,
			onPick: opts.onMention,
			insert: opts.insertMention,
			onDismiss: opts.dismissMention,
			pluginKeyName: "mentionAt",
		}),
		MentionExtension.extend({ name: "pagePicker" }).configure({
			char: "[[",
			store: opts.mentionStore,
			items: opts.mentionItems,
			onPick: opts.onMention,
			insert: opts.insertMention,
			onDismiss: opts.dismissMention,
			pluginKeyName: "mentionBrackets",
		}),
		UploadExtension.configure({ upload: opts.upload }),
		CommentHighlights.configure({ resolve: opts.resolveComments }),
	];
}

function caretElement(user: { name: string; color: string }) {
	const cursor = document.createElement("span");
	cursor.className = "lp-caret";
	cursor.style.borderColor = user.color;
	const label = document.createElement("span");
	label.className = "lp-caret-label";
	label.style.backgroundColor = user.color;
	label.textContent = user.name.split(" ")[0];
	cursor.append(label);
	return cursor;
}

function caretSelection(user: { color: string }) {
	return {
		style: `background-color: color-mix(in srgb, ${user.color} 18%, transparent)`,
	};
}

// The title is its own small editor bound to another field of the same Yjs document.
const TitleDocument = Document.extend({ content: "paragraph" });

export function titleExtensions(doc: Y.Doc, placeholder: string) {
	return [
		TitleDocument,
		Paragraph,
		Text,
		Collaboration.configure({ document: doc, field: TITLE_FIELD }),
		Placeholder.configure({ placeholder }),
		Extension.create({
			name: "singleLine",
			addKeyboardShortcuts() {
				return { Enter: () => true };
			},
		}),
	];
}
