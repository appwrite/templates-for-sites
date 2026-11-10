import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BODY_FIELD } from "#/features/editor/codec";
import { appendBlocks, type Block, snapshotFromBlocks } from "./blocks";

const EMPTY: Block[] = [
	{ type: "paragraph", content: [] },
	{ type: "heading", level: 2, content: [] },
	{ type: "bulletList", items: [{ content: [] }] },
	{ type: "orderedList", items: [{ content: [] }] },
	{ type: "taskList", items: [{ content: [], checked: false }] },
	{ type: "blockquote", content: [] },
	{ type: "codeBlock", text: "" },
	{ type: "table", header: false, rows: [[[]]] },
];

// Same rule the editor applies when a person presses Enter: an inline block always has a text
// node, or two people's first keystrokes each make their own and characters get duplicated.
function inlineBlocksWithoutText(fragment: Y.XmlFragment) {
	const bad: string[] = [];
	const walk = (node: Y.XmlFragment) => {
		for (const child of node.toArray()) {
			if (!(child instanceof Y.XmlElement)) continue;
			const inline = ["paragraph", "heading", "codeBlock"].includes(
				child.nodeName,
			);
			const hasText = child.toArray().some((c) => c instanceof Y.XmlText);
			if (inline && !hasText) bad.push(child.nodeName);
			walk(child);
		}
	};
	walk(fragment);
	return bad;
}

describe("blocks into Yjs", () => {
	it("gives every empty inline block a text node when appended", () => {
		const doc = new Y.Doc();
		appendBlocks(doc, EMPTY);
		expect(inlineBlocksWithoutText(doc.getXmlFragment(BODY_FIELD))).toEqual([]);
	});

	it("gives every empty inline block a text node in a new page body", () => {
		const { snapshot } = snapshotFromBlocks("page", "Title", EMPTY);
		const doc = new Y.Doc();
		Y.applyUpdate(doc, Uint8Array.from(Buffer.from(snapshot, "base64")));
		expect(inlineBlocksWithoutText(doc.getXmlFragment(BODY_FIELD))).toEqual([]);
	});
});
