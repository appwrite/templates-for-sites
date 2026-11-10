import type { Editor, Range } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { SlashItem } from "./extensions";

export type SlashContext = {
	aiWrite: () => void;
	aiImage: () => void;
	pickImage: (editor: Editor, range: Range) => void;
	pickFile: (editor: Editor, range: Range) => void;
	linkPage: (editor: Editor, range: Range, query: string) => void;
	newDatabase: (editor: Editor, range: Range) => void;
	linkDatabase: (editor: Editor, range: Range, query: string) => void;
};

const clean = (editor: Editor, range: Range) =>
	editor.chain().focus().deleteRange(range);

const ITEMS = new Set(["listItem", "taskItem"]);

// A block chosen at the end of a line that has text goes on a new line below it, as in Notion. On an
// empty line it turns that line. Returns the range of the line the block should take.
function lineFor(editor: Editor): Range {
	const { state } = editor;
	const { $from } = state.selection;
	const here = { from: $from.pos, to: $from.pos };
	if (!$from.parent.isTextblock || $from.parent.content.size === 0) return here;
	const { tr, schema } = state;
	const line = schema.nodes.paragraph.create();
	let item = -1;
	for (let d = $from.depth - 1; d > 0; d--)
		if (ITEMS.has($from.node(d).type.name)) {
			item = d;
			break;
		}
	let pos: number | null = null;
	if (item > 0) {
		// Out of the list, right after this item: the list splits around the new line.
		const after = $from.after(item);
		const list = item - 1;
		if (after < $from.end(list)) {
			tr.split(after, 1);
			pos = after + 1;
		} else pos = $from.after(list);
	} else {
		for (let d = $from.depth; d > 0; d--) {
			const parent = $from.node(d - 1);
			const index = $from.index(d - 1) + 1;
			if (parent.canReplaceWith(index, index, line.type)) {
				pos = $from.after(d);
				break;
			}
		}
	}
	if (pos === null) return here;
	tr.insert(pos, line);
	tr.setSelection(TextSelection.create(tr.doc, pos + 1));
	editor.view.dispatch(tr);
	return { from: pos + 1, to: pos + 1 };
}

function block(
	id: string,
	label: string,
	icon: string,
	hint: string | undefined,
	keywords: string[],
	apply: (
		chain: ReturnType<typeof clean>,
		editor: Editor,
		range: Range,
	) => unknown,
): SlashItem {
	return {
		id,
		label,
		icon,
		hint,
		group: "Blocks",
		keywords,
		run: (editor, range) => {
			clean(editor, range).run();
			// The new line first: a chain started before it would hold the old document.
			const line = lineFor(editor);
			apply(editor.chain().focus(), editor, line);
		},
	};
}

export function slashItems(ctx: SlashContext): SlashItem[] {
	return [
		{
			id: "ai",
			label: "Ask AI to write",
			icon: "✦",
			hint: "Space",
			keywords: ["ai", "write", "generate", "continue"],
			run: (editor, range) => {
				clean(editor, range).run();
				ctx.aiWrite();
			},
		},
		block("text", "Text", "T", undefined, ["paragraph", "plain"], (c) =>
			c.setParagraph().run(),
		),
		block("h1", "Heading 1", "H1", "#", ["title", "h1"], (c) =>
			c.toggleHeading({ level: 1 }).run(),
		),
		block("h2", "Heading 2", "H2", "##", ["subtitle", "h2", "heading"], (c) =>
			c.toggleHeading({ level: 2 }).run(),
		),
		block("h3", "Heading 3", "H3", "###", ["h3"], (c) =>
			c.toggleHeading({ level: 3 }).run(),
		),
		block("bullet", "Bulleted list", "•", "-", ["ul", "unordered"], (c) =>
			c.toggleBulletList().run(),
		),
		block("ordered", "Numbered list", "1.", "1.", ["ol", "ordered"], (c) =>
			c.toggleOrderedList().run(),
		),
		block("todo", "To-do list", "☐", "[ ]", ["task", "check"], (c) =>
			c.toggleTaskList().run(),
		),
		block(
			"toggle",
			"Toggle",
			"▸",
			">",
			["collapse", "details"],
			(c, editor, range) => {
				const $from = editor.state.doc.resolve(range.from);
				const at = $from.depth ? $from.before() : range.from;
				c.insertContent({
					type: "toggle",
					content: [
						{ type: "toggleTitle" },
						{ type: "toggleBody", content: [{ type: "paragraph" }] },
					],
				}).run();
				// The caret goes into the new title, wherever the block landed.
				let target: number | null = null;
				editor.state.doc.descendants((node, pos) => {
					if (target === null && pos >= at && node.type.name === "toggle")
						target = pos + 2;
					return target === null;
				});
				if (target !== null) editor.commands.setTextSelection(target);
			},
		),
		block("quote", "Quote", "“", '"', ["blockquote"], (c) =>
			c.toggleBlockquote().run(),
		),
		block("callout", "Callout", "!", "!", ["note", "tip", "info"], (c) =>
			c.setNode("callout").run(),
		),
		block("code", "Code", "{ }", "```", ["snippet", "pre"], (c) =>
			c.toggleCodeBlock().run(),
		),
		block("divider", "Divider", "—", "---", ["hr", "separator", "line"], (c) =>
			c.setHorizontalRule().run(),
		),
		block("table", "Table", "▦", undefined, ["grid"], (c) =>
			c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
		),
		// Generate comes first: "/image" is the command for making one. filterSlash drops it when AI images are off.
		{
			id: "generate-image",
			label: "Generate an image",
			icon: "✦",
			group: "Blocks",
			keywords: ["image", "ai", "picture", "draw", "create"],
			run: (editor, range) => {
				clean(editor, range).run();
				ctx.aiImage();
			},
		},
		{
			id: "image",
			label: "Upload an image",
			icon: "🖼",
			group: "Blocks",
			keywords: ["photo", "picture", "file"],
			run: (editor, range) => {
				clean(editor, range).run();
				ctx.pickImage(editor, range);
			},
		},
		{
			id: "file",
			label: "File",
			icon: "📎",
			group: "Blocks",
			keywords: ["attachment", "upload", "pdf"],
			run: (editor, range) => {
				clean(editor, range).run();
				ctx.pickFile(editor, range);
			},
		},
		{
			id: "page-link",
			label: "Link to a page",
			icon: "↗",
			group: "Blocks",
			keywords: ["page", "link", "mention"],
			run: (editor, range) => ctx.linkPage(editor, range, ""),
		},
		{
			id: "new-database",
			label: "New database",
			icon: "▦",
			group: "Databases",
			keywords: ["table", "collection"],
			run: (editor, range) => {
				clean(editor, range).run();
				ctx.newDatabase(editor, range);
			},
		},
		{
			id: "link-database",
			label: "Link an existing database",
			icon: "↗",
			group: "Databases",
			keywords: ["embed", "view"],
			run: (editor, range) => ctx.linkDatabase(editor, range, ""),
		},
	];
}

// How well an item answers what was typed: the start of its name, then a word in its name, then
// anywhere in its name, then a keyword. Ties keep the menu's order.
function matchRank(item: SlashItem, q: string) {
	const label = item.label.toLowerCase();
	if (label.startsWith(q)) return 0;
	if (label.split(" ").some((word) => word.startsWith(q))) return 1;
	if (label.includes(q)) return 2;
	if (item.keywords?.some((k) => k.startsWith(q))) return 3;
	if (item.keywords?.some((k) => k.includes(q))) return 4;
	return -1;
}

export function filterSlash(
	items: SlashItem[],
	query: string,
	context: { inTable: boolean; aiImages: boolean },
) {
	const q = query.trim().toLowerCase();
	const available = items.filter(
		(item) =>
			!(context.inTable && item.id === "table") &&
			(context.aiImages || item.id !== "generate-image"),
	);
	if (!q) return available;
	return available
		.map((item) => ({ item, rank: matchRank(item, q) }))
		.filter(({ rank }) => rank >= 0)
		.sort((a, b) => a.rank - b.rank)
		.map(({ item }) => item);
}
