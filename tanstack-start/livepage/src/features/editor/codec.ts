// Pure helpers shared by the browser and the Site's server code. No DOM, no Appwrite.
import * as Y from "yjs";

export const BODY_FIELD = "default";
export const TITLE_FIELD = "title";

// One Appwrite request carries about 11 MB. A row in `updates` and a page's snapshot are both one
// request, so this is the largest a page can be, in base64 characters (about 6.7 MB of content).
export const MAX_STATE_CHARS = 9_000_000;

export function toBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined")
		return Buffer.from(bytes).toString("base64");
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
	if (typeof Buffer !== "undefined")
		return new Uint8Array(Buffer.from(text, "base64"));
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// A stable 32-bit number, so every browser creates the same Yjs items for the same seed.
export function clientFor(input: string): number {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0 || 1;
}

// A brand new page has no Yjs content. If two people opened it and each created the first paragraph,
// they'd end up with two paragraphs, so the first paragraph comes from a deterministic update: same
// client id, same clock, same content, in every browser. Applying it twice changes nothing.
export function seedUpdate(
	pageId: string,
	field: string,
	text = "",
): Uint8Array {
	const doc = new Y.Doc();
	doc.clientID = clientFor(`${pageId}:${field}`);
	const fragment = doc.getXmlFragment(field);
	const paragraph = new Y.XmlElement("paragraph");
	// Always include the text node, even when empty. Otherwise each person's first keystroke creates
	// its own, and y-prosemirror writes the second person's characters back as new ones.
	const inner = new Y.XmlText();
	if (text) inner.insert(0, text);
	paragraph.insert(0, [inner]);
	fragment.insert(0, [paragraph]);
	const update = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return update;
}

export type Digest = {
	text: string;
	// Pages this body links to, from page links and page mentions.
	links: string[];
	// Files this body uses, so a published page only serves its own files.
	files: string[];
};

const BLOCKS = new Set([
	"paragraph",
	"heading",
	"blockquote",
	"listItem",
	"taskItem",
	"callout",
	"codeBlock",
	"toggleTitle",
	"tableCell",
	"tableHeader",
]);

// Plain text and outgoing references, read straight from the Yjs tree.
export function digest(fragment: Y.XmlFragment): Digest {
	const lines: string[] = [];
	const links = new Set<string>();
	const files = new Set<string>();
	let line = "";
	const endLine = () => {
		if (line) lines.push(line);
		line = "";
	};
	const visit = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
		if (node instanceof Y.XmlText) {
			for (const op of node.toDelta() as { insert?: unknown }[])
				if (typeof op.insert === "string") line += op.insert;
			return;
		}
		if (node instanceof Y.XmlElement) {
			const name = node.nodeName;
			if (name === "mention") {
				const label = node.getAttribute("label");
				if (label)
					line += `${node.getAttribute("kind") === "person" ? "@" : ""}${label}`;
				if (node.getAttribute("kind") === "page") {
					const id = node.getAttribute("id");
					if (id) links.add(id);
				}
				return;
			}
			if (name === "databaseEmbed") {
				const id = node.getAttribute("databaseId");
				if (id) links.add(id);
				return;
			}
			if (name === "pageLink") {
				const id = node.getAttribute("pageId");
				const title = node.getAttribute("title");
				if (id) links.add(id);
				if (title) lines.push(title);
				return;
			}
			if (name === "image" || name === "attachment") {
				const fileId = node.getAttribute("fileId");
				if (fileId) files.add(fileId);
				const label = node.getAttribute(name === "image" ? "alt" : "name");
				if (label) lines.push(label);
				return;
			}
		}
		for (const child of node.toArray())
			visit(child as Y.XmlElement | Y.XmlText);
		if (node instanceof Y.XmlElement && BLOCKS.has(node.nodeName)) endLine();
	};
	visit(fragment);
	endLine();
	return { text: lines.join("\n"), links: [...links], files: [...files] };
}

export function docFromUpdates(updates: Uint8Array[]): Y.Doc {
	const doc = new Y.Doc();
	for (const update of updates) Y.applyUpdate(doc, update);
	return doc;
}

export type Caret = {
	anchor: unknown;
	head: unknown;
	name: string;
	color: string;
	userId: string;
	at: number;
};

export function parseCaret(value: unknown): Caret | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && parsed.head
			? (parsed as Caret)
			: null;
	} catch {
		return null;
	}
}
