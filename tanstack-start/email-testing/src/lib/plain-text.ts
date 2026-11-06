// Turns an email's plain-text part into paragraphs, quotes and a signature, with links found.
// The Text tab renders this as React, and the open-in-a-new-tab preview renders it as HTML.

export type TextPart =
	| { kind: "text"; text: string }
	| { kind: "link"; text: string; href: string };

// One line of a paragraph. Line breaks inside a paragraph are kept.
export type TextLine = TextPart[];

export type TextBlock =
	| { kind: "paragraph"; lines: TextLine[] }
	| { kind: "quote"; lines: TextLine[] };

export type PlainText = {
	body: TextBlock[];
	// Everything after the "-- " separator (RFC 3676), shown dimmed.
	signature: TextBlock[] | null;
};

const URL_PATTERN = /<?\b(?:https?:\/\/|www\.)[^\s<>"]+>?/gi;
const SIGNATURE_SEPARATOR = /^-- ?$/;
const QUOTE_PREFIX = /^>[> ]*/;

// Drops punctuation that ends a sentence rather than the URL, but keeps a closing bracket the URL opened.
function trimUrl(url: string) {
	let out = url;
	for (;;) {
		const last = out.at(-1);
		if (!last) return out;
		if (".,;:!?'".includes(last)) {
			out = out.slice(0, -1);
			continue;
		}
		if (last === ")" && countOf(out, "(") < countOf(out, ")")) {
			out = out.slice(0, -1);
			continue;
		}
		if (last === "]" && countOf(out, "[") < countOf(out, "]")) {
			out = out.slice(0, -1);
			continue;
		}
		return out;
	}
}

function countOf(value: string, char: string) {
	return value.split(char).length - 1;
}

export function linkify(line: string): TextLine {
	const parts: TextPart[] = [];
	let last = 0;
	for (const match of line.matchAll(URL_PATTERN)) {
		let start = match.index ?? 0;
		let raw = match[0];
		// "<https://…>" is how mail clients write a link next to its label. The brackets go.
		const bracketed = raw.startsWith("<") && raw.endsWith(">");
		if (bracketed) raw = raw.slice(1, -1);
		else {
			if (raw.startsWith("<")) {
				raw = raw.slice(1);
				start += 1;
			}
			if (raw.endsWith(">")) raw = raw.slice(0, -1);
		}
		const url = bracketed ? raw : trimUrl(raw);
		if (/^(?:https?:\/\/|www\.)$/i.test(url)) continue;
		if (start > last)
			parts.push({ kind: "text", text: line.slice(last, start) });
		parts.push({
			kind: "link",
			text: url,
			href: /^www\./i.test(url) ? `https://${url}` : url,
		});
		last = bracketed ? start + match[0].length : start + url.length;
	}
	if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
	return parts;
}

function toBlocks(lines: string[]): TextBlock[] {
	const blocks: TextBlock[] = [];
	let current: TextBlock | null = null;
	for (const raw of lines) {
		const quoted = QUOTE_PREFIX.test(raw);
		const text = quoted ? raw.replace(QUOTE_PREFIX, "") : raw;
		const kind = quoted ? "quote" : "paragraph";
		// A blank line ends a paragraph. Inside a quote, it stays part of the quote.
		if (!quoted && !text.trim()) {
			current = null;
			continue;
		}
		let block: TextBlock | null = current;
		if (!block || block.kind !== kind) {
			block = { kind, lines: [] } as TextBlock;
			blocks.push(block);
			current = block;
		}
		block.lines.push(linkify(text.replace(/\s+$/, "")));
	}
	// Quotes keep inner blank lines, but not at their edges.
	for (const block of blocks) {
		if (block.kind !== "quote") continue;
		while (block.lines.length && isBlank(block.lines[0])) block.lines.shift();
		while (block.lines.length && isBlank(block.lines.at(-1) as TextLine))
			block.lines.pop();
	}
	return blocks.filter((b) => b.lines.length);
}

function isBlank(line: TextLine) {
	return line.every((p) => p.kind === "text" && !p.text.trim());
}

export function parsePlainText(text: string): PlainText {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const separator = lines.findIndex((line) => SIGNATURE_SEPARATOR.test(line));
	if (separator === -1) return { body: toBlocks(lines), signature: null };
	const signature = toBlocks(lines.slice(separator + 1));
	return {
		body: toBlocks(lines.slice(0, separator)),
		signature: signature.length ? signature : null,
	};
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c] as string,
	);
}

function lineHtml(line: TextLine) {
	return line
		.map((part) =>
			part.kind === "link"
				? `<a href="${escapeHtml(part.href)}">${escapeHtml(part.text)}</a>`
				: escapeHtml(part.text),
		)
		.join("");
}

function blocksHtml(blocks: TextBlock[]) {
	return blocks
		.map((block) => {
			const inner = block.lines.map(lineHtml).join("<br>");
			return block.kind === "quote"
				? `<blockquote>${inner}</blockquote>`
				: `<p>${inner}</p>`;
		})
		.join("");
}

// The same structure as HTML, for the preview that opens in its own tab.
export function plainTextToHtml(text: string) {
	const { body, signature } = parsePlainText(text);
	const signatureHtml = signature
		? `<div class="catchall-signature"><p>--</p>${blocksHtml(signature)}</div>`
		: "";
	return `<div class="catchall-text">${blocksHtml(body)}${signatureHtml}</div>`;
}
