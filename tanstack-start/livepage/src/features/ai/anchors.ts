// Positions in the page that survive other people's edits while AI is working.
import type { EditorState } from "@tiptap/pm/state";
import {
	absolutePositionToRelativePosition,
	relativePositionToAbsolutePosition,
	ySyncPluginKey,
} from "@tiptap/y-tiptap";
import type { RelativePosition } from "yjs";

export type SavedPos = { rel: RelativePosition } | { abs: number };

export function savePos(state: EditorState, abs: number): SavedPos {
	const binding = ySyncPluginKey.getState(state)?.binding;
	if (binding) {
		try {
			return {
				rel: absolutePositionToRelativePosition(
					abs,
					binding.type,
					binding.mapping,
				),
			};
		} catch {
			// Before the first sync the mapping isn't complete yet.
		}
	}
	return { abs };
}

export function loadPos(state: EditorState, pos: SavedPos): number | null {
	if ("abs" in pos) return Math.min(pos.abs, state.doc.content.size);
	const binding = ySyncPluginKey.getState(state)?.binding;
	if (!binding) return null;
	const abs = relativePositionToAbsolutePosition(
		binding.doc,
		binding.type,
		pos.rel,
		binding.mapping,
	);
	return abs == null ? null : Math.min(abs, state.doc.content.size);
}
