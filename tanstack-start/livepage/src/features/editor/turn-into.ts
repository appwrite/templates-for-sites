// Turning a block into another type of block, shared by the block menu and the phone's editing bar.
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PmNode, type Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { BLOCK_REWRITE, type BlockRewrite } from "./useCommentAnchors";

export type TurnTarget =
	| "text"
	| "h1"
	| "h2"
	| "h3"
	| "bullet"
	| "ordered"
	| "todo"
	| "toggle"
	| "quote"
	| "callout"
	| "code";

export const TURN_ITEMS: { id: TurnTarget; label: string; short: string }[] = [
	{ id: "text", label: "Text", short: "Text" },
	{ id: "h1", label: "Heading 1", short: "H1" },
	{ id: "h2", label: "Heading 2", short: "H2" },
	{ id: "h3", label: "Heading 3", short: "H3" },
	{ id: "bullet", label: "Bulleted list", short: "Bullet" },
	{ id: "ordered", label: "Numbered list", short: "Number" },
	{ id: "todo", label: "To-do list", short: "To-do" },
	{ id: "toggle", label: "Toggle", short: "Toggle" },
	{ id: "quote", label: "Quote", short: "Quote" },
	{ id: "callout", label: "Callout", short: "Callout" },
	{ id: "code", label: "Code", short: "Code" },
];

const TURNABLE = new Set([
	"paragraph",
	"heading",
	"blockquote",
	"bulletList",
	"orderedList",
	"taskList",
	"toggle",
	"callout",
	"codeBlock",
]);

export function canTurn(node: PmNode) {
	return TURNABLE.has(node.type.name);
}

// The lines of text inside a block, whatever shape it has.
function linesOf(node: PmNode, schema: Schema) {
	const lines: Fragment[] = [];
	const visit = (n: PmNode) => {
		if (n.type.name === "codeBlock") {
			for (const line of n.textContent.split("\n"))
				lines.push(line ? Fragment.from(schema.text(line)) : Fragment.empty);
			return;
		}
		if (n.isTextblock) {
			lines.push(n.content);
			return;
		}
		n.forEach(visit);
	};
	visit(node);
	return lines.length ? lines : [Fragment.empty];
}

function plain(line: Fragment) {
	let text = "";
	line.forEach((n) => {
		text += n.isText ? n.text : ((n.attrs.label as string) ?? "");
	});
	return text;
}

function build(target: TurnTarget, lines: Fragment[], schema: Schema) {
	const { nodes } = schema;
	const paragraph = (line: Fragment) => nodes.paragraph.create(null, line);
	switch (target) {
		case "text":
			return lines.map(paragraph);
		case "h1":
		case "h2":
		case "h3":
			return lines.map((line) =>
				nodes.heading.create({ level: Number(target[1]) }, line),
			);
		case "bullet":
			return [
				nodes.bulletList.create(
					null,
					lines.map((line) => nodes.listItem.create(null, paragraph(line))),
				),
			];
		case "ordered":
			return [
				nodes.orderedList.create(
					null,
					lines.map((line) => nodes.listItem.create(null, paragraph(line))),
				),
			];
		case "todo":
			return [
				nodes.taskList.create(
					null,
					lines.map((line) =>
						nodes.taskItem.create({ checked: false }, paragraph(line)),
					),
				),
			];
		case "toggle":
			return [
				nodes.toggle.create(null, [
					nodes.toggleTitle.create(null, lines[0]),
					nodes.toggleBody.create(
						null,
						lines.length > 1
							? lines.slice(1).map(paragraph)
							: nodes.paragraph.create(),
					),
				]),
			];
		case "quote":
			return [nodes.blockquote.create(null, lines.map(paragraph))];
		case "callout":
			return lines.map((line) => nodes.callout.create(null, line));
		case "code": {
			const text = lines.map(plain).join("\n");
			return [nodes.codeBlock.create(null, text ? schema.text(text) : null)];
		}
	}
}

function isAlready(node: PmNode, target: TurnTarget) {
	const name = node.type.name;
	if (target === "text") return name === "paragraph";
	if (target === "h1" || target === "h2" || target === "h3")
		return name === "heading" && node.attrs.level === Number(target[1]);
	const same: Partial<Record<TurnTarget, string>> = {
		bullet: "bulletList",
		ordered: "orderedList",
		todo: "taskList",
		toggle: "toggle",
		quote: "blockquote",
		callout: "callout",
		code: "codeBlock",
	};
	return same[target] === name;
}

// Returns where the new blocks are, or null if nothing changed.
export function turnBlock(editor: Editor, pos: number, target: TurnTarget) {
	const node = editor.state.doc.nodeAt(pos);
	if (!node || !canTurn(node) || isAlready(node, target)) {
		editor.commands.focus();
		return null;
	}
	const { schema, tr } = editor.state;
	const replacement = build(target, linesOf(node, schema), schema);
	tr.replaceWith(pos, pos + node.nodeSize, replacement);
	const nextTo = pos + replacement.reduce((size, n) => size + n.nodeSize, 0);
	tr.setMeta(BLOCK_REWRITE, {
		from: pos,
		to: pos + node.nodeSize,
		nextFrom: pos,
		nextTo,
	} satisfies BlockRewrite);
	// The caret lands in the first line of the new block.
	tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
	editor.view.dispatch(tr);
	editor.commands.focus();
	return { from: pos, to: nextTo };
}
