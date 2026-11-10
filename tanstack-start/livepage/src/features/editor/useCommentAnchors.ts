// Comments are pinned to Yjs items. Turning a block into another type or moving it makes new items,
// which would leave its comments pointing at nothing, so they get new anchors at the same text.
import type { Editor } from "@tiptap/core";
import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import {
	NodeSelection,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { useEffect, useRef } from "react";
import {
	type Comment,
	type CommentAnchor,
	submitCommentAnchors,
} from "#/functions/comments";
import { blockMoveWatchers } from "./move-block";

// Set on a transaction that replaces a block: where it was and where its text is now.
export const BLOCK_REWRITE = "lpBlockRewrite";
export type BlockRewrite = {
	from: number;
	to: number;
	nextFrom: number;
	nextTo: number;
};
const DRAFT = "__draft";
type Held = { id: string; anchor: CommentAnchor };
type Side = "from" | "to";
type Endpoint = {
	id: string;
	side: Side;
	pos: number;
	offset?: number;
	block?: PmNode;
	inner?: number;
	index?: number;
};

// Line breaks only exist inside code blocks, and other block types have none, so they don't count.
function charsBefore(doc: PmNode, from: number, pos: number) {
	let count = 0;
	doc.nodesBetween(from, pos, (node, start) => {
		if (node.isText) {
			const text = (node.text ?? "").slice(0, Math.max(0, pos - start));
			count += text.split("\n").join("").length;
		} else if (node.isLeaf && node.isInline && node.type.name !== "hardBreak")
			count += start < pos ? 1 : 0;
	});
	return count;
}

function posAtChars(
	doc: PmNode,
	from: number,
	to: number,
	chars: number,
	side: Side,
) {
	let count = 0;
	let last = from + 1;
	let found: number | null = null;
	doc.nodesBetween(from, to, (node, start) => {
		if (found !== null) return false;
		if (node.isText) {
			const text = node.text ?? "";
			for (let i = 0; i < text.length && found === null; i++) {
				if (text[i] === "\n") continue;
				if (side === "from" && count === chars) found = start + i;
				count += 1;
				if (side === "to" && count === chars) found = start + i + 1;
			}
			last = start + text.length;
		} else if (node.isLeaf && node.isInline && node.type.name !== "hardBreak") {
			if (side === "from" && count === chars) found = start;
			count += 1;
			if (side === "to" && count === chars) found = start + 1;
			last = start + 1;
		}
		return true;
	});
	return found ?? last;
}

function commonStart(a: string, b: string) {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

function commonEnd(a: string, b: string, start: number) {
	let i = 0;
	while (
		i < a.length - start &&
		i < b.length - start &&
		a[a.length - 1 - i] === b[b.length - 1 - i]
	)
		i++;
	return i;
}

function overlap(a: string, b: string) {
	const start = commonStart(a, b);
	return start + commonEnd(a, b, start);
}

// The document position of a text offset inside a text block, stepping over inline nodes like mentions.
function textPos(block: PmNode, blockPos: number, offset: number) {
	let pos = blockPos + 1;
	let left = offset;
	let found: number | null = null;
	block.forEach((child) => {
		if (found !== null) return;
		const length = child.isText
			? (child.text ?? "").length
			: child.textContent.length;
		if (child.isText && left <= length) {
			found = pos + left;
			return;
		}
		left -= length;
		pos += child.nodeSize;
	});
	return found ?? Math.min(pos, blockPos + 1 + block.content.size);
}

// The kinds of block a position sits in, outermost first, like "blockquote/paragraph".
function pathOf($pos: ResolvedPos) {
	const names: string[] = [];
	for (let d = 1; d <= $pos.depth; d++) names.push($pos.node(d).type.name);
	return names.join("/");
}

function textsOf(doc: PmNode) {
	const texts = new Set<string>();
	doc.descendants((node) => {
		if (!node.isTextblock) return true;
		texts.add(node.textContent);
		return false;
	});
	return texts;
}

export function useCommentAnchors({
	editor,
	pageId,
	comments,
	setComments,
	draft,
	setDraft,
	absolute,
	relativeFor,
}: {
	editor: Editor | null;
	pageId: string;
	comments: Comment[];
	setComments: (update: (prev: Comment[]) => Comment[]) => void;
	draft: CommentAnchor | null;
	setDraft: (anchor: CommentAnchor) => void;
	absolute: (editor: Editor, encoded: string) => number | null;
	relativeFor: (editor: Editor, pos: number) => string;
}) {
	const latest = useRef({ comments, draft, setComments, setDraft });
	latest.current = { comments, draft, setComments, setDraft };
	// Every anchor a comment has had in this session. Undo brings the old block back, and with it the old anchor.
	const seen = useRef(new Map<string, CommentAnchor[]>());

	useEffect(() => {
		if (!editor) return;
		let held: Endpoint[] | null = null;
		let moved = false;

		let caret: {
			text: string;
			offset: number;
			blocks: number;
			index: number;
			type: string;
			before: Set<string>;
		} | null = null;

		// Someone else turned or moved the block this person is typing in. The caret goes with it.
		const followCaret = () => {
			const was = caret;
			caret = null;
			if (!was) return;
			// After this update has settled: a repair of the document can follow it straight away.
			queueMicrotask(() => {
				if (editor.isDestroyed) return;
				const { doc, selection } = editor.state;
				const $head = selection.$head;
				if ($head.parent.textContent === was.text && pathOf($head) === was.type)
					return;
				// The block was moved or turned by someone else before this person's last keystrokes
				// reached them, so the copy they made lacks those keystrokes, which went into the old
				// block. Find the copy and put the difference back.
				let best: {
					node: PmNode;
					pos: number;
					index: number;
					score: number;
				} | null = null;
				let tie = false;
				doc.descendants((node, pos) => {
					if (!node.isTextblock) return true;
					// Only blocks this update made or changed: an untouched block isn't the copy.
					if (node.textContent !== was.text && was.before.has(node.textContent))
						return false;
					const score = overlap(was.text, node.textContent);
					if (best && score === best.score) tie = true;
					if (!best || score > best.score) {
						best = { node, pos, index: doc.resolve(pos).index(0), score };
						tie = false;
					}
					return false;
				});
				const found = best as {
					node: PmNode;
					pos: number;
					index: number;
					score: number;
				} | null;
				if (!found || tie) return;
				const text = found.node.textContent;
				if (found.score < Math.max(3, Math.ceil(was.text.length / 2))) return;
				// Same place, same type: an edit made right there by someone else, which stands. A
				// deleted block (one fewer block) stays deleted.
				const replaced =
					found.index !== was.index ||
					pathOf(doc.resolve(found.pos + 1)) !== was.type;
				if (text !== was.text && (!replaced || doc.childCount < was.blocks))
					return;
				const tr = editor.state.tr;
				if (text !== was.text) {
					const start = commonStart(was.text, text);
					const end = commonEnd(was.text, text, start);
					tr.replaceWith(
						textPos(found.node, found.pos, start),
						textPos(found.node, found.pos, text.length - end),
						was.text.length - end > start
							? editor.schema.text(was.text.slice(start, was.text.length - end))
							: [],
					);
				}
				const node = tr.doc.nodeAt(found.pos);
				if (!node) return;
				tr.setSelection(
					TextSelection.create(tr.doc, textPos(node, found.pos, was.offset)),
				);
				editor.view.dispatch(tr.setMeta("addToHistory", false));
			});
		};

		// A comment being written holds its place by Yjs position too, and only this browser knows about
		// it. If someone replaces the block meanwhile, find its words again.
		const findQuote = (quote: string) => {
			if (!quote || quote.includes("\n")) return null;
			const { doc } = editor.state;
			const hits: { from: number; to: number }[] = [];
			doc.descendants((node, pos) => {
				if (!node.isTextblock) return true;
				const at = node.textContent.indexOf(quote);
				if (at < 0) return false;
				const from = pos + 1 + at;
				const to = from + quote.length;
				if (
					to <= pos + node.nodeSize - 1 &&
					doc.textBetween(from, to, "\n", " ") === quote &&
					node.textContent.indexOf(quote, at + 1) < 0
				)
					hits.push({ from, to });
				else hits.push({ from: -1, to: -1 });
				return false;
			});
			return hits.length === 1 && hits[0].from >= 0 ? hits[0] : null;
		};

		const keepDraft = () => {
			const { draft } = latest.current;
			if (!draft) return;
			const from = absolute(editor, draft.from);
			const to = absolute(editor, draft.to);
			if (from !== null && to !== null && from < to) return;
			const hit = findQuote(draft.quote);
			if (!hit) return;
			latest.current.setDraft({
				...draft,
				from: relativeFor(editor, hit.from),
				to: relativeFor(editor, hit.to),
			});
		};
		let rewrite: BlockRewrite | null = null;

		const anchors = (): Held[] => {
			const { comments, draft } = latest.current;
			const rows: Held[] = [];
			for (const c of comments)
				if (c.threadId === c.id && c.anchor)
					rows.push({ id: c.id, anchor: c.anchor });
			if (draft) rows.push({ id: DRAFT, anchor: draft });
			return rows;
		};

		const remember = (id: string, anchor: CommentAnchor) => {
			const list = seen.current.get(id) ?? [];
			if (!list.some((a) => a.from === anchor.from && a.to === anchor.to))
				list.push(anchor);
			seen.current.set(id, list.slice(-8));
		};

		const apply = (changes: Held[]) => {
			if (!changes.length) return;
			const byId = new Map(changes.map((c) => [c.id, c.anchor]));
			const pending = byId.get(DRAFT);
			if (pending) latest.current.setDraft(pending);
			byId.delete(DRAFT);
			if (!byId.size) return;
			latest.current.setComments((prev) =>
				prev.map((c) => {
					const anchor = byId.get(c.id);
					return anchor ? { ...c, anchor } : c;
				}),
			);
			submitCommentAnchors({
				data: {
					pageId,
					moves: [...byId].map(([commentId, anchor]) => ({
						commentId,
						anchor,
					})),
				},
			}).catch(() => undefined);
		};

		const plan = (transaction: Transaction) => {
			rewrite = transaction.getMeta(BLOCK_REWRITE) ?? null;
			moved = false;
			if (transaction.getMeta("uiEvent") === "drop") {
				const { selection } = editor.state;
				if (selection instanceof NodeSelection) moved = true;
				else if (!selection.empty)
					rewrite = {
						from: selection.from,
						to: selection.to,
						nextFrom: transaction.selection.from,
						nextTo: transaction.selection.to,
					};
			}
			return rewrite !== null || moved;
		};

		const before = ({ transaction }: { transaction: Transaction }) => {
			caret = null;
			if (transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) {
				const { selection } = editor.state;
				const $head = selection.$head;
				if (selection.empty && editor.isFocused && $head.parent.isTextblock)
					caret = {
						text: $head.parent.textContent,
						offset: $head.parent.textBetween(0, $head.parentOffset).length,
						blocks: editor.state.doc.childCount,
						index: $head.index(0),
						type: pathOf($head),
						before: textsOf(editor.state.doc),
					};
			}
			held = null;
			if (!transaction.docChanged || !plan(transaction)) return;
			const doc = editor.state.doc;
			const points: Endpoint[] = [];
			for (const { id, anchor } of anchors()) {
				for (const side of ["from", "to"] as const) {
					const pos = absolute(editor, anchor[side]);
					if (pos === null) continue;
					if (rewrite) {
						if (pos < rewrite.from || pos > rewrite.to) continue;
						points.push({
							id,
							side,
							pos,
							offset: charsBefore(doc, rewrite.from, pos),
						});
						continue;
					}
					const $pos = doc.resolve(pos);
					if ($pos.depth < 1) continue;

					points.push({
						id,
						side,
						pos,
						block: $pos.node(1),
						inner: pos - $pos.before(1),
						index: $pos.index(0),
					});
				}
			}
			held = points;
		};

		const rebuild = (
			points: Endpoint[],
			locate: (p: Endpoint) => number | null,
		) => {
			const byId = new Map<string, Partial<Record<Side, string>>>();
			for (const point of points) {
				const pos = locate(point);
				if (pos === null) continue;
				const next = byId.get(point.id) ?? {};
				next[point.side] = relativeFor(editor, pos);
				byId.set(point.id, next);
			}
			const changes: Held[] = [];
			for (const { id, anchor } of anchors()) {
				const next = byId.get(id);
				if (!next) continue;
				remember(id, anchor);
				const updated = { ...anchor, ...next };
				remember(id, updated);
				changes.push({ id, anchor: updated });
			}
			apply(changes);
		};

		const after = ({ transaction }: { transaction: Transaction }) => {
			if (held) {
				const points = held;
				held = null;
				if (rewrite) {
					const target = rewrite;
					rebuild(points, (p) =>
						posAtChars(
							editor.state.doc,
							target.nextFrom,
							target.nextTo,
							p.offset ?? 0,
							p.side,
						),
					);
				} else {
					const doc = editor.state.doc;
					const blocks: { node: PmNode; pos: number; index: number }[] = [];
					doc.forEach((node, pos, index) => {
						blocks.push({ node, pos, index });
					});
					rebuild(points, (p) => {
						const found =
							blocks.find((b) => b.node === p.block) ??
							blocks.find((b) => p.block && b.node.eq(p.block));
						if (!found || found.index === p.index) return null;
						return found.pos + (p.inner ?? 0);
					});
				}
				return;
			}
			const sync = transaction.getMeta(ySyncPluginKey);
			if (sync?.isChangeOrigin && transaction.docChanged) {
				followCaret();
				keepDraft();
			}
			if (!sync?.isUndoRedoOperation) return;
			const live = (a: CommentAnchor) => {
				const from = absolute(editor, a.from);
				const to = absolute(editor, a.to);
				return from !== null && to !== null && from < to;
			};
			const changes: Held[] = [];
			for (const { id, anchor } of anchors()) {
				if (live(anchor)) continue;
				const earlier = (seen.current.get(id) ?? []).filter(live).pop();
				if (earlier) changes.push({ id, anchor: earlier });
			}
			apply(changes);
		};

		blockMoveWatchers.set(editor, (from) => {
			const { doc } = editor.state;
			const points: Endpoint[] = [];
			for (const { id, anchor } of anchors()) {
				for (const side of ["from", "to"] as const) {
					const pos = absolute(editor, anchor[side]);
					if (pos === null) continue;
					const $pos = doc.resolve(pos);
					if ($pos.depth < 1 || $pos.index(0) !== from) continue;
					points.push({ id, side, pos, inner: pos - $pos.before(1) });
				}
			}
			return (to) => {
				let start = 0;
				for (let i = 0; i < to; i++)
					start += editor.state.doc.child(i).nodeSize;
				rebuild(points, (p) => start + (p.inner ?? 0));
			};
		});
		editor.on("beforeTransaction", before);
		editor.on("transaction", after);
		return () => {
			blockMoveWatchers.delete(editor);
			editor.off("beforeTransaction", before);
			editor.off("transaction", after);
		};
	}, [editor, pageId, absolute, relativeFor]);
}
