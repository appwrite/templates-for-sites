// Moves a top-level block in the Yjs document itself. A ProseMirror delete and insert would rewrite
// every block in between, so someone typing in one of them would have their words land in the wrong place.
import type { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

// Called before a block moves, and what it returns right after, so comments in it can be re-pinned.
export const blockMoveWatchers = new WeakMap<
	Editor,
	(from: number) => (to: number) => void
>();

export function moveBlockTo(editor: Editor, from: number, to: number) {
	if (from === to) return;
	const y = ySyncPluginKey.getState(editor.state);
	if (!y?.type) return;
	const fragment = y.type as Y.XmlFragment;
	const block = fragment.get(from) as Y.XmlElement | undefined;
	if (!block || fragment.length !== editor.state.doc.childCount) return;
	const moved = blockMoveWatchers.get(editor)?.(from);
	y.doc.transact(() => {
		const copy = block.clone();
		fragment.delete(from, 1);
		fragment.insert(to, [copy]);
	}, ySyncPluginKey);
	moved?.(to);
}

export function moveBlockBy(
	editor: Editor,
	pos: number,
	to: "up" | "down" | "top" | "bottom",
) {
	const { doc } = editor.state;
	const index = doc.resolve(pos).index(0);
	const last = doc.childCount - 1;
	const target =
		to === "top"
			? 0
			: to === "bottom"
				? last
				: to === "up"
					? Math.max(0, index - 1)
					: Math.min(last, index + 1);
	moveBlockTo(editor, index, target);
}
