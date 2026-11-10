// The AI layer inside the editor. A preview floats inside the page as a decoration, so nothing
// touches the document or reaches anyone else until the person accepts it.

import { Link } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
	type EditorState,
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Spinner, useToast } from "#/components/ui";
import { loadPos, type SavedPos, savePos } from "./anchors";
import { BlockList, toContent } from "./blocks";
import {
	AiClientError,
	readError,
	refreshAiStatus,
	streamAi,
	useAiStatus,
} from "./client";
import {
	type Ghost,
	type GhostKeys,
	GhostText,
	ghostKey,
	ghostKeysKey,
	ghostKeysPlugin,
	ghostPlugin,
	shapeGhost,
} from "./ghost";
import { type Block, parseMarkdown } from "./markdown";
import type { TextAction } from "./prompts";
import { Spark } from "./spark";

export type EditorAiDetail =
	| { action: "write" }
	| { action: "selection" }
	| { action: "image-generate" }
	| { action: "image-edit"; fileId: string; pos: number };

// ---------- Anchors that survive other people's edits ----------

type Anchors = { from: SavedPos; to: SavedPos; selection: boolean };

const previewKey = new PluginKey<{
	anchors: Anchors | null;
	decorations: DecorationSet;
}>("lpAiPreview");

function blockEnd(doc: PMNode, pos: number) {
	const $pos = doc.resolve(Math.max(1, Math.min(pos, doc.content.size)));
	return $pos.depth >= 1 ? $pos.after(1) : pos;
}

function previewPlugin(host: HTMLElement) {
	const decorate = (state: EditorState, anchors: Anchors | null) => {
		if (!anchors) return DecorationSet.empty;
		const from = loadPos(state, anchors.from);
		const to = loadPos(state, anchors.to);
		if (from == null || to == null) return DecorationSet.empty;
		const decorations: Decoration[] = [
			Decoration.widget(blockEnd(state.doc, to), () => host, {
				key: "lp-ai-preview",
				side: 1,
				ignoreSelection: true,
				stopEvent: () => true,
			}),
		];
		// The draft is about to fill this empty line, so its placeholder would just be in the way.
		const $to = state.doc.resolve(to);
		if ($to.depth > 0 && $to.parent.content.size === 0) {
			decorations.push(
				Decoration.node($to.before(), $to.after(), {
					class: "lp-ai-ghost-line",
				}),
			);
		}
		if (anchors.selection && to > from) {
			decorations.push(
				Decoration.inline(from, to, {
					style: "background-color: var(--color-link-soft)",
				}),
			);
		}
		return DecorationSet.create(state.doc, decorations);
	};
	return new Plugin<{ anchors: Anchors | null; decorations: DecorationSet }>({
		key: previewKey,
		state: {
			init: () => ({ anchors: null, decorations: DecorationSet.empty }),
			apply(tr, value, _old, newState) {
				const meta = tr.getMeta(previewKey) as
					| { anchors: Anchors | null }
					| undefined;
				if (!meta && !tr.docChanged) return value;
				let anchors = meta ? meta.anchors : value.anchors;
				if (!meta && anchors) {
					const map = (p: SavedPos): SavedPos =>
						"abs" in p ? { abs: tr.mapping.map(p.abs) } : p;
					anchors = {
						...anchors,
						from: map(anchors.from),
						to: map(anchors.to),
					};
				}
				return { anchors, decorations: decorate(newState, anchors) };
			},
		},
		props: {
			decorations: (state) => previewKey.getState(state)?.decorations,
		},
	});
}

// ---------- What can run ----------

type TextRequest = {
	action: TextAction;
	text: string;
	context: string;
	instruction?: string;
	tone?: string;
	language?: string;
	// replace: swap the selection. insert: add below the current block.
	apply: "replace" | "insert";
};

type ImageRequest =
	| { mode: "generate"; prompt: string; aspect?: string; style?: string }
	| { mode: "edit"; prompt: string; fileId: string; pos: number };

type Preview =
	| {
			kind: "text";
			status: "streaming" | "done" | "stopped" | "error";
			text: string;
			blocks: Block[];
			request: TextRequest;
			errorCode?: string;
			errorMessage?: string;
	  }
	| {
			kind: "image";
			status: "running" | "done" | "error";
			request: ImageRequest;
			fileId?: string;
			width?: number;
			height?: number;
			note?: string;
			errorCode?: string;
			errorMessage?: string;
			startedAt: number;
	  };

type MenuAction = {
	id: string;
	label: string;
	run: () => void;
	hint?: string;
	sub?: "tone" | "language";
};

type Panel =
	| { kind: "menu"; scope: "selection" | "write"; sub?: "tone" | "language" }
	| { kind: "image"; mode: "generate"; initial: string }
	| { kind: "image"; mode: "edit"; fileId: string; pos: number }
	| { kind: "off"; message: string; fix: boolean }
	| { kind: "wait" };

const TONES = ["Professional", "Friendly", "Confident", "Casual", "Direct"];
const LANGUAGES = [
	"English",
	"Spanish",
	"French",
	"German",
	"Portuguese",
	"Hindi",
	"Japanese",
	"Chinese",
];
const CONTEXT_CHARS = 3_000;

function selectionText(editor: Editor) {
	const { from, to } = editor.state.selection;
	return editor.state.doc.textBetween(from, to, "\n\n", " ");
}

function surroundingText(editor: Editor, from: number, to: number) {
	const doc = editor.state.doc;
	const before = doc.textBetween(
		Math.max(0, from - CONTEXT_CHARS),
		from,
		"\n\n",
		" ",
	);
	const after = doc.textBetween(
		to,
		Math.min(doc.content.size, to + 1_000),
		"\n\n",
		" ",
	);
	return after
		? `${before}\n[...the selection goes here...]\n${after}`
		: before;
}

function firstName(name: string) {
	return name.split(" ")[0] || name;
}

export function EditorAiLayer({
	editor,
	pageId,
	workspaceId,
}: {
	editor: Editor;
	pageId: string;
	workspaceId: string;
}) {
	const { viewer } = useWorkspace();
	const status = useAiStatus(workspaceId);
	const toast = useToast();
	const [host] = useState<HTMLElement | null>(() => {
		if (typeof document === "undefined") return null;
		const el = document.createElement("div");
		el.className = "lp-ai-host";
		el.contentEditable = "false";
		return el;
	});
	const [ghostHost] = useState<HTMLElement | null>(() => {
		if (typeof document === "undefined") return null;
		const el = document.createElement("span");
		el.className = "lp-ai-ghost";
		el.contentEditable = "false";
		return el;
	});
	const [panel, setPanel] = useState<Panel | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [ghost, setGhost] = useState<Ghost | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const anchorsRef = useRef<Anchors | null>(null);
	const ghostRef = useRef<Ghost | null>(null);
	ghostRef.current = ghost;
	const previewRef = useRef(preview);
	previewRef.current = preview;
	const ghostKeys = useRef<GhostKeys>({
		accept: () => undefined,
		discard: () => undefined,
	});

	useEffect(() => {
		if (!host || !ghostHost) return;
		editor.registerPlugin(previewPlugin(host));
		editor.registerPlugin(ghostPlugin(ghostHost, ghostKeys));
		editor.registerPlugin(ghostKeysPlugin(ghostKeys), (plugin, all) => [
			plugin,
			...all,
		]);
		return () => {
			editor.unregisterPlugin(previewKey);
			editor.unregisterPlugin(ghostKey);
			editor.unregisterPlugin(ghostKeysKey);
		};
	}, [editor, host, ghostHost]);

	const setAnchors = useCallback(
		(anchors: Anchors | null) => {
			anchorsRef.current = anchors;
			const tr = editor.state.tr.setMeta(previewKey, { anchors });
			editor.view.dispatch(tr);
		},
		[editor],
	);

	const clearPreview = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setPreview((current) => {
			if (current?.kind === "image" && current.fileId)
				discardFile(current.fileId);
			return null;
		});
		setAnchors(null);
	}, [setAnchors]);

	// ---------- Ghost text at the caret ----------

	const setGhostAnchor = useCallback(
		(anchor: SavedPos | null) => {
			editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { anchor }));
		},
		[editor],
	);

	const discardGhost = useCallback(() => {
		if (!ghostRef.current) return;
		abortRef.current?.abort();
		abortRef.current = null;
		ghostRef.current = null;
		setGhost(null);
		setGhostAnchor(null);
	}, [setGhostAnchor]);

	const acceptGhost = useCallback(() => {
		const current = ghostRef.current;
		if (!current?.text) return;
		abortRef.current?.abort();
		abortRef.current = null;
		ghostRef.current = null;
		setGhost(null);
		const state = editor.state;
		const pos = loadPos(state, current.anchor);
		if (pos == null) {
			setGhostAnchor(null);
			toast.show("That spot is gone, so nothing was added.", { tone: "error" });
			return;
		}
		const text = current.text.trimEnd();
		const tr = state.tr.insertText(text, pos);
		editor.view.dispatch(
			tr
				.setSelection(TextSelection.create(tr.doc, pos + text.length))
				.setMeta(ghostKey, { anchor: null })
				.scrollIntoView(),
		);
		editor.view.focus();
	}, [editor, setGhostAnchor, toast]);

	ghostKeys.current = { accept: acceptGhost, discard: discardGhost };

	const runGhost = useCallback(
		(anchor: SavedPos, context: string, lead: string) => {
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			let raw = "";
			setGhost({ status: "streaming", text: "", anchor, context, lead });
			setGhostAnchor(anchor);
			const update = (patch: Partial<Ghost>) =>
				setGhost((current) =>
					current && abortRef.current === ctrl
						? { ...current, ...patch }
						: current,
				);
			const fail = (code: string, message: string) => {
				update({ status: "error", errorMessage: message });
				if (code === "bad_key" || code === "not_configured") refreshAiStatus();
			};
			streamAi(
				"/api/ai/text",
				{ workspaceId, pageId, action: "continue-inline", text: "", context },
				(event) => {
					if ("delta" in event) {
						raw += event.delta;
						update({ text: shapeGhost(raw, lead) });
					} else if ("error" in event) {
						fail(event.error.code, event.error.message);
					} else if ("done" in event) {
						update({ status: "done" });
					}
				},
				ctrl.signal,
			)
				.then(() => {
					setGhost((current) =>
						current?.status === "streaming" && abortRef.current === ctrl
							? {
									...current,
									status: current.text ? "done" : "error",
									errorMessage: current.text
										? undefined
										: "AI returned nothing. Try again.",
								}
							: current,
					);
				})
				.catch((err) => {
					if (ctrl.signal.aborted) return;
					if (err instanceof AiClientError) fail(err.code, err.message);
					else fail("unreachable", "Lost the connection. Try again.");
				});
		},
		[pageId, setGhostAnchor, workspaceId],
	);

	// ---------- Running text ----------

	const runText = useCallback(
		(request: TextRequest) => {
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			let text = "";
			setPreview({
				kind: "text",
				status: "streaming",
				text: "",
				blocks: [],
				request,
			});
			const update = (patch: Partial<Extract<Preview, { kind: "text" }>>) =>
				setPreview((current) =>
					current?.kind === "text" && abortRef.current === ctrl
						? { ...current, ...patch }
						: current,
				);
			streamAi(
				"/api/ai/text",
				{ workspaceId, pageId, ...request },
				(event) => {
					if ("delta" in event) {
						text += event.delta;
						update({ text, blocks: parseMarkdown(text) });
					} else if ("error" in event) {
						update({
							status: "error",
							errorCode: event.error.code,
							errorMessage: event.error.message,
						});
						if (event.error.code === "bad_key") refreshAiStatus();
					} else if ("done" in event) {
						update({ status: "done" });
					}
				},
				ctrl.signal,
			)
				.then(() => {
					setPreview((current) =>
						current?.kind === "text" &&
						current.status === "streaming" &&
						abortRef.current === ctrl
							? {
									...current,
									status: text ? "done" : "error",
									errorMessage: text
										? undefined
										: "AI returned nothing. Try again.",
								}
							: current,
					);
				})
				.catch((err) => {
					if (ctrl.signal.aborted) return;
					const code = err instanceof AiClientError ? err.code : "unreachable";
					const message =
						err instanceof AiClientError
							? err.message
							: "Lost the connection. Try again.";
					update({ status: "error", errorCode: code, errorMessage: message });
					if (code === "bad_key" || code === "not_configured")
						refreshAiStatus();
				});
		},
		[pageId, workspaceId],
	);

	const stopRun = useCallback(() => {
		abortRef.current?.abort();
		setPreview((current) =>
			current?.kind === "text" && current.status === "streaming"
				? { ...current, status: "stopped" }
				: current,
		);
	}, []);

	// ---------- Running images ----------

	const runImage = useCallback(
		(request: ImageRequest) => {
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			const startedAt = Date.now();
			setPreview((current) => {
				if (current?.kind === "image" && current.fileId)
					discardFile(current.fileId);
				return { kind: "image", status: "running", request, startedAt };
			});
			fetch("/api/ai/image", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ workspaceId, pageId, ...request }),
				signal: ctrl.signal,
			})
				.then(async (res) => {
					if (!res.ok) throw await readError(res);
					return (await res.json()) as {
						fileId: string;
						width: number;
						height: number;
					};
				})
				.then((data) => {
					if (ctrl.signal.aborted) return;
					let note: string | undefined;
					if (
						request.mode === "generate" &&
						request.aspect &&
						data.width &&
						data.height
					) {
						const asked = { square: 1, landscape: 1.5, portrait: 2 / 3 }[
							request.aspect as "square"
						];
						if (asked && Math.abs(data.width / data.height - asked) > 0.1)
							note = "This model only makes images in one shape.";
					}
					setPreview((current) =>
						current?.kind === "image"
							? {
									...current,
									status: "done",
									fileId: data.fileId,
									width: data.width,
									height: data.height,
									note,
								}
							: current,
					);
				})
				.catch((err) => {
					if (ctrl.signal.aborted) return;
					const code = err instanceof AiClientError ? err.code : "unreachable";
					const message =
						err instanceof AiClientError
							? err.message
							: "Lost the connection. Try again.";
					setPreview((current) =>
						current?.kind === "image"
							? {
									...current,
									status: "error",
									errorCode: code,
									errorMessage: message,
								}
							: current,
					);
					if (
						code === "bad_key" ||
						code === "not_configured" ||
						code === "no_images"
					)
						refreshAiStatus();
				});
		},
		[pageId, workspaceId],
	);

	const stopImage = useCallback(() => {
		abortRef.current?.abort();
		setPreview(null);
		setAnchors(null);
	}, [setAnchors]);

	// ---------- Accepting ----------

	const applyText = useCallback(
		(current: Extract<Preview, { kind: "text" }>) => {
			const anchors = anchorsRef.current;
			if (!anchors || !current.blocks.length) return;
			const state = editor.state;
			const from = loadPos(state, anchors.from);
			const to = loadPos(state, anchors.to);
			if (from == null || to == null) {
				toast.show("That text is gone, so nothing was changed.", {
					tone: "error",
				});
				clearPreview();
				return;
			}
			const content = toContent(current.blocks, state.schema) as Parameters<
				typeof editor.commands.insertContentAt
			>[1];
			const chain = editor.chain().focus();
			if (current.request.apply === "replace") {
				const $from = state.doc.resolve(from);
				const sameBlock = $from.sameParent(state.doc.resolve(to));
				const only = current.blocks.length === 1 ? current.blocks[0] : null;
				const inline =
					sameBlock && only?.type === "paragraph"
						? (only.content ?? [])
						: content;
				chain
					.insertContentAt(
						{ from, to },
						inline as Parameters<typeof editor.commands.insertContentAt>[1],
					)
					.run();
			} else {
				const $pos = state.doc.resolve(to);
				const block = $pos.depth >= 1 ? $pos.node(1) : null;
				if (block?.isTextblock && block.content.size === 0) {
					chain
						.insertContentAt(
							{ from: $pos.before(1), to: $pos.after(1) },
							content,
						)
						.run();
				} else {
					chain.insertContentAt(blockEnd(state.doc, to), content).run();
				}
			}
			abortRef.current = null;
			setPreview(null);
			setAnchors(null);
		},
		[clearPreview, editor, setAnchors, toast],
	);

	const applyImage = useCallback(
		(
			current: Extract<Preview, { kind: "image" }>,
			how: "insert" | "replace",
		) => {
			if (!current.fileId) return;
			const state = editor.state;
			const anchors = anchorsRef.current;
			const node = {
				type: "image",
				attrs: {
					fileId: current.fileId,
					alt: current.request.prompt.slice(0, 200),
				},
			};
			if (current.request.mode === "edit") {
				// Find the image again: it may have moved while the model was working.
				let found: { pos: number; node: PMNode } | null = null;
				state.doc.descendants((n, pos) => {
					if (
						n.type.name === "image" &&
						n.attrs.fileId === (current.request as { fileId: string }).fileId
					) {
						found = { pos, node: n };
						return false;
					}
					return !found;
				});
				const target = found as { pos: number; node: PMNode } | null;
				if (!target) {
					toast.show("The original image is gone, so nothing was changed.", {
						tone: "error",
					});
					clearPreview();
					return;
				}
				if (how === "replace") {
					const tr = state.tr.setNodeMarkup(target.pos, undefined, {
						...target.node.attrs,
						fileId: current.fileId,
					});
					editor.view.dispatch(tr);
				} else {
					editor
						.chain()
						.focus()
						.insertContentAt(target.pos + target.node.nodeSize, node)
						.run();
				}
			} else {
				const to = anchors ? loadPos(state, anchors.to) : null;
				const at = to ?? state.selection.to;
				const $pos = state.doc.resolve(at);
				const block = $pos.depth >= 1 ? $pos.node(1) : null;
				const range =
					block?.isTextblock && block.content.size === 0
						? { from: $pos.before(1), to: $pos.after(1) }
						: blockEnd(state.doc, at);
				editor.chain().focus().insertContentAt(range, node).run();
			}
			setPreview(null);
			setAnchors(null);
			abortRef.current = null;
		},
		[clearPreview, editor, setAnchors, toast],
	);

	// ---------- Opening ----------

	const statusRef = useRef(status);
	statusRef.current = status;
	const waitingRef = useRef<EditorAiDetail | null>(null);
	const waitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	useEffect(() => {
		const open = (detail: EditorAiDetail) => {
			if (!editor.isEditable) return;
			// A finished image or draft is kept: one more AI request must not silently throw it away.
			const held = previewRef.current;
			if (
				held &&
				(held.kind === "image"
					? held.status !== "error"
					: held.status === "streaming" || held.blocks.length > 0)
			) {
				toast.show("Insert or discard the AI draft first.");
				document
					.querySelector<HTMLElement>("[data-testid='ai-preview']")
					?.focus();
				return;
			}
			clearPreview();
			discardGhost();
			const status = statusRef.current;
			if (!status) {
				// Status is still loading: say so, and open as soon as it arrives.
				waitingRef.current = detail;
				setPanel({ kind: "wait" });
				clearTimeout(waitTimerRef.current);
				waitTimerRef.current = setTimeout(() => {
					if (!waitingRef.current) return;
					waitingRef.current = null;
					setPanel({
						kind: "off",
						message: "AI isn't responding. Reload the page and try again.",
						fix: false,
					});
				}, 8_000);
				return;
			}
			if (status.state !== "ready") {
				setPanel({
					kind: "off",
					message: status.canManage
						? status.state === "broken"
							? "The API key for this workspace stopped working. Check it in Settings."
							: "Add an API key in Settings to use AI on this workspace."
						: status.state === "broken"
							? "AI is off for now. Your workspace owner can turn it back on."
							: "AI isn't set up in this workspace yet.",
					fix: status.canManage,
				});
				return;
			}
			if (detail.action === "image-generate") {
				setPanel(
					status.images
						? { kind: "image", mode: "generate", initial: "" }
						: {
								kind: "off",
								message: status.canManage
									? "This AI provider doesn't make images. Choose an image model in Settings."
									: "Image generation isn't available in this workspace.",
								fix: status.canManage,
							},
				);
				return;
			}
			if (detail.action === "image-edit") {
				setPanel(
					status.images
						? {
								kind: "image",
								mode: "edit",
								fileId: detail.fileId,
								pos: detail.pos,
							}
						: {
								kind: "off",
								message: "This AI provider doesn't edit images.",
								fix: status.canManage,
							},
				);
				return;
			}
			const hasSelection = !editor.state.selection.empty;
			const scope =
				detail.action === "selection" && hasSelection ? "selection" : "write";
			if (scope === "selection") {
				// Keeps the soft highlight from the boards while focus moves to the panel.
				const { from, to } = editor.state.selection;
				setAnchors({
					from: savePos(editor.state, from),
					to: savePos(editor.state, to),
					selection: true,
				});
				requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
			}
			setPanel({ kind: "menu", scope });
		};
		if (status && waitingRef.current) {
			const queued = waitingRef.current;
			waitingRef.current = null;
			clearTimeout(waitTimerRef.current);
			open(queued);
		}
		const onEvent = (e: Event) =>
			open((e as CustomEvent<EditorAiDetail>).detail);
		window.addEventListener("livepage:ai", onEvent);
		return () => window.removeEventListener("livepage:ai", onEvent);
	}, [clearPreview, discardGhost, editor, setAnchors, status, toast]);

	// Insert requests from the Ask panel and from pages created from an answer.
	useEffect(() => {
		const insert = (markdown: string) => {
			const blocks = parseMarkdown(markdown);
			if (!blocks.length) return;
			if (!editor.isEditable) {
				toast.show("You can only view this page, so nothing was added.", {
					tone: "error",
				});
				return;
			}
			editor
				.chain()
				.focus("end")
				.insertContentAt(
					editor.state.doc.content.size,
					toContent(blocks, editor.state.schema) as never,
				)
				.run();
		};
		const onEvent = (e: Event) => {
			const { pageId: target, markdown } = (
				e as CustomEvent<{ pageId: string; markdown: string }>
			).detail;
			if (target === pageId) insert(markdown);
		};
		window.addEventListener("livepage:ai-insert", onEvent);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const key = `livepage:pending-ai:${pageId}`;
			const pending = sessionStorage.getItem(key);
			if (pending) {
				sessionStorage.removeItem(key);
				timer = setTimeout(() => insert(pending), 700);
			}
		} catch {
			// Storage can be blocked. Nothing to insert then.
		}
		return () => {
			window.removeEventListener("livepage:ai-insert", onEvent);
			if (timer) clearTimeout(timer);
		};
	}, [editor, pageId, toast]);

	// Keeps meaning search fresh, only when the workspace opted in.
	useEffect(() => {
		if (!status?.vectors) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onUpdate = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				fetch("/api/ai/embed", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ workspaceId, pageId }),
				}).catch(() => undefined);
			}, 20_000);
		};
		editor.on("update", onUpdate);
		return () => {
			editor.off("update", onUpdate);
			clearTimeout(timer);
		};
	}, [editor, pageId, status?.vectors, workspaceId]);

	useEffect(
		() => () => {
			abortRef.current?.abort();
			clearTimeout(waitTimerRef.current);
		},
		[],
	);

	// ---------- Menu actions ----------

	// `caret` is off when an outside click closed the panel: that click already chose what has focus.
	const closePanel = useCallback(
		(caret = true) => {
			waitingRef.current = null;
			clearTimeout(waitTimerRef.current);
			setPanel(null);
			if (!previewRef.current) setAnchors(null);
			if (caret) requestAnimationFrame(() => editor.view.focus());
		},
		[editor, setAnchors],
	);

	const beginInline = () => {
		const { selection } = editor.state;
		const at = selection.to;
		if (!selection.empty) {
			editor.view.dispatch(
				editor.state.tr.setSelection(
					TextSelection.create(editor.state.doc, at),
				),
			);
		}
		const state = editor.state;
		const $at = state.doc.resolve(at);
		const before = state.doc.textBetween(
			Math.max(0, at - 5_000),
			at,
			"\n\n",
			" ",
		);
		const after = state.doc.textBetween(
			at,
			Math.min(state.doc.content.size, at + 800),
			"\n\n",
			" ",
		);
		const context = after.trim()
			? `${before}[...continue here...]${after}`
			: before;
		setPanel(null);
		setAnchors(null);
		runGhost(
			savePos(state, at),
			context,
			$at.parent.textBetween(0, $at.parentOffset, undefined, " "),
		);
		// The page gets the keyboard back, so Tab and Esc reach the ghost text.
		requestAnimationFrame(() => editor.view.focus());
	};

	const beginText = (
		partial: Omit<TextRequest, "text" | "context"> & {
			useSelection: boolean;
			wholePage?: boolean;
		},
	) => {
		const { from, to } = editor.state.selection;
		const anchors: Anchors = {
			from: savePos(editor.state, from),
			to: savePos(editor.state, to),
			selection: partial.useSelection && to > from,
		};
		setPanel(null);
		const { useSelection, wholePage, ...rest } = partial;
		const text = useSelection
			? selectionText(editor)
			: wholePage
				? editor.getText({ blockSeparator: "\n\n" }).slice(0, 24_000)
				: "";
		const context = useSelection
			? surroundingText(editor, from, to)
			: wholePage
				? ""
				: editor.state.doc.textBetween(
						Math.max(0, from - 6_000),
						from,
						"\n\n",
						" ",
					);
		setAnchors(anchors);
		// The draft is the focus now: the highlight stays, the toolbar and native selection go.
		if (to > from) {
			editor.view.dispatch(
				editor.state.tr.setSelection(
					Selection.near(editor.state.doc.resolve(to), -1),
				),
			);
		}
		runText({ ...rest, text, context });
	};

	const beginImage = (request: ImageRequest) => {
		const anchors: Anchors =
			request.mode === "edit"
				? {
						from: savePos(editor.state, request.pos),
						to: savePos(editor.state, request.pos + 1),
						selection: false,
					}
				: {
						from: savePos(editor.state, editor.state.selection.to),
						to: savePos(editor.state, editor.state.selection.to),
						selection: false,
					};
		setAnchors(anchors);
		setPanel(null);
		runImage(request);
	};

	const askAboutSelection = () => {
		const query = selectionText(editor);
		setPanel(null);
		setAnchors(null);
		window.dispatchEvent(
			new CustomEvent("livepage:ask", { detail: { query } }),
		);
	};

	const menuItems = (scope: "selection" | "write"): MenuAction[] => {
		if (scope === "write") {
			const { selection } = editor.state;
			const items: MenuAction[] = [];
			// Ghost text sits on a line of text, so it needs a caret in one.
			if (
				!(selection instanceof NodeSelection) &&
				selection.$to.parent.isTextblock
			) {
				items.push({
					id: "inline",
					label: "Continue inline",
					run: beginInline,
				});
			}
			items.push(
				{
					id: "continue",
					label: "Continue in a draft",
					run: () =>
						beginText({
							action: "continue",
							apply: "insert",
							useSelection: false,
						}),
				},
				{
					id: "summarize",
					label: "Summarize this page",
					run: () =>
						beginText({
							action: "summarize",
							apply: "insert",
							useSelection: false,
							wholePage: true,
						}),
				},
			);
			if (status?.images)
				items.push({
					id: "image",
					label: "Create an image",
					run: () => setPanel({ kind: "image", mode: "generate", initial: "" }),
				});
			return items;
		}
		const selected = (
			action: TextAction,
			apply: TextRequest["apply"] = "replace",
		) => beginText({ action, apply, useSelection: true });
		const items: MenuAction[] = [
			{
				id: "rewrite",
				label: "Make it clearer",
				run: () => selected("rewrite"),
			},
			{
				id: "shorten",
				label: "Make it shorter",
				run: () => selected("shorten"),
			},
			{ id: "expand", label: "Make it longer", run: () => selected("expand") },
			{
				id: "grammar",
				label: "Fix spelling and grammar",
				run: () => selected("grammar"),
			},
			{
				id: "tone",
				label: "Change tone",
				sub: "tone",
				run: () => setPanel({ kind: "menu", scope: "selection", sub: "tone" }),
			},
			{
				id: "tasks",
				label: "Turn into a task list",
				run: () => selected("tasks"),
			},
			{
				id: "translate",
				label: "Translate",
				sub: "language",
				run: () =>
					setPanel({ kind: "menu", scope: "selection", sub: "language" }),
			},
			{
				id: "summarize",
				label: "Summarize",
				run: () => selected("summarize", "insert"),
			},
		];
		if (status?.ask)
			items.push({
				id: "related",
				label: "Find related pages",
				run: askAboutSelection,
			});
		if (status?.images)
			items.push({
				id: "image",
				label: "Create an image from this",
				run: () =>
					setPanel({
						kind: "image",
						mode: "generate",
						initial: selectionText(editor).slice(0, 400),
					}),
			});
		return items;
	};

	const subItems = (sub: "tone" | "language"): MenuAction[] =>
		sub === "tone"
			? TONES.map((tone) => ({
					id: tone,
					label: tone,
					run: () =>
						beginText({
							action: "tone",
							tone: tone.toLowerCase(),
							apply: "replace",
							useSelection: true,
						}),
				}))
			: LANGUAGES.map((language) => ({
					id: language,
					label: language,
					run: () =>
						beginText({
							action: "translate",
							language,
							apply: "replace",
							useSelection: true,
						}),
				}));

	const runCustom = (instruction: string, scope: "selection" | "write") => {
		const useSelection = scope === "selection";
		beginText({
			action: "custom",
			instruction,
			apply: useSelection ? "replace" : "insert",
			useSelection,
		});
	};

	if (!host) return null;
	const name = firstName(viewer.name);

	return (
		<>
			{preview &&
				createPortal(
					<PreviewBlock
						preview={preview}
						name={name}
						workspaceId={workspaceId}
						canManage={status?.canManage ?? false}
						onStop={stopRun}
						onStopImage={stopImage}
						onRetry={() =>
							preview.kind === "text"
								? runText(preview.request)
								: runImage(preview.request)
						}
						onDiscard={() => {
							clearPreview();
							requestAnimationFrame(() => editor.view.focus());
						}}
						onAccept={applyText}
						onInsertImage={applyImage}
					/>,
					host,
				)}
			{ghost &&
				ghostHost &&
				createPortal(
					<GhostText
						ghost={ghost}
						onAccept={acceptGhost}
						onDiscard={discardGhost}
						onRetry={() => runGhost(ghost.anchor, ghost.context, ghost.lead)}
					/>,
					ghostHost,
				)}
			{panel && (
				<PanelShell editor={editor} panel={panel} onClose={closePanel}>
					{panel.kind === "wait" ? (
						<p className="flex items-center gap-2.5 p-4 text-base leading-6 text-graphite">
							<Spinner size={14} /> Getting AI ready
						</p>
					) : panel.kind === "off" ? (
						<OffBody
							message={panel.message}
							fix={panel.fix}
							workspaceId={workspaceId}
							onClose={() => closePanel(false)}
						/>
					) : panel.kind === "menu" ? (
						<MenuBody
							key={panel.sub ?? panel.scope}
							items={panel.sub ? subItems(panel.sub) : menuItems(panel.scope)}
							placeholder={
								panel.sub === "tone"
									? "Pick a tone"
									: panel.sub === "language"
										? "Pick a language"
										: panel.scope === "selection"
											? "Tell AI what to do with this"
											: "Tell AI what to write"
							}
							onBack={
								panel.sub
									? () => setPanel({ kind: "menu", scope: panel.scope })
									: undefined
							}
							onCustom={
								panel.sub ? undefined : (text) => runCustom(text, panel.scope)
							}
							onClose={() => closePanel()}
						/>
					) : (
						<ImageBody
							panel={panel}
							options={status?.imageOptions ?? { aspects: [], styles: [] }}
							onSubmit={beginImage}
							onClose={() => closePanel()}
						/>
					)}
				</PanelShell>
			)}
			{status?.state === "broken" && (
				<AiOffNotice status={status} workspaceId={workspaceId} />
			)}
		</>
	);
}

function discardFile(fileId: string) {
	fetch(`/api/ai/image?fileId=${encodeURIComponent(fileId)}`, {
		method: "DELETE",
	}).catch(() => undefined);
}

// ---------- The floating panel ----------

function PanelShell({
	editor,
	panel,
	onClose,
	children,
}: {
	editor: Editor;
	panel: Panel;
	onClose: (caret?: boolean) => void;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [style, setStyle] = useState<React.CSSProperties>({
		// Not `visibility: hidden`: a hidden element can't take focus, and it hides for the first effects.
		opacity: 0,
		top: 0,
		left: 0,
	});

	useLayoutEffect(() => {
		const place = () => {
			const el = ref.current;
			if (!el) return;
			const pos =
				panel.kind === "image" && panel.mode === "edit"
					? panel.pos
					: editor.state.selection.to;
			let coords: { top: number; bottom: number; left: number };
			try {
				coords = editor.view.coordsAtPos(
					Math.min(pos, editor.state.doc.content.size),
				);
			} catch {
				coords = { top: 120, bottom: 140, left: 80 };
			}
			const margin = 8;
			const width = el.offsetWidth;
			const height = el.offsetHeight;
			const startCoords = (() => {
				try {
					return editor.view.coordsAtPos(editor.state.selection.from);
				} catch {
					return coords;
				}
			})();
			let left = Math.min(startCoords.left, window.innerWidth - width - 16);
			left = Math.max(16, left);
			let top = coords.bottom + margin;
			if (top + height > window.innerHeight - 16)
				top = Math.max(16, startCoords.top - height - margin);
			setStyle({ top, left, opacity: 1 });
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [editor, panel]);

	useEffect(() => {
		// The press that opened the panel (a slash menu row acts on mousedown) doesn't count as outside.
		const openedAt = performance.now();
		const onMouseDown = (e: MouseEvent) => {
			if (e.timeStamp <= openedAt) return;
			if (ref.current && !ref.current.contains(e.target as Node))
				onClose(false);
		};
		document.addEventListener("mousedown", onMouseDown);
		return () => document.removeEventListener("mousedown", onMouseDown);
	}, [onClose]);

	// The panel owns the keyboard. Editor commands refocus the page a frame later (Tiptap's focus()
	// runs in requestAnimationFrame), so focus is brought back here whenever the page takes it, and
	// a key that still lands in the page never reaches it.
	const ownFocus = useCallback(() => {
		const root = ref.current;
		if (!root) return;
		const active = document.activeElement;
		// Already inside, on something the person can use. The panel root itself doesn't count.
		if (active && active !== root && root.contains(active)) return;
		(root.querySelector<HTMLElement>("[data-ai-focus]") ?? root).focus({
			preventScroll: true,
		});
	}, []);

	useEffect(() => {
		const inPage = (target: EventTarget | null) =>
			editor.view.dom.contains(target as Node);
		const onFocusIn = (e: FocusEvent) => {
			if (inPage(e.target)) ownFocus();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (!inPage(e.target)) return;
			e.stopImmediatePropagation();
			ownFocus();
			// Printable keys type into the panel by themselves once it has focus. The rest are handed over.
			if (e.key.length > 1) {
				e.preventDefault();
				document.activeElement?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: e.key,
						code: e.code,
						shiftKey: e.shiftKey,
						ctrlKey: e.ctrlKey,
						metaKey: e.metaKey,
						altKey: e.altKey,
						bubbles: true,
						cancelable: true,
					}),
				);
			}
		};
		document.addEventListener("focusin", onFocusIn);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [editor, ownFocus]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new body means a new element to focus
	useEffect(() => {
		ownFocus();
	}, [ownFocus, panel]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			onClose();
			return;
		}
		if (e.key !== "Tab" || !ref.current) return;
		// Tab stays inside the panel, so it can never land in the page behind it.
		const nodes = [
			...ref.current.querySelectorAll<HTMLElement>(
				"input,textarea,button:not([disabled]),a[href]",
			),
		].filter((node) => node.tabIndex >= 0);
		if (!nodes.length) {
			e.preventDefault();
			return;
		}
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	return createPortal(
		<div
			ref={ref}
			role="dialog"
			aria-label="AI"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			// Clicks inside don't move focus out of the prompt.
			onMouseDown={(e) => {
				const tag = (e.target as HTMLElement).tagName;
				if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
			}}
			className="fixed z-50 flex max-h-[min(70vh,560px)] w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-link bg-paper shadow-[0_20px_50px_-16px_rgb(17_17_17/0.3)] outline-none max-md:!inset-x-0 max-md:!top-auto max-md:!bottom-[var(--lp-kb,0px)] max-md:!w-auto max-md:max-h-[78dvh] max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-safe"
			style={style}
		>
			{children}
		</div>,
		document.body,
	);
}

function OffBody({
	message,
	fix,
	workspaceId,
	onClose,
}: {
	message: string;
	fix: boolean;
	workspaceId: string;
	onClose: () => void;
}) {
	return (
		<div className="flex flex-col gap-3 p-4">
			<p className="flex items-start gap-2.5 text-base leading-6 text-ink">
				<span className="mt-1 shrink-0 text-amber">
					<Spark size={14} />
				</span>
				{message}
			</p>
			{fix && (
				<Link
					to="/w/$workspaceId/settings/$section"
					params={{ workspaceId, section: "ai" }}
					onClick={onClose}
					data-ai-focus
					className="self-start rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper"
				>
					Open AI settings
				</Link>
			)}
		</div>
	);
}

function MenuBody({
	items,
	placeholder,
	onBack,
	onCustom,
	onClose,
}: {
	items: MenuAction[];
	placeholder: string;
	onBack?: () => void;
	onCustom?: (text: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const q = query.trim();
	const matching = items.filter((item) =>
		item.label.toLowerCase().includes(q.toLowerCase()),
	);
	const customRow: MenuAction | null =
		q && onCustom ? { id: "__custom", label: q, run: () => onCustom(q) } : null;
	// A row that matches goes first; what the person typed is the fallback, one arrow down.
	const rows = customRow ? [...matching, customRow] : matching;
	const safeActive = rows.length ? Math.min(active, rows.length - 1) : 0;

	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${safeActive}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [safeActive]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(rows.length ? (safeActive + 1) % rows.length : 0);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(rows.length ? (safeActive - 1 + rows.length) % rows.length : 0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			rows[safeActive]?.run();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			if (onBack) onBack();
			else onClose();
		}
	};

	return (
		<>
			<div className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-rule px-3.5">
				<span className="text-link">
					<Spark size={16} />
				</span>
				<input
					data-ai-focus
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					aria-label={placeholder}
					className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-pencil"
				/>
			</div>
			<div
				ref={listRef}
				role="listbox"
				aria-label="AI actions"
				className="min-h-0 flex-1 overflow-y-auto p-1.5"
			>
				{onBack && (
					<button
						type="button"
						tabIndex={-1}
						onClick={onBack}
						className="flex h-[34px] w-full items-center rounded-[5px] px-2 text-left text-sm text-pencil hover:bg-wash coarse:h-11 coarse:text-[15px]"
					>
						Back
					</button>
				)}
				{rows.map((item, index) => (
					<button
						key={item.id}
						type="button"
						role="option"
						aria-selected={index === safeActive}
						data-index={index}
						tabIndex={-1}
						onMouseEnter={() => setActive(index)}
						onClick={item.run}
						className={`flex h-[34px] w-full items-center justify-between gap-3 rounded-[5px] px-2 text-left text-base leading-[18px] text-ink ${index === safeActive ? "bg-wash" : ""}`}
					>
						<span className="min-w-0 flex-1 truncate">
							{item.id === "__custom" ? (
								<>
									<span className="text-pencil">Ask AI: </span>
									{item.label}
								</>
							) : (
								item.label
							)}
						</span>
						{item.sub && (
							<span aria-hidden className="text-pencil">
								›
							</span>
						)}
					</button>
				))}
				{!rows.length && (
					<p className="px-2 py-2 text-sm text-pencil">
						Nothing matches. Type what you want and press Enter.
					</p>
				)}
			</div>
			<div className="shrink-0 border-t border-rule px-3.5 py-2.5 text-sm leading-4 text-graphite">
				Nothing changes in the page until you accept it.
			</div>
		</>
	);
}

const ASPECT_LABELS: Record<string, string> = {
	square: "Square",
	landscape: "Landscape",
	portrait: "Portrait",
};

function ImageBody({
	panel,
	options,
	onSubmit,
	onClose,
}: {
	panel: Extract<Panel, { kind: "image" }>;
	options: { aspects: string[]; styles: string[] };
	onSubmit: (request: ImageRequest) => void;
	onClose: () => void;
}) {
	const [prompt, setPrompt] = useState(
		panel.mode === "generate" ? panel.initial : "",
	);
	const [aspect, setAspect] = useState(options.aspects[0] ?? "");
	const [style, setStyle] = useState(options.styles[0] ?? "");
	const [empty, setEmpty] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);

	const submit = () => {
		const text = prompt.trim();
		if (!text) {
			setEmpty(true);
			ref.current?.focus();
			return;
		}
		if (panel.mode === "generate") {
			onSubmit({
				mode: "generate",
				prompt: text,
				aspect: aspect || undefined,
				style: style || undefined,
			});
		} else {
			onSubmit({
				mode: "edit",
				prompt: text,
				fileId: panel.fileId,
				pos: panel.pos,
			});
		}
	};
	const edit = panel.mode === "edit";

	return (
		<>
			<div className="flex shrink-0 gap-3 border-b border-rule px-3.5 py-3">
				{edit ? (
					<img
						src={`/api/files/${panel.fileId}`}
						alt=""
						className="h-14 w-14 shrink-0 rounded-md border border-rule object-cover"
					/>
				) : (
					<span className="mt-0.5 text-link">
						<Spark size={16} />
					</span>
				)}
				<textarea
					ref={ref}
					data-ai-focus
					value={prompt}
					rows={edit ? 2 : 3}
					onChange={(e) => {
						setPrompt(e.target.value);
						setEmpty(false);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit();
						}
					}}
					placeholder={edit ? "Describe the change" : "Describe the image"}
					aria-label={edit ? "Describe the change" : "Describe the image"}
					className="min-w-0 flex-1 resize-none bg-transparent text-base leading-[22px] text-ink outline-none placeholder:text-pencil"
				/>
			</div>
			{!edit && options.aspects.length > 1 && (
				<ChipRow
					label="Shape"
					value={aspect}
					onChange={setAspect}
					options={options.aspects.map((value) => ({
						value,
						label: ASPECT_LABELS[value] ?? value,
					}))}
				/>
			)}
			{!edit && options.styles.length > 1 && (
				<ChipRow
					label="Style"
					value={style}
					onChange={setStyle}
					options={options.styles.map((value) => ({
						value,
						label: value[0].toUpperCase() + value.slice(1),
					}))}
				/>
			)}
			<div className="flex shrink-0 items-center gap-3 border-t border-rule px-3.5 py-2.5">
				<span
					className={`min-w-0 flex-1 text-sm leading-4 ${empty ? "text-coral" : "text-graphite"}`}
				>
					{empty
						? edit
							? "Describe the change first."
							: "Describe the image first."
						: edit
							? "The original stays until you choose to replace it."
							: "Saved with this page's access when you insert it."}
				</span>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button variant="primary" size="sm" onClick={submit}>
					{edit ? "Edit" : "Generate"}
				</Button>
			</div>
		</>
	);
}

function ChipRow({
	label,
	value,
	onChange,
	options,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-rule px-3.5 py-2">
			<span className="w-12 shrink-0 text-sm text-pencil">{label}</span>
			<div
				className="flex flex-wrap gap-1.5 coarse:gap-2"
				role="radiogroup"
				aria-label={label}
			>
				{options.map((option) => (
					// biome-ignore lint/a11y/useSemanticElements: a button styled as a segment, used as a radio group
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={value === option.value}
						onClick={() => onChange(option.value)}
						className={`rounded-sm px-2 py-1 text-sm coarse:h-10 coarse:rounded-md coarse:px-3.5 coarse:text-[15px] ${value === option.value ? "bg-link-soft text-link" : "bg-wash text-graphite hover:bg-wash-2"}`}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

// ---------- The draft in the page ----------

function useElapsed(running: boolean, startedAt: number) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running]);
	return Math.max(0, Math.round((now - startedAt) / 1000));
}

function PreviewBlock(props: {
	preview: Preview;
	name: string;
	workspaceId: string;
	canManage: boolean;
	onStop: () => void;
	onStopImage: () => void;
	onRetry: () => void;
	onDiscard: () => void;
	onAccept: (p: Extract<Preview, { kind: "text" }>) => void;
	onInsertImage: (
		p: Extract<Preview, { kind: "image" }>,
		how: "insert" | "replace",
	) => void;
}) {
	const { preview } = props;
	const ref = useRef<HTMLDivElement>(null);

	// The draft takes the keyboard from the menu that opened it, so Esc works right away.
	useEffect(() => {
		if (!ref.current) return;
		ref.current.focus({ preventScroll: true });
		reveal(ref.current);
	}, []);

	// Keyboard users land on the main action once it's ready, unless they've gone back to typing.
	const ready = preview.status === "done";
	useEffect(() => {
		if (!ready || !ref.current) return;
		const active = document.activeElement;
		if (active === document.body || ref.current.contains(active)) {
			ref.current
				.querySelector<HTMLButtonElement>("[data-primary]")
				?.focus({ preventScroll: true });
			reveal(ref.current);
		}
	}, [ready]);

	// The draft sits inside the editor element, so with one of its buttons focused the browser
	// doesn't move focus on a click in the page. Letting go first means the click can take it.
	useEffect(() => {
		const onMouseDown = (e: MouseEvent) => {
			const el = ref.current;
			const active = document.activeElement as HTMLElement | null;
			if (el && active && el.contains(active) && !el.contains(e.target as Node))
				active.blur();
		};
		document.addEventListener("mousedown", onMouseDown, true);
		return () => document.removeEventListener("mousedown", onMouseDown, true);
	}, []);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			props.onDiscard();
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside handle activation; Escape is a shortcut
		<div
			ref={ref}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className="my-2 border-l-2 border-link pl-4 outline-none max-md:scroll-mb-28"
			data-testid="ai-preview"
		>
			{preview.kind === "text" ? (
				<TextPreview {...props} preview={preview} />
			) : (
				<ImagePreview {...props} preview={preview} />
			)}
		</div>
	);
}

// Brings the draft into view inside the page's own scroller. `scrollIntoView` also scrolls the
// window, which slides the whole app shell up under a fixed layout.
function reveal(el: HTMLElement) {
	let scroller = el.parentElement;
	while (scroller && scroller !== document.body) {
		const { overflowY } = getComputedStyle(scroller);
		if (overflowY === "auto" || overflowY === "scroll") break;
		scroller = scroller.parentElement;
	}
	if (!scroller || scroller === document.body) return;
	const box = el.getBoundingClientRect();
	const frame = scroller.getBoundingClientRect();
	if (box.bottom > frame.bottom)
		scroller.scrollBy({ top: box.bottom - frame.bottom + 16 });
	else if (box.top < frame.top)
		scroller.scrollBy({ top: box.top - frame.top - 16 });
}

function ActionRow({ children }: { children: ReactNode }) {
	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm leading-5">
			{children}
		</div>
	);
}

function primaryProps(label: string) {
	return {
		type: "button" as const,
		className: "font-medium text-link hover:underline",
		"data-primary": true,
		children: label,
	};
}

function secondaryProps(label: string) {
	return {
		type: "button" as const,
		className: "text-graphite hover:text-ink",
		children: label,
	};
}

function FixLink({
	canManage,
	workspaceId,
}: {
	canManage: boolean;
	workspaceId: string;
}) {
	if (!canManage) return null;
	return (
		<Link
			to="/w/$workspaceId/settings/$section"
			params={{ workspaceId, section: "ai" }}
			className="font-medium text-link hover:underline"
		>
			Fix in Settings
		</Link>
	);
}

function TextPreview({
	preview,
	name,
	onStop,
	onRetry,
	onDiscard,
	onAccept,
	canManage,
	workspaceId,
}: Parameters<typeof PreviewBlock>[0] & {
	preview: Extract<Preview, { kind: "text" }>;
}) {
	const streaming = preview.status === "streaming";
	const stopped = preview.status === "stopped";
	const failed = preview.status === "error";
	const hasText = preview.blocks.length > 0;
	const caret = streaming ? (
		<span
			aria-hidden
			className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-accent"
		/>
	) : undefined;
	const incomplete = failed && hasText;
	return (
		<>
			<div
				className="space-y-2 text-md leading-[26px] text-graphite"
				aria-live="polite"
			>
				{hasText || streaming ? (
					<BlockList blocks={preview.blocks} trailing={caret} />
				) : null}
			</div>
			<ActionRow>
				{streaming ? (
					<>
						<span className="font-medium text-link">
							AI is writing for {name}
						</span>
						<button {...secondaryProps("Stop")} onClick={onStop} />
					</>
				) : (
					<>
						{failed && (
							<span className="text-ink">
								{incomplete
									? "AI stopped before finishing"
									: preview.errorMessage}
							</span>
						)}
						{stopped && <span className="text-ink">Stopped</span>}
						{hasText && (
							<button
								{...primaryProps(
									preview.request.apply === "replace"
										? "Replace selection"
										: "Insert",
								)}
								onClick={() => onAccept(preview)}
							/>
						)}
						{failed &&
						(preview.errorCode === "bad_key" ||
							preview.errorCode === "model_missing") ? (
							<FixLink canManage={canManage} workspaceId={workspaceId} />
						) : (
							<button {...secondaryProps("Try again")} onClick={onRetry} />
						)}
						<button {...secondaryProps("Discard")} onClick={onDiscard} />
					</>
				)}
			</ActionRow>
		</>
	);
}

function ImagePreview({
	preview,
	name,
	onStopImage,
	onRetry,
	onDiscard,
	onInsertImage,
	canManage,
	workspaceId,
}: Parameters<typeof PreviewBlock>[0] & {
	preview: Extract<Preview, { kind: "image" }>;
}) {
	const running = preview.status === "running";
	const elapsed = useElapsed(running, preview.startedAt);
	const edit = preview.request.mode === "edit";
	const request = preview.request;
	const aspectRatio =
		request.mode === "generate"
			? ((
					{ square: "1 / 1", landscape: "3 / 2", portrait: "2 / 3" } as Record<
						string,
						string
					>
				)[request.aspect ?? "landscape"] ?? "3 / 2")
			: "3 / 2";
	return (
		<>
			{running && (
				<div className={edit ? "grid grid-cols-2 gap-3" : ""}>
					{edit && (
						<Figure label="Before">
							<img
								src={`/api/files/${(request as { fileId: string }).fileId}`}
								alt="Original"
								className="w-full rounded-md border border-rule object-cover"
							/>
						</Figure>
					)}
					<Figure label={edit ? "After" : undefined}>
						<div
							className="relative w-full max-w-[520px] max-h-[360px] overflow-hidden rounded-md border border-rule bg-wash-2"
							style={{ aspectRatio }}
						>
							<div className="absolute inset-0 animate-pulse bg-gradient-to-br from-wash-2 via-link-soft to-wash-2 opacity-70" />
							<div className="absolute inset-0 flex items-center justify-center text-sm text-pencil">
								{edit ? "Editing" : "Drawing"}
							</div>
						</div>
					</Figure>
				</div>
			)}
			{preview.status === "done" &&
				preview.fileId &&
				(edit ? (
					<div className="grid grid-cols-2 gap-3">
						<Figure label="Before">
							<img
								src={`/api/files/${(request as { fileId: string }).fileId}`}
								alt="Original"
								className="w-full rounded-md border border-rule object-cover"
							/>
						</Figure>
						<Figure label="After">
							<img
								src={`/api/files/${preview.fileId}`}
								alt={request.prompt}
								className="w-full rounded-md border border-rule object-cover"
							/>
						</Figure>
					</div>
				) : (
					<img
						src={`/api/files/${preview.fileId}`}
						alt={request.prompt}
						className="w-full max-w-[520px] rounded-md border border-rule"
						style={
							preview.width && preview.height
								? { aspectRatio: `${preview.width} / ${preview.height}` }
								: undefined
						}
					/>
				))}
			{preview.note && (
				<p className="mt-1.5 text-sm text-pencil">{preview.note}</p>
			)}
			<ActionRow>
				{running ? (
					<>
						<span className="font-medium text-link">
							AI is drawing for {name}
						</span>
						<span className="tabular-nums text-pencil">{elapsed} s</span>
						<button {...secondaryProps("Stop")} onClick={onStopImage} />
					</>
				) : preview.status === "error" ? (
					<>
						<span className="text-ink">{preview.errorMessage}</span>
						{preview.errorCode === "bad_key" ||
						preview.errorCode === "no_images" ? (
							<FixLink canManage={canManage} workspaceId={workspaceId} />
						) : (
							<button {...secondaryProps("Try again")} onClick={onRetry} />
						)}
						<button {...secondaryProps("Discard")} onClick={onDiscard} />
					</>
				) : edit ? (
					<>
						<button
							{...primaryProps("Replace")}
							onClick={() => onInsertImage(preview, "replace")}
						/>
						<button
							{...secondaryProps("Insert a copy")}
							onClick={() => onInsertImage(preview, "insert")}
						/>
						<button {...secondaryProps("Try again")} onClick={onRetry} />
						<button {...secondaryProps("Discard")} onClick={onDiscard} />
					</>
				) : (
					<>
						<button
							{...primaryProps("Insert")}
							onClick={() => onInsertImage(preview, "insert")}
						/>
						<button {...secondaryProps("Try again")} onClick={onRetry} />
						<button {...secondaryProps("Discard")} onClick={onDiscard} />
					</>
				)}
			</ActionRow>
		</>
	);
}

function Figure({ label, children }: { label?: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			{label && (
				<div className="mb-1 text-xs leading-4 text-pencil">{label}</div>
			)}
			{children}
		</div>
	);
}

// ---------- The margin notice (boards 8C) ----------

function AiOffNotice({
	status,
	workspaceId,
}: {
	status: { canManage: boolean };
	workspaceId: string;
}) {
	const [hidden, setHidden] = useState(false);
	if (hidden) return null;
	const owner = status.canManage;
	return (
		<aside
			aria-label="AI is off"
			className={`fixed bottom-4 right-4 z-40 w-[min(280px,calc(100vw-32px))] rounded-lg p-3.5 ${owner ? "bg-amber-soft" : "bg-wash"}`}
		>
			<div className="flex items-center gap-2 text-sm font-medium text-ink">
				<span className={owner ? "text-amber" : "text-pencil"}>
					<Spark size={13} />
				</span>
				<span className="flex-1">AI is off for now</span>
				<button
					type="button"
					aria-label="Dismiss"
					onClick={() => setHidden(true)}
					className="text-pencil hover:text-ink"
				>
					<CloseIcon />
				</button>
			</div>
			<p className="mt-1.5 text-sm leading-5 text-graphite">
				{owner
					? "The API key for this workspace stopped working. Pages and comments still work as usual."
					: "Your workspace owner can turn it back on. Pages and comments still work as usual."}
			</p>
			{owner && (
				<Link
					to="/w/$workspaceId/settings/$section"
					params={{ workspaceId, section: "ai" }}
					className="mt-2.5 inline-block rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper"
				>
					Fix in Settings
				</Link>
			)}
		</aside>
	);
}
