// A small Markdown reader for AI output. The same tree drives the live preview and, once accepted,
// the content inserted into the editor, so what you see is what lands in the page. It only knows
// structure and basic emphasis: no links, images or HTML, so model output can't load anything.

export type MarkType = "bold" | "italic" | "code" | "strike";
export type InlineNode = {
	type: "text";
	text: string;
	marks?: { type: MarkType }[];
};

type ParagraphBlock = { type: "paragraph"; content?: InlineNode[] };

export type Block =
	| ParagraphBlock
	| { type: "heading"; attrs: { level: 1 | 2 | 3 }; content?: InlineNode[] }
	| {
			type: "codeBlock";
			attrs: { language: string | null };
			content?: InlineNode[];
	  }
	| { type: "blockquote"; content: ParagraphBlock[] }
	| { type: "horizontalRule" }
	| {
			type: "bulletList" | "orderedList";
			content: { type: "listItem"; content: ParagraphBlock[] }[];
	  }
	| {
			type: "taskList";
			content: {
				type: "taskItem";
				attrs: { checked: boolean };
				content: ParagraphBlock[];
			}[];
	  };

const MARKERS: { token: string; mark: MarkType }[] = [
	{ token: "**", mark: "bold" },
	{ token: "__", mark: "bold" },
	{ token: "~~", mark: "strike" },
	{ token: "`", mark: "code" },
	{ token: "*", mark: "italic" },
	{ token: "_", mark: "italic" },
];

function withMark(nodes: InlineNode[], mark: MarkType): InlineNode[] {
	return nodes.map((node) => ({
		...node,
		marks: [...(node.marks ?? []), { type: mark }],
	}));
}

function isWordChar(ch: string | undefined) {
	return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

export function parseInline(input: string): InlineNode[] {
	// A markdown link keeps its label and loses its target.
	const line = input.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	const out: InlineNode[] = [];
	let plain = "";
	const flush = () => {
		if (plain) out.push({ type: "text", text: plain });
		plain = "";
	};
	let i = 0;
	while (i < line.length) {
		const found = MARKERS.find((m) => line.startsWith(m.token, i));
		if (found) {
			const start = i + found.token.length;
			const end = line.indexOf(found.token, start);
			// `_` and `*` inside a word (snake_case, 2*3) are just characters.
			const inWord =
				found.token.length === 1 &&
				found.mark === "italic" &&
				isWordChar(line[i - 1]) &&
				isWordChar(line[start]);
			if (end > start && !inWord) {
				flush();
				const inner = line.slice(start, end);
				out.push(
					...withMark(
						found.mark === "code"
							? [{ type: "text", text: inner }]
							: parseInline(inner),
						found.mark,
					),
				);
				i = end + found.token.length;
				continue;
			}
		}
		plain += line[i];
		i += 1;
	}
	flush();
	return out;
}

const paragraph = (text: string): ParagraphBlock => {
	const content = parseInline(text);
	return content.length
		? { type: "paragraph", content }
		: { type: "paragraph" };
};

export function parseMarkdown(src: string): Block[] {
	const lines = src.replace(/\r\n/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) {
			i += 1;
			continue;
		}
		const fence = trimmed.match(/^```(\S*)/);
		if (fence) {
			const code: string[] = [];
			i += 1;
			while (i < lines.length && !lines[i].trim().startsWith("```")) {
				code.push(lines[i]);
				i += 1;
			}
			i += 1;
			const text = code.join("\n");
			blocks.push({
				type: "codeBlock",
				attrs: { language: fence[1] || null },
				...(text ? { content: [{ type: "text", text }] } : {}),
			});
			continue;
		}
		const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
		if (heading) {
			const content = parseInline(heading[2]);
			blocks.push({
				type: "heading",
				attrs: { level: heading[1].length as 1 | 2 | 3 },
				...(content.length ? { content } : {}),
			});
			i += 1;
			continue;
		}
		if (/^([-*_])\1{2,}$/.test(trimmed)) {
			blocks.push({ type: "horizontalRule" });
			i += 1;
			continue;
		}
		if (trimmed.startsWith(">")) {
			const quote: ParagraphBlock[] = [];
			while (i < lines.length && lines[i].trim().startsWith(">")) {
				quote.push(paragraph(lines[i].trim().replace(/^>\s?/, "")));
				i += 1;
			}
			blocks.push({ type: "blockquote", content: quote });
			continue;
		}
		if (/^[-*+]\s+\[[ xX]\]\s*/.test(trimmed)) {
			const items: Extract<Block, { type: "taskList" }>["content"] = [];
			while (i < lines.length) {
				const match = lines[i].trim().match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
				if (!match) break;
				items.push({
					type: "taskItem",
					attrs: { checked: match[1].toLowerCase() === "x" },
					content: [paragraph(match[2])],
				});
				i += 1;
			}
			blocks.push({ type: "taskList", content: items });
			continue;
		}
		if (/^[-*+]\s+/.test(trimmed)) {
			const items: { type: "listItem"; content: ParagraphBlock[] }[] = [];
			while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
				const text = lines[i].trim().replace(/^[-*+]\s+/, "");
				items.push({ type: "listItem", content: [paragraph(text)] });
				i += 1;
			}
			blocks.push({ type: "bulletList", content: items });
			continue;
		}
		if (/^\d+[.)]\s+/.test(trimmed)) {
			const items: { type: "listItem"; content: ParagraphBlock[] }[] = [];
			while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
				const text = lines[i].trim().replace(/^\d+[.)]\s+/, "");
				items.push({ type: "listItem", content: [paragraph(text)] });
				i += 1;
			}
			blocks.push({ type: "orderedList", content: items });
			continue;
		}
		const para: string[] = [];
		while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
			para.push(lines[i].trim());
			i += 1;
		}
		if (para.length) blocks.push(paragraph(para.join(" ")));
		else i += 1;
	}
	return blocks;
}

function startsBlock(line: string) {
	const t = line.trim();
	return (
		t.startsWith("```") ||
		t.startsWith(">") ||
		/^#{1,3}\s/.test(t) ||
		/^[-*+]\s/.test(t) ||
		/^\d+[.)]\s/.test(t)
	);
}

// The plain text of a block tree, for places that can't show structure.
export function blocksToText(blocks: Block[]): string {
	return blocks
		.map((block) => {
			if (block.type === "horizontalRule") return "";
			if ("content" in block && block.content) {
				return (block.content as Array<InlineNode | { content?: unknown }>)
					.map((child) =>
						"text" in child && typeof child.text === "string"
							? child.text
							: blocksToText([child as Block]),
					)
					.join(
						block.type === "paragraph" || block.type === "heading" ? "" : "\n",
					);
			}
			return "";
		})
		.join("\n\n");
}
