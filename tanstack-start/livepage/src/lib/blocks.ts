// Plain block content for pages: built by templates, Markdown import and MCP, then written into a
// Yjs document the same way Tiptap's Collaboration extension writes (fragment "default", one
// XmlElement per node, marks as XmlText formatting). No Appwrite or browser imports.
import * as Y from "yjs";
import {
	BODY_FIELD,
	digest,
	seedUpdate,
	TITLE_FIELD,
	toBase64,
} from "#/features/editor/codec";

export type Inline = {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	code?: boolean;
	href?: string;
};

export type Block =
	| { type: "paragraph"; content: Inline[] }
	| { type: "heading"; level: 1 | 2 | 3; content: Inline[] }
	| { type: "bulletList"; items: ListItem[] }
	| { type: "orderedList"; items: ListItem[] }
	| { type: "taskList"; items: TaskItem[] }
	| { type: "blockquote"; content: Block[] }
	| { type: "codeBlock"; language?: string; text: string }
	| { type: "horizontalRule" }
	| { type: "image"; fileId?: string; src?: string; alt?: string }
	| { type: "table"; rows: Inline[][][]; header: boolean };

export type ListItem = { content: Inline[]; children?: Block[] };
export type TaskItem = ListItem & { checked: boolean };

// ---------- blocks into Yjs ----------

function inlineAttrs(inline: Inline) {
	const attrs: Record<string, object> = {};
	if (inline.bold) attrs.bold = {};
	if (inline.italic) attrs.italic = {};
	if (inline.strike) attrs.strike = {};
	if (inline.code) attrs.code = {};
	if (inline.href) attrs.link = { href: inline.href };
	return attrs;
}

function inlineNode(content: Inline[]) {
	const text = new Y.XmlText();
	let at = 0;
	for (const inline of content) {
		if (!inline.text) continue;
		text.insert(at, inline.text, inlineAttrs(inline));
		at += inline.text.length;
	}
	return text;
}

function paragraph(content: Inline[]) {
	const el = new Y.XmlElement("paragraph");
	// Always a text node, even when empty, so two people's first keystrokes share it. See emptyBlockText.
	el.insert(0, [inlineNode(content)]);
	return el;
}

function listItem(
	name: string,
	item: ListItem,
	attrs?: Record<string, unknown>,
) {
	const el = new Y.XmlElement(name);
	if (attrs)
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v as string);
	el.insert(0, [
		paragraph(item.content),
		...blocksToNodes(item.children ?? []),
	]);
	return el;
}

function blockNode(block: Block): Y.XmlElement {
	switch (block.type) {
		case "paragraph":
			return paragraph(block.content);
		case "heading": {
			const el = new Y.XmlElement("heading");
			el.setAttribute("level", block.level as unknown as string);
			el.insert(0, [inlineNode(block.content)]);
			return el;
		}
		case "bulletList":
		case "orderedList": {
			const el = new Y.XmlElement(block.type);
			el.insert(
				0,
				block.items.map((i) => listItem("listItem", i)),
			);
			return el;
		}
		case "taskList": {
			const el = new Y.XmlElement("taskList");
			el.insert(
				0,
				block.items.map((i) => listItem("taskItem", i, { checked: i.checked })),
			);
			return el;
		}
		case "blockquote": {
			const el = new Y.XmlElement("blockquote");
			el.insert(
				0,
				block.content.length ? blocksToNodes(block.content) : [paragraph([])],
			);
			return el;
		}
		case "codeBlock": {
			const el = new Y.XmlElement("codeBlock");
			if (block.language) el.setAttribute("language", block.language);
			// Always a text node, even when empty, for the same reason as paragraph() above.
			const text = new Y.XmlText();
			if (block.text) text.insert(0, block.text);
			el.insert(0, [text]);
			return el;
		}
		case "horizontalRule":
			return new Y.XmlElement("horizontalRule");
		case "image": {
			const el = new Y.XmlElement("image");
			if (block.fileId) el.setAttribute("fileId", block.fileId);
			if (block.src) el.setAttribute("src", block.src);
			el.setAttribute("alt", block.alt ?? "");
			return el;
		}
		case "table": {
			const table = new Y.XmlElement("table");
			table.insert(
				0,
				block.rows.map((row, rowIndex) => {
					const tr = new Y.XmlElement("tableRow");
					tr.insert(
						0,
						row.map((cell) => {
							const td = new Y.XmlElement(
								block.header && rowIndex === 0 ? "tableHeader" : "tableCell",
							);
							td.insert(0, [paragraph(cell)]);
							return td;
						}),
					);
					return tr;
				}),
			);
			return table;
		}
	}
}

export function blocksToNodes(blocks: Block[]) {
	return blocks.map(blockNode);
}

// Appends blocks to a document's body. Run in a transaction, so a live editor sees one change.
export function appendBlocks(doc: Y.Doc, blocks: Block[]) {
	const fragment = doc.getXmlFragment(BODY_FIELD);
	if (!blocks.length) return;
	doc.transact(() => {
		fragment.insert(fragment.length, blocksToNodes(blocks));
	});
}

// A new page's whole body: the title field the editor keeps next to the blocks, then the blocks.
// The title comes from the same deterministic update the editor uses, so it never appears twice.
export function snapshotFromBlocks(
	pageId: string,
	title: string,
	blocks: Block[],
) {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, seedUpdate(pageId, TITLE_FIELD, title));
	if (blocks.length) appendBlocks(doc, blocks);
	else Y.applyUpdate(doc, seedUpdate(pageId, BODY_FIELD));
	const facts = digest(doc.getXmlFragment(BODY_FIELD));
	const snapshot = toBase64(Y.encodeStateAsUpdate(doc));
	const stateVector = toBase64(Y.encodeStateVector(doc));
	doc.destroy();
	return { snapshot, stateVector, text: facts.text, links: facts.links };
}

// ---------- Yjs into plain text and Markdown ----------

type Child = Y.XmlElement | Y.XmlText;

const childrenOf = (node: Y.XmlFragment | Y.XmlElement): Child[] =>
	node
		.toArray()
		.filter(
			(c): c is Child => c instanceof Y.XmlElement || c instanceof Y.XmlText,
		);

function nodeText(node: Y.XmlElement | Y.XmlFragment): string {
	return childrenOf(node)
		.map((child) =>
			child instanceof Y.XmlText ? child.toString() : nodeText(child),
		)
		.join(" ")
		.trim();
}

function escapeInline(text: string) {
	return text.replace(/([*_`[\]\\])/g, "\\$1");
}

function textToMarkdown(text: Y.XmlText) {
	const parts: string[] = [];
	for (const op of text.toDelta() as {
		insert: string;
		attributes?: Record<string, { href?: string }>;
	}[]) {
		if (typeof op.insert !== "string") continue;
		const attrs = op.attributes ?? {};
		let value = attrs.code ? `\`${op.insert}\`` : escapeInline(op.insert);
		if (attrs.bold) value = `**${value}**`;
		if (attrs.italic) value = `*${value}*`;
		if (attrs.strike) value = `~~${value}~~`;
		if (attrs.link?.href) value = `[${value}](${attrs.link.href})`;
		parts.push(value);
	}
	return parts.join("");
}

function inlineMarkdown(node: Y.XmlElement) {
	return childrenOf(node)
		.map((child) =>
			child instanceof Y.XmlText
				? textToMarkdown(child)
				: inlineElementText(child),
		)
		.join("");
}

// Atoms that live inside a paragraph: mentions and page links.
function inlineElementText(el: Y.XmlElement) {
	if (el.nodeName === "mention")
		return `@${el.getAttribute("label") ?? el.getAttribute("id") ?? ""}`;
	if (el.nodeName === "pageLink" || el.nodeName === "pageMention")
		return `[${el.getAttribute("label") ?? el.getAttribute("title") ?? "Page"}](/p/${el.getAttribute("pageId") ?? el.getAttribute("id") ?? ""})`;
	if (el.nodeName === "hardBreak") return "  \n";
	return nodeText(el);
}

function listToMarkdown(
	el: Y.XmlElement,
	indent: string,
	ordered: boolean,
	task: boolean,
): string {
	const lines: string[] = [];
	childrenOf(el).forEach((item, i) => {
		if (!(item instanceof Y.XmlElement)) return;
		const marker = ordered ? `${i + 1}.` : "-";
		const check = task ? (item.getAttribute("checked") ? "[x] " : "[ ] ") : "";
		const parts = childrenOf(item).filter(
			(c): c is Y.XmlElement => c instanceof Y.XmlElement,
		);
		const head = parts[0] ? inlineMarkdown(parts[0]) : "";
		lines.push(`${indent}${marker} ${check}${head}`);
		for (const rest of parts.slice(1))
			lines.push(blockToMarkdown(rest, `${indent}  `));
	});
	return lines.join("\n");
}

function tableToMarkdown(el: Y.XmlElement) {
	const rows = childrenOf(el)
		.filter((row): row is Y.XmlElement => row instanceof Y.XmlElement)
		.map((row) =>
			childrenOf(row)
				.filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
				.map((cell) =>
					childrenOf(cell)
						.map((c) => (c instanceof Y.XmlElement ? inlineMarkdown(c) : ""))
						.join(" ")
						.replace(/\|/g, "\\|"),
				),
		);
	if (!rows.length) return "";
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [
		line(rows[0]),
		line(rows[0].map(() => "---")),
		...rows.slice(1).map(line),
	].join("\n");
}

function blockToMarkdown(el: Y.XmlElement, indent = ""): string {
	switch (el.nodeName) {
		case "heading": {
			const level = Number(el.getAttribute("level") ?? 1);
			return `${indent}${"#".repeat(level)} ${inlineMarkdown(el)}`;
		}
		case "bulletList":
			return listToMarkdown(el, indent, false, false);
		case "orderedList":
			return listToMarkdown(el, indent, true, false);
		case "taskList":
			return listToMarkdown(el, indent, false, true);
		case "blockquote":
			return childrenOf(el)
				.filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
				.map((c) => blockToMarkdown(c, ""))
				.join("\n\n")
				.split("\n")
				.map((line) => `${indent}> ${line}`)
				.join("\n");
		case "codeBlock": {
			const language = el.getAttribute("language") ?? "";
			return `${indent}\`\`\`${language}\n${nodeText(el)}\n${indent}\`\`\``;
		}
		case "horizontalRule":
			return `${indent}---`;
		case "image": {
			const alt = el.getAttribute("alt") ?? "";
			const fileId = el.getAttribute("fileId");
			const src = fileId
				? `/api/files/${fileId}`
				: (el.getAttribute("src") ?? "");
			return `${indent}![${alt}](${src})`;
		}
		case "table":
			return tableToMarkdown(el);
		default:
			return `${indent}${inlineMarkdown(el)}`;
	}
}

export function docToMarkdown(doc: Y.Doc, title?: string) {
	const blocks = childrenOf(doc.getXmlFragment(BODY_FIELD))
		.filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
		.map((c) => blockToMarkdown(c));
	const head = title ? [`# ${title}`] : [];
	return `${[...head, ...blocks].join("\n\n").trim()}\n`;
}

// Every image file a document uses, so deleting a page can remove them too.
export function docFileIds(doc: Y.Doc) {
	const out = new Set<string>();
	const walk = (node: Y.XmlFragment | Y.XmlElement) => {
		for (const child of childrenOf(node)) {
			if (!(child instanceof Y.XmlElement)) continue;
			const fileId = child.getAttribute("fileId");
			if (fileId) out.add(fileId);
			walk(child);
		}
	};
	walk(doc.getXmlFragment(BODY_FIELD));
	return [...out];
}

// ---------- Markdown into blocks ----------

const INLINE =
	/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|~~[^~]+~~|`[^`]+`|!?\[[^\]]*\]\([^)\s]+\))/;

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	let rest = text;
	while (rest) {
		const m = rest.match(INLINE);
		if (!m || m.index === undefined) {
			out.push({ text: rest });
			break;
		}
		if (m.index) out.push({ text: rest.slice(0, m.index) });
		const token = m[0];
		if (token.startsWith("**") || token.startsWith("__"))
			out.push(
				...parseInline(token.slice(2, -2)).map((i) => ({ ...i, bold: true })),
			);
		else if (token.startsWith("~~"))
			out.push({ text: token.slice(2, -2), strike: true });
		else if (token.startsWith("`"))
			out.push({ text: token.slice(1, -1), code: true });
		else if (token.startsWith("*") || token.startsWith("_"))
			out.push(
				...parseInline(token.slice(1, -1)).map((i) => ({ ...i, italic: true })),
			);
		else if (token.startsWith("!")) {
			const inner = token.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
			if (inner) out.push({ text: inner[1] || inner[2] });
		} else {
			const inner = token.match(/^\[([^\]]*)\]\(([^)]+)\)/);
			if (inner) out.push({ text: inner[1], href: inner[2] });
		}
		rest = rest.slice(m.index + token.length);
	}
	return out.filter((i) => i.text);
}

const indentOf = (line: string) => line.length - line.trimStart().length;

type ListRead = { block: Block; next: number };

function readList(lines: string[], start: number): ListRead {
	const base = indentOf(lines[start]);
	const first = lines[start].trimStart();
	const ordered = /^\d+[.)]\s/.test(first);
	const task = /^[-*+]\s\[[ xX]\]\s/.test(first);
	const items: TaskItem[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			// A blank line inside a list only continues it if the list goes on after.
			let j = i;
			while (j < lines.length && !lines[j].trim()) j++;
			if (
				j < lines.length &&
				indentOf(lines[j]) >= base &&
				isListLine(lines[j].trimStart())
			) {
				i = j;
				continue;
			}
			break;
		}
		const indent = indentOf(line);
		const text = line.trimStart();
		if (indent < base || (indent === base && !isListLine(text))) break;
		if (indent > base) {
			const last = items[items.length - 1];
			if (isListLine(text)) {
				const nested = readList(lines, i);
				if (last) last.children = [...(last.children ?? []), nested.block];
				i = nested.next;
				continue;
			}
			if (last) last.content.push({ text: ` ${text}` });
			i++;
			continue;
		}
		const m = text.match(/^(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
		if (!m) break;
		items.push({
			content: parseInline(m[2]),
			checked: m[1]?.toLowerCase() === "x",
		});
		i++;
	}
	if (task) return { block: { type: "taskList", items }, next: i };
	return {
		block: {
			type: ordered ? "orderedList" : "bulletList",
			items: items.map(({ checked: _, ...item }) => item),
		},
		next: i,
	};
}

const isListLine = (text: string) => /^(?:[-*+]|\d+[.)])\s+/.test(text);
const isTableRow = (text: string) => text.includes("|");
const isDivider = (text: string) =>
	/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(text);

function splitRow(line: string) {
	let body = line.trim();
	if (body.startsWith("|")) body = body.slice(1);
	if (body.endsWith("|")) body = body.slice(0, -1);
	return body
		.split(/(?<!\\)\|/)
		.map((cell) => parseInline(cell.trim().replace(/\\\|/g, "|")));
}

export function markdownToBlocks(markdown: string): Block[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const text = line.trim();
		if (!text) {
			i++;
			continue;
		}
		const fence = text.match(/^(```+|~~~+)\s*([\w-]*)/);
		if (fence) {
			const body: string[] = [];
			i++;
			while (
				i < lines.length &&
				!lines[i].trim().startsWith(fence[1].slice(0, 3))
			)
				body.push(lines[i++]);
			i++;
			blocks.push({
				type: "codeBlock",
				language: fence[2] || undefined,
				text: body.join("\n"),
			});
			continue;
		}
		const heading = text.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			blocks.push({
				type: "heading",
				level: Math.min(3, heading[1].length) as 1 | 2 | 3,
				content: parseInline(heading[2].replace(/\s+#+\s*$/, "")),
			});
			i++;
			continue;
		}
		if (/^([-*_])(\s*\1){2,}\s*$/.test(text)) {
			blocks.push({ type: "horizontalRule" });
			i++;
			continue;
		}
		if (isListLine(text)) {
			const read = readList(lines, i);
			blocks.push(read.block);
			i = read.next;
			continue;
		}
		if (text.startsWith(">")) {
			const body: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith(">"))
				body.push(lines[i++].trim().replace(/^>\s?/, ""));
			blocks.push({
				type: "blockquote",
				content: markdownToBlocks(body.join("\n")),
			});
			continue;
		}
		const image = text.match(/^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/);
		if (image) {
			blocks.push({ type: "image", src: image[2], alt: image[1] });
			i++;
			continue;
		}
		if (isTableRow(text) && i + 1 < lines.length && isDivider(lines[i + 1])) {
			const rows = [splitRow(text)];
			i += 2;
			while (i < lines.length && lines[i].trim() && isTableRow(lines[i]))
				rows.push(splitRow(lines[i++]));
			blocks.push({ type: "table", rows, header: true });
			continue;
		}
		const body = [text];
		i++;
		while (i < lines.length && lines[i].trim() && !startsBlock(lines[i].trim()))
			body.push(lines[i++].trim());
		blocks.push({ type: "paragraph", content: parseInline(body.join(" ")) });
	}
	return blocks;
}

function startsBlock(text: string) {
	return (
		/^(#{1,6})\s/.test(text) ||
		isListLine(text) ||
		text.startsWith(">") ||
		text.startsWith("```") ||
		/^([-*_])(\s*\1){2,}\s*$/.test(text) ||
		text.startsWith("![")
	);
}
