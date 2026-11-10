import { useNavigate } from "@tanstack/react-router";
import type { Editor, Range } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { NodeSelection } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import { EditorContent, useEditor } from "@tiptap/react";
import {
	absolutePositionToRelativePosition,
	relativePositionToAbsolutePosition,
	ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { MoreIcon, PageIcon, PlusIcon } from "#/components/icons";
import { useLive } from "#/components/shell/live-context";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Avatar,
	Button,
	Dialog,
	Menu,
	type MenuItem,
	Popover,
	Skeleton,
	useMenu,
	usePhone,
	useToast,
} from "#/components/ui";
import { useAiStatus } from "#/features/ai/client";
import { EditorAiLayer } from "#/features/ai/editor-ai";
import { fetchPeople } from "#/functions/body";
import type { CommentAnchor } from "#/functions/comments";
import { submitComment, submitMention } from "#/functions/comments";
import { uploadFile } from "#/functions/files";
import { listPresences } from "#/lib/browser-appwrite";
import { errorText } from "#/lib/errors";
import { canWriteDirect, displayName } from "#/lib/permissions";
import type { Page } from "#/lib/types";
import type { PageAccess, Person } from "#/server/body";
import { levelFor } from "./access";
import { BlockControls, blockAt, duplicateBlock } from "./BlockControls";
import { BubbleToolbar } from "./BubbleToolbar";
import {
	CommentsRail,
	type MentionPerson,
	type RailThread,
	ThreadComposer,
} from "./CommentsRail";
import { parseCaret } from "./codec";
import {
	bodyExtensions,
	commentsKey,
	type HighlightThread,
	type MentionItem,
	type SlashItem,
	titleExtensions,
} from "./extensions";
import { HistoryView } from "./HistoryView";
import { MobileBar } from "./MobileBar";
import { DateIcon } from "./menu-icons";
import { moveBlockTo } from "./move-block";
import { EMOJI, fileUrl } from "./node-views";
import { Popup, PopupStore } from "./popup";
import { filterSlash, slashItems } from "./slash-items";
import { PageSync, type SaveState } from "./sync";
import { TableTools } from "./TableTools";
import { useCommentAnchors } from "./useCommentAnchors";
import { groupThreads, type Thread, useComments } from "./useComments";

// Same order as colorFor in components/ui, in hex because the caret plugin only accepts hex.
const CARET_COLORS = ["#E5402F", "#7A3FF2", "#0E8A5F", "#B86E00", "#1F3DFF"];

function relativeFor(editor: Editor, pos: number) {
	const y = ySyncPluginKey.getState(editor.state);
	if (!y) throw new Error("The editor isn't ready yet.");
	return JSON.stringify(
		Y.relativePositionToJSON(
			absolutePositionToRelativePosition(pos, y.type, y.binding.mapping),
		),
	);
}

function caretColor(id: string) {
	let hash = 0;
	for (let i = 0; i < id.length; i++)
		hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
	return CARET_COLORS[hash % CARET_COLORS.length];
}

export function PageEditor({
	access,
	header,
}: {
	access: PageAccess;
	// Shown under the title on database rows: the properties of the row.
	header?: React.ReactNode;
}) {
	const { viewer, workspace, peers, pages } = useWorkspace();
	const { connection, onReconnect } = useLive();
	const { page } = access;
	const [sync, setSync] = useState<PageSync | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: one sync per page and connection; the other values are fixed for a visit
	useEffect(() => {
		if (!connection) return;
		const instance = new PageSync({
			page,
			userId: viewer.userId,
			name: viewer.name,
			color: caretColor(viewer.userId),
			connection,
			direct: access.canWriteDirect,
			editable: access.canEdit,
			onState: setSaveState,
		});
		let stopped = false;
		instance.start().then(
			() => {
				if (stopped) return;
				setSync(instance);
				instance.publishPresence();
				void loadCarets(instance, page.id);
			},
			(err) => setError(errorText(err)),
		);
		const hide = () => instance.flushOnExit();
		const online = () => instance.setOnline(true);
		const offline = () => instance.setOnline(false);
		const visible = () => instance.publishPresence();
		window.addEventListener("pagehide", hide);
		window.addEventListener("online", online);
		window.addEventListener("offline", offline);
		document.addEventListener("visibilitychange", visible);
		const off = onReconnect(() => void instance.resync());
		return () => {
			stopped = true;
			off();
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("online", online);
			window.removeEventListener("offline", offline);
			document.removeEventListener("visibilitychange", visible);
			instance.destroy();
			setSync(null);
		};
		// One editor session per page and connection.
	}, [connection, page.id]);

	// A database row takes its access from its database, which is the one in the live list.
	const liveId = page.kind === "row" ? page.databaseId : page.id;
	const live = pages.find((p) => p.id === liveId);
	const liveAccess = live
		? `${live.visibility}:${JSON.stringify(live.shares)}`
		: null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: liveAccess is the part of the live page that matters here
	useEffect(() => {
		if (!sync || !live) return;
		const next = { ...page, visibility: live.visibility, shares: live.shares };
		const { role } = workspace;
		sync.setPage(next, {
			direct: canWriteDirect(next, { userId: viewer.userId, role }),
			editable:
				levelFor(next, viewer.userId, role) === "edit" && !next.trashedAt,
		});
	}, [liveAccess, sync]);

	// A caret disappears when its person leaves this page.
	const hereKey = peers
		.filter((p) => p.pageId === page.id)
		.map((p) => p.userId)
		.sort()
		.join(",");
	useEffect(() => {
		if (!sync) return;
		const here = new Set(hereKey ? hereKey.split(",") : []);
		const gone = new Set<string>();
		for (const state of sync.awareness.getStates().values()) {
			const userId = (state as { userId?: string }).userId;
			if (userId && !here.has(userId)) gone.add(userId);
		}
		for (const userId of gone) sync.dropCarets(userId);
	}, [hereKey, sync]);

	if (error)
		return (
			<div className="mx-auto max-w-[560px] px-6 pt-20">
				<h1 className="text-xl">This page didn't load.</h1>
				<p className="mt-2 text-graphite">{error}</p>
				<Button className="mt-4" onClick={() => location.reload()}>
					Try again
				</Button>
			</div>
		);
	if (!sync)
		return (
			<div className="px-[88px] pt-14 max-lg:px-4 max-lg:pt-5" aria-busy="true">
				<Skeleton className="h-12 w-1/2" />
				<Skeleton className="mt-6 h-4 w-3/4" />
				<Skeleton className="mt-3 h-4 w-2/3" />
				<Skeleton className="mt-3 h-4 w-3/5" />
			</div>
		);
	return (
		<LiveEditors
			key={page.id}
			access={access}
			sync={sync}
			saveState={saveState}
			header={header}
			workspaceId={workspace.id}
		/>
	);
}

async function loadCarets(sync: PageSync, pageId: string) {
	try {
		const rows = await listPresences();
		for (const row of rows) {
			const meta = row.metadata as {
				pageId?: string;
				clientId?: string;
				cursor?: string;
			};
			if (meta?.pageId !== pageId) continue;
			sync.applyPresenceCaret(meta.clientId ?? null, parseCaret(meta.cursor));
		}
	} catch {
		// Carets show up on the next caret move anyway.
	}
}

const SAVE_LABELS: Record<SaveState, string> = {
	saved: "Saved",
	saving: "Saving",
	offline: "Saved on this device",
	failed: "Couldn't save. Retrying.",
	denied: "Can't save. You don't have edit access.",
	"too-large":
		"This page is too large to save. Remove something large and it will save again.",
};

function LiveEditors({
	access,
	sync,
	saveState,
	header,
	workspaceId,
}: {
	access: PageAccess;
	sync: PageSync;
	saveState: SaveState;
	header?: React.ReactNode;
	workspaceId: string;
}) {
	const navigate = useNavigate();
	const { viewer, pages, peers, createPage, updatePage } = useWorkspace();
	// The cover and icon are live: `access` is what the page loaded with. A patch shows the change right away;
	// it is dropped once the live list has caught up (database rows aren't in that list, so it stays).
	const live = pages.find((p) => p.id === access.page.id);
	const [patch, setPatch] = useState<
		Partial<Pick<Page, "icon" | "coverFileId">>
	>({});
	// biome-ignore lint/correctness/useExhaustiveDependencies: clears the patch when the live values change
	useEffect(() => {
		setPatch({});
	}, [live?.icon, live?.coverFileId]);
	const page: Page = {
		...access.page,
		...(live
			? { title: live.title, icon: live.icon, coverFileId: live.coverFileId }
			: {}),
		...patch,
	};
	const patchPage = (changes: Partial<Pick<Page, "icon" | "coverFileId">>) => {
		setPatch((prev) => ({ ...prev, ...changes }));
		updatePage(page.id, changes);
	};
	const toast = useToast();
	const [showHistory, setShowHistory] = useState(false);
	const canEdit = access.canEdit && saveState !== "denied";

	const aiReady = useRef<string | undefined>(undefined);
	const aiStatus = useAiStatus(workspaceId);
	aiReady.current = aiStatus?.state;

	const pagesRef = useRef(pages);
	pagesRef.current = pages;
	const peersRef = useRef(peers);
	peersRef.current = peers;

	const [members, setMembers] = useState<Person[]>([]);
	useEffect(() => {
		fetchPeople({ data: { workspaceId } }).then(setMembers, () => undefined);
	}, [workspaceId]);
	const people = useMemo<MentionPerson[]>(() => {
		const here = new Set(
			peers.filter((p) => p.pageId === page.id).map((p) => p.userId),
		);
		return members
			.filter((m) => m.userId !== viewer.userId && m.confirmed)
			.map((m) => ({
				id: m.userId,
				name: m.name || m.email,
				here: here.has(m.userId),
			}));
	}, [members, peers, page.id, viewer.userId]);
	const peopleRef = useRef(people);
	peopleRef.current = people;

	// ---------- comments ----------

	const {
		comments,
		setComments,
		reload: reloadComments,
	} = useComments(page.id);
	const threads = useMemo(
		() => groupThreads(comments).filter((t) => !t.resolved),
		[comments],
	);
	const threadsRef = useRef<Thread[]>(threads);
	threadsRef.current = threads;

	type Draft = { anchor: CommentAnchor; from: number; to: number };
	const [draft, setDraft] = useState<Draft | null>(null);
	const draftRef = useRef<Draft | null>(null);
	draftRef.current = draft;
	const [activeThread, setActiveThread] = useState<string | null>(null);
	const activeRef = useRef<string | null>(null);
	activeRef.current = activeThread;

	const absolute = useCallback((editor: Editor, encoded: string) => {
		const y = ySyncPluginKey.getState(editor.state);
		if (!y?.binding || !encoded) return null;
		try {
			return relativePositionToAbsolutePosition(
				y.doc,
				y.type,
				Y.createRelativePositionFromJSON(JSON.parse(encoded)),
				y.binding.mapping,
			);
		} catch {
			return null;
		}
	}, []);

	const resolveComments = useCallback(
		(editor: Editor): HighlightThread[] => {
			const out: HighlightThread[] = [];
			for (const thread of threadsRef.current) {
				const anchor = thread.root.anchor;
				if (!anchor) continue;
				const from = absolute(editor, anchor.from);
				const to = absolute(editor, anchor.to);
				if (from !== null && to !== null && from < to)
					out.push({ id: thread.id, from, to });
			}
			const pending = draftRef.current;
			if (pending) {
				const from = absolute(editor, pending.anchor.from);
				const to = absolute(editor, pending.anchor.to);
				if (from !== null && to !== null && from < to)
					out.push({ id: "__draft", from, to });
			}
			return out;
		},
		[absolute],
	);

	const pushHighlights = useCallback(
		(editor: Editor | null) => {
			if (!editor || editor.isDestroyed) return;
			editor.view.dispatch(
				editor.state.tr.setMeta(commentsKey, {
					threads: resolveComments(editor),
					active: activeRef.current,
				}),
			);
		},
		[resolveComments],
	);

	const startComment = useCallback(
		(editor: Editor, from: number, to: number) => {
			if (from >= to) return;
			setDraft({
				from,
				to,
				anchor: {
					from: relativeFor(editor, from),
					to: relativeFor(editor, to),
					quote: editor.state.doc
						.textBetween(from, to, "\n", " ")
						.slice(0, 2000),
				},
			});
			setActiveThread(null);
		},
		[],
	);

	// ---------- picker for inserting a block page link or database embed through the [[ picker ----------

	const blockPick = useRef<"pageLink" | "databaseEmbed" | null>(null);

	// ---------- uploads ----------

	const fileInputs = useRef<{
		image: HTMLInputElement | null;
		file: HTMLInputElement | null;
	}>({
		image: null,
		file: null,
	});
	const pendingInsert = useRef<number | null>(null);

	const upload = useCallback(
		(files: File[], pos: number, ed: Editor | null) => {
			const editor = ed ?? bodyRef.current;
			if (!editor || !files.length) return;
			const y = ySyncPluginKey.getState(editor.state);
			const relativePos =
				y?.binding && pos <= editor.state.doc.content.size
					? absolutePositionToRelativePosition(pos, y.type, y.binding.mapping)
					: null;
			toast.show(
				`Uploading ${files.length === 1 ? files[0].name : `${files.length} files`}`,
			);
			void Promise.all(
				files.map(async (file) => {
					const form = new FormData();
					form.set("pageId", page.id);
					form.set("file", file);
					const saved = await uploadFile({ data: form });
					const live = ySyncPluginKey.getState(editor.state);
					const at =
						relativePos && live?.binding
							? (relativePositionToAbsolutePosition(
									live.doc,
									live.type,
									relativePos,
									live.binding.mapping,
								) ?? editor.state.selection.from)
							: editor.state.selection.from;
					const node = file.type.startsWith("image/")
						? {
								type: "image",
								attrs: { fileId: saved.fileId, alt: file.name },
							}
						: {
								type: "attachment",
								attrs: {
									fileId: saved.fileId,
									name: saved.name,
									size: saved.size,
									mimeType: saved.mimeType,
								},
							};
					editor.chain().focus().insertContentAt(at, node).run();
				}),
			).catch((err) => toast.show(errorText(err), { tone: "error" }));
		},
		[page.id, toast],
	);

	// ---------- slash and mention menus ----------

	const aiImagesRef = useRef(false);
	aiImagesRef.current = aiStatus?.state === "ready" && aiStatus.images;

	const slashStore = useMemo(() => new PopupStore<SlashItem>(), []);
	const mentionStore = useMemo(() => new PopupStore<MentionItem>(), []);

	const startBlockPick = useCallback(
		(editor: Editor, range: Range, kind: "pageLink" | "databaseEmbed") => {
			blockPick.current = kind;
			editor.chain().focus().deleteRange(range).insertContent("[[").run();
		},
		[],
	);

	const items = useMemo(
		() =>
			slashItems({
				aiWrite: () =>
					window.dispatchEvent(
						new CustomEvent("livepage:ai", { detail: { action: "write" } }),
					),
				aiImage: () =>
					window.dispatchEvent(
						new CustomEvent("livepage:ai", {
							detail: { action: "image-generate" },
						}),
					),
				pickImage: (editor) => {
					pendingInsert.current = editor.state.selection.from;
					fileInputs.current.image?.click();
				},
				pickFile: (editor) => {
					pendingInsert.current = editor.state.selection.from;
					fileInputs.current.file?.click();
				},
				linkPage: (editor, range) => startBlockPick(editor, range, "pageLink"),
				linkDatabase: (editor, range) =>
					startBlockPick(editor, range, "databaseEmbed"),
				newDatabase: (editor) => {
					void createPage({
						title: "",
						kind: "database",
						parentId: page.id,
					}).then((created) => {
						if (!created) return;
						editor
							.chain()
							.focus()
							.insertContent({
								type: "databaseEmbed",
								attrs: { databaseId: created.id, title: "Untitled" },
							})
							.run();
					});
				},
			}),
		[createPage, page.id, startBlockPick],
	);

	const mentionItems = useCallback(
		(query: string, char: string): MentionItem[] => {
			const q = query.trim().toLowerCase();
			const block = blockPick.current;
			const candidates = pagesRef.current
				.filter(
					(p) =>
						p.id !== page.id &&
						(block === "databaseEmbed"
							? p.kind === "database"
							: p.kind !== "row"),
				)
				.filter((p) => displayName(p).toLowerCase().includes(q))
				.slice(0, 6)
				.map<MentionItem>((p) => {
					const parent = pagesRef.current.find((x) => x.id === p.parentId);
					return {
						group: "Pages",
						kind: "page",
						id: p.id,
						label: displayName(p),
						detail: parent ? displayName(parent) : undefined,
					};
				});
			if (char === "[[" || block) return candidates;
			const person = peopleRef.current
				.filter((p) => p.name.toLowerCase().includes(q))
				.sort((a, b) => Number(b.here) - Number(a.here))
				.slice(0, 5)
				.map<MentionItem>((p) => ({
					group: "People",
					kind: "person",
					id: p.id,
					label: p.name,
					here: p.here,
				}));
			const date = (offset: number) => {
				const d = new Date(Date.now() + offset * 86_400_000);
				return d.toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
					year: "numeric",
				});
			};
			const dates = (
				[
					{
						group: "Dates",
						kind: "date",
						id: "today",
						label: "Today",
						detail: date(0),
					},
					{
						group: "Dates",
						kind: "date",
						id: "tomorrow",
						label: "Tomorrow",
						detail: date(1),
					},
					{
						group: "Dates",
						kind: "date",
						id: "next-week",
						label: "Next week",
						detail: date(7),
					},
				] satisfies MentionItem[]
			).filter((d) => d.label.toLowerCase().includes(q));
			return [...person, ...candidates, ...dates];
		},
		[page.id],
	);

	// Escape or clicking away from a block picker: the "[[" typed for it goes too.
	const dismissMention = useCallback((editor: Editor, range: Range) => {
		if (!blockPick.current) return;
		blockPick.current = null;
		editor.chain().focus().deleteRange(range).run();
	}, []);

	const insertMention = useCallback(
		(editor: Editor, range: Range, item: MentionItem) => {
			const kind = blockPick.current;
			if (!kind || item.kind !== "page") return false;
			blockPick.current = null;
			const attrs =
				kind === "pageLink"
					? { pageId: item.id, title: item.label }
					: { databaseId: item.id, title: item.label };
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent({ type: kind, attrs })
				.run();
			return true;
		},
		[],
	);

	const onMentionPicked = useCallback(
		(item: MentionItem) => {
			if (item.kind !== "person") return;
			void submitMention({ data: { pageId: page.id, userId: item.id } }).catch(
				() => undefined,
			);
		},
		[page.id],
	);

	// ---------- editors ----------

	const body = useEditor(
		{
			immediatelyRender: false,
			editable: canEdit,
			extensions: bodyExtensions({
				doc: sync.doc,
				awareness: sync.awareness,
				userId: viewer.userId,
				upload: (files, pos) => upload(files, pos, null),
				slashStore,
				slashItems: (query) => {
					const editor = bodyRef.current;
					return filterSlash(items, query, {
						inTable: Boolean(editor?.isActive("table")),
						aiImages: aiImagesRef.current,
					});
				},
				onAiSpace: () => {
					// Ask AI straight from an empty slash: the slash character goes away first.
					const editor = bodyRef.current;
					if (!editor) return;
					editor
						.chain()
						.focus()
						.deleteRange({
							from: editor.state.selection.from - 1,
							to: editor.state.selection.from,
						})
						.run();
					window.dispatchEvent(
						new CustomEvent("livepage:ai", { detail: { action: "write" } }),
					);
				},
				onAiEmptyLine: () => {
					if (aiReady.current !== "ready") return false;
					window.dispatchEvent(
						new CustomEvent("livepage:ai", { detail: { action: "write" } }),
					);
					return true;
				},
				mentionStore,
				mentionItems,
				onMention: onMentionPicked,
				insertMention,
				dismissMention,
				resolveComments: (editor) => resolveComments(editor),
				placeholder: () => {
					if (!canEdit) return "This page is empty.";
					return aiReady.current === "ready"
						? "Write something, or type / for blocks and AI"
						: "Write something, or type / for blocks";
				},
			}),
			editorProps: {
				attributes: {
					class: "lp-prose lp-editor",
					"aria-label": "Page content",
				},
				// A block dragged by its handle moves in the Yjs document, like the menu's Move to.
				handleDrop: (view, event, slice, moved) => {
					const editor = bodyRef.current;
					const { selection, doc } = view.state;
					if (
						!editor ||
						!moved ||
						!(selection instanceof NodeSelection) ||
						selection.$from.depth !== 0
					)
						return false;
					const at = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					if (!at) return false;
					const $drop = doc.resolve(dropPoint(doc, at.pos, slice) ?? at.pos);
					if ($drop.depth !== 0) return false;
					const from = selection.$from.index(0);
					const insert = $drop.index(0);
					moveBlockTo(editor, from, insert > from ? insert - 1 : insert);
					return true;
				},
				handleClick: (_view, _pos, event) => {
					const target = event.target as HTMLElement;
					const hit = target.closest("[data-thread]");
					if (hit) {
						const id = hit.getAttribute("data-thread");
						if (id && id !== "__draft") setActiveThread(id);
					}
					const mention = target.closest('[data-mention][data-kind="page"]');
					const pageId = mention?.getAttribute("data-mention");
					if (pageId) {
						void navigate({ to: "/p/$pageId", params: { pageId } });
						return true;
					}
					return false;
				},
				handleKeyDown: (view, event) => {
					const mod = event.metaKey || event.ctrlKey;
					const editor = bodyRef.current;
					if (!editor) return false;
					if (mod && event.key === "d") {
						event.preventDefault();
						const found = blockAt(editor, view.state.selection.from);
						if (found) duplicateBlock(editor, found.pos);
						return true;
					}
					if (
						mod &&
						event.shiftKey &&
						(event.key === "M" || event.key === "m")
					) {
						event.preventDefault();
						const { from, to, empty } = view.state.selection;
						if (!empty) {
							startComment(editor, from, to);
							return true;
						}
						// No selection: comment on the block the caret is in, as the block menu does.
						const found = blockAt(editor, from);
						if (found?.node.textContent)
							startComment(
								editor,
								found.pos + 1,
								found.pos + found.node.nodeSize - 1,
							);
						return true;
					}
					return false;
				},
			},
		},
		[sync],
	);
	const bodyRef = useRef<Editor | null>(null);
	bodyRef.current = body;

	useCommentAnchors({
		editor: body,
		pageId: page.id,
		comments,
		setComments,
		draft: draft?.anchor ?? null,
		setDraft: (anchor) => setDraft((d) => (d ? { ...d, anchor } : d)),
		absolute,
		relativeFor,
	});

	const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const titleSyncedAt = useRef(0);
	const title = useEditor(
		{
			immediatelyRender: false,
			editable: canEdit,
			extensions: titleExtensions(sync.doc, "New page"),
			editorProps: {
				attributes: { class: "lp-title", "aria-label": "Page title" },
				handleKeyDown: (_view, event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						// Tiptap's focus command waits a frame, so keys typed right after Enter would still
						// land in the title. Move DOM focus now, then place the caret.
						bodyRef.current?.view.focus();
						bodyRef.current?.commands.focus("start");
						return true;
					}
					return false;
				},
			},
			onUpdate: ({ editor, transaction }) => {
				if (isChangeOrigin(transaction)) {
					titleSyncedAt.current = Date.now();
					return;
				}
				// Only typing in the title writes the row. Loading the document or bringing it up to
				// date after a rename must not.
				if (!editor.isFocused) return;
				if (titleTimer.current) clearTimeout(titleTimer.current);
				const text = editor.getText();
				titleTimer.current = setTimeout(() => {
					updatePage(page.id, { title: text });
				}, 800);
			},
		},
		[sync],
	);

	useEffect(() => {
		body?.setEditable(canEdit);
		title?.setEditable(canEdit);
	}, [canEdit, body, title]);

	// The empty-page hint names AI only when it's on, and the answer arrives after the editor is up.
	const aiState = aiStatus?.state;
	useEffect(() => {
		if (!body || body.isDestroyed || !aiState) return;
		body.view.dispatch(body.state.tr.setSelection(body.state.selection));
	}, [body, aiState]);

	// A rename from the sidebar or an agent only writes the row, so the title in the document catches
	// up here. Not while someone is typing it, here or on another screen, because the row lags behind
	// them. The random wait keeps two open tabs from both rewriting it.
	const liveTitle = pages.find((p) => p.id === page.id)?.title ?? page.title;
	useEffect(() => {
		if (!title || !canEdit || !liveTitle) return;
		const timer = setTimeout(() => {
			if (title.isDestroyed || title.isFocused) return;
			if (title.getText() === liveTitle) return;
			if (Date.now() - titleSyncedAt.current < 2500) return;
			title.commands.setContent({
				type: "doc",
				content: [
					{ type: "paragraph", content: [{ type: "text", text: liveTitle }] },
				],
			});
		}, Math.random() * 800);
		return () => clearTimeout(timer);
	}, [title, canEdit, liveTitle]);

	// Scroll to a block when the link points at one.
	useEffect(() => {
		if (!body || !location.hash) return;
		const el = document.getElementById(location.hash.slice(1));
		el?.scrollIntoView({ block: "center" });
	}, [body]);

	// The browser tab shows the page's title.
	const browserTitle = `${displayName(page)} · Livepage`;
	useEffect(() => {
		document.title = browserTitle;
	}, [browserTitle]);

	// ---------- comment positions ----------

	const railRef = useRef<HTMLDivElement>(null);
	const editorWrapRef = useRef<HTMLDivElement>(null);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const [positions, setPositions] = useState<{
		tops: Map<string, number | null>;
		composerTop: number | null;
		activeTop: number | null;
	}>({ tops: new Map(), composerTop: null, activeTop: null });

	const recalc = useCallback(() => {
		const editor = bodyRef.current;
		const rail = railRef.current;
		if (!editor || editor.isDestroyed || !rail) return;
		const railTop = rail.getBoundingClientRect().top;
		const topOf = (pos: number | null) => {
			if (pos === null) return null;
			try {
				return editor.view.coordsAtPos(pos).top - railTop - 2;
			} catch {
				return null;
			}
		};
		const tops = new Map<string, number | null>();
		let bottom = 0;
		for (const thread of threadsRef.current) {
			const from = thread.root.anchor
				? absolute(editor, thread.root.anchor.from)
				: null;
			const top = topOf(from);
			tops.set(thread.id, top);
			if (top !== null) bottom = Math.max(bottom, top);
		}
		// A comment whose text was deleted stays, at the end, instead of vanishing.
		for (const [id, top] of tops) if (top === null) tops.set(id, bottom + 240);
		const pending = draftRef.current;
		const composerTop = pending
			? topOf(absolute(editor, pending.anchor.from))
			: null;
		const active = activeRef.current;
		const activeTop = active ? (tops.get(active) ?? null) : null;
		setPositions({ tops, composerTop, activeTop });
	}, [absolute]);

	const frame = useRef(0);
	const scheduleRecalc = useCallback(() => {
		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(recalc);
	}, [recalc]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: recalculates when comments or the active thread change
	useEffect(() => {
		pushHighlights(body);
		scheduleRecalc();
	}, [body, threads, draft, activeThread]);

	useEffect(() => {
		if (!body) return;
		body.on("update", scheduleRecalc);
		const dom = body.view.dom;
		const observer = new ResizeObserver(scheduleRecalc);
		observer.observe(dom);
		return () => {
			body.off("update", scheduleRecalc);
			observer.disconnect();
		};
	}, [body, scheduleRecalc]);

	const railThreads: RailThread[] = useMemo(
		() => threads.map((t) => ({ ...t, top: positions.tops.get(t.id) ?? null })),
		[threads, positions],
	);

	const composer =
		draft && body ? (
			<ThreadComposer
				people={people}
				quote={draft.anchor.quote}
				onCancel={() => setDraft(null)}
				onSubmit={async (text, mentions) => {
					const created = await submitComment({
						data: {
							pageId: page.id,
							body: text,
							anchor: draft.anchor,
							mentions,
						},
					});
					setDraft(null);
					setActiveThread((created as { threadId: string }).threadId);
					await reloadComments();
				}}
			/>
		) : null;

	const [sheetOpen, setSheetOpen] = useState(false);

	// The rail doesn't fit on narrow screens, so a new comment or a tapped highlight opens the sheet.
	useEffect(() => {
		if ((draft || activeThread) && window.innerWidth <= 1100)
			setSheetOpen(true);
	}, [draft, activeThread]);

	if (!body || !title)
		return (
			<div
				className="max-w-[760px] px-[88px] pt-14 max-lg:px-4 max-lg:pt-5"
				aria-busy="true"
			>
				<Skeleton className="h-12 w-3/5" />
				<Skeleton className="mt-6 h-4 w-2/5" />
				<Skeleton className="mt-8 h-4 w-full" />
				<Skeleton className="mt-3 h-4 w-11/12" />
				<Skeleton className="mt-3 h-4 w-4/5" />
			</div>
		);

	const isRow = page.kind === "row";

	return (
		<>
			<TopBarActions>
				<SaveIndicator state={saveState} />
				{!canEdit && saveState !== "denied" && (
					<span className="rounded-sm bg-wash-2 px-1.5 py-0.5 text-[13px] text-graphite">
						{access.canComment ? "Comment only" : "View only"}
					</span>
				)}
				<PageMenu
					onHistory={() => setShowHistory(true)}
					commentCount={threads.length}
					onComments={() => setSheetOpen(true)}
				/>
			</TopBarActions>
			<div className={showHistory ? "hidden" : "flex min-h-full"}>
				<div
					ref={editorWrapRef}
					className="relative min-w-0 flex-1 pr-14 pl-[88px] max-lg:px-4"
				>
					<PageCover page={page} canEdit={canEdit} update={patchPage} />
					<div className="pt-14 pb-32 max-lg:pt-5 max-lg:pb-40">
						<PageHead
							page={page}
							canEdit={canEdit}
							title={title}
							update={patchPage}
						/>
						{isRow ? (
							<div className="pt-3 pb-6">{header}</div>
						) : (
							<Byline page={page} members={members} />
						)}
						<EditorSurface editor={body} surfaceRef={surfaceRef}>
							{body && (
								<>
									<BlockControls
										editor={body}
										containerRef={editorWrapRef}
										surfaceRef={surfaceRef}
										onComment={(from, to) => startComment(body, from, to)}
										pageUrl={`${location.origin}/p/${page.id}`}
									/>
									<BubbleToolbar
										editor={body}
										canEdit={canEdit}
										canComment={access.canComment}
										onComment={() => {
											const { from, to } = body.state.selection;
											startComment(body, from, to);
										}}
									/>
									<TableTools
										editor={body}
										canEdit={canEdit}
										surfaceRef={surfaceRef}
									/>
									<MobileCommentMarks
										editor={body}
										threads={threads}
										absolute={absolute}
										onOpen={setActiveThread}
									/>
									<MobileBar
										editor={body}
										canEdit={canEdit}
										canComment={access.canComment}
										pageUrl={`${location.origin}/p/${page.id}`}
										onComment={(from, to) => startComment(body, from, to)}
										onComments={() => setSheetOpen(true)}
									/>
								</>
							)}
						</EditorSurface>
					</div>
				</div>
				<div
					ref={railRef}
					data-comment-rail=""
					className="relative w-[320px] shrink-0 border-l border-rule max-[1100px]:hidden"
				>
					<CommentsRail
						threads={railThreads}
						activeId={activeThread}
						onActivate={(id) => setActiveThread(id)}
						pageId={page.id}
						canComment={access.canComment}
						people={people}
						composer={composer}
						composerTop={positions.composerTop}
						onChanged={reloadComments}
						lineTop={positions.activeTop}
					/>
				</div>
			</div>
			{showHistory && (
				<HistoryView
					pageId={page.id}
					editor={body}
					titleEditor={title}
					doc={sync.doc}
					canEdit={canEdit}
					fileHref={(fileId) => fileUrl(fileId)}
					onClose={() => setShowHistory(false)}
				/>
			)}
			<Popup
				store={slashStore}
				width={340}
				label="Blocks"
				render={(item, index, selected, choose, hover) => (
					<SlashRow
						item={item}
						first={index === 0}
						selected={selected}
						onChoose={choose}
						onHover={hover}
						group={groupLabel(slashStore, index)}
					/>
				)}
			/>
			<Popup
				store={mentionStore}
				width={320}
				label="Mention or link a page"
				render={(item, index, selected, choose, hover) => (
					<MentionRow
						item={item}
						selected={selected}
						onChoose={choose}
						onHover={hover}
						group={mentionGroup(mentionStore, index)}
					/>
				)}
			/>
			<input
				ref={(el) => {
					fileInputs.current.image = el;
				}}
				type="file"
				accept="image/*"
				multiple
				hidden
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (files.length && body)
						upload(
							files,
							pendingInsert.current ?? body.state.selection.from,
							body,
						);
				}}
			/>
			<input
				ref={(el) => {
					fileInputs.current.file = el;
				}}
				type="file"
				multiple
				hidden
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (files.length && body)
						upload(
							files,
							pendingInsert.current ?? body.state.selection.from,
							body,
						);
				}}
			/>
			<Dialog
				open={sheetOpen}
				onClose={() => {
					setSheetOpen(false);
					setDraft(null);
					setActiveThread(null);
				}}
				title="Comments"
				width={420}
			>
				<div className="flex flex-col gap-4">
					{composer}
					{threads.length === 0 && !composer && (
						<p className="text-sm text-pencil">No comments on this page yet.</p>
					)}
					{railThreads.map((t) => (
						<div key={t.id} className="relative">
							<CommentsRail
								flow
								threads={[{ ...t, top: 0 }]}
								activeId={activeThread ?? t.id}
								onActivate={setActiveThread}
								pageId={page.id}
								canComment={access.canComment}
								people={people}
								composer={null}
								composerTop={null}
								onChanged={reloadComments}
								lineTop={null}
							/>
						</div>
					))}
				</div>
			</Dialog>
			{body && (
				<EditorAiLayer
					editor={body}
					pageId={page.id}
					workspaceId={workspaceId}
				/>
			)}
		</>
	);
}

// On narrow screens the comment rail is gone, so each anchored comment shows a face at the
// end of its line (board 93); tapping it opens the thread.
function MobileCommentMarks({
	editor,
	threads,
	absolute,
	onOpen,
}: {
	editor: Editor;
	threads: {
		id: string;
		root: {
			authorName: string;
			createdBy: string;
			anchor: { from: string } | null;
		};
		replies?: unknown[];
	}[];
	absolute: (editor: Editor, encoded: string) => number | null;
	onOpen: (id: string) => void;
}) {
	const [marks, setMarks] = useState<
		{ id: string; top: number; name: string; by: string; count: number }[]
	>([]);
	useEffect(() => {
		const update = () => {
			// Reading a position makes the browser lay out the page, which takes minutes on a huge one.
			if (!threads.length) {
				setMarks((prev) => (prev.length ? [] : prev));
				return;
			}
			const surface = editor.view.dom.closest(".lp-editor-surface");
			if (!surface) return;
			const top0 = surface.getBoundingClientRect().top;
			const next = threads.flatMap((t) => {
				if (!t.root.anchor) return [];
				const pos = absolute(editor, t.root.anchor.from);
				if (pos === null) return [];
				try {
					const coords = editor.view.coordsAtPos(pos);
					return [
						{
							id: t.id,
							top: coords.top - top0,
							name: t.root.authorName,
							by: t.root.createdBy,
							count: 1 + (t.replies?.length ?? 0),
						},
					];
				} catch {
					return [];
				}
			});
			setMarks(next);
		};
		update();
		editor.on("update", update);
		const observer = new ResizeObserver(update);
		observer.observe(editor.view.dom);
		return () => {
			editor.off("update", update);
			observer.disconnect();
		};
	}, [editor, threads, absolute]);
	return (
		<>
			{marks.map((m) => (
				<button
					key={m.id}
					type="button"
					onClick={() => onOpen(m.id)}
					className="absolute right-0 flex h-[26px] items-center gap-1 text-sm text-graphite before:absolute before:-inset-x-[10px] before:-inset-y-[7px] min-[1101px]:hidden"
					style={{ top: m.top }}
				>
					<span className="sr-only">Open comment from {m.name}</span>
					<span aria-hidden="true" className="contents">
						<Avatar id={m.by} name={m.name} size={20} />
					</span>
					{m.count > 1 && <span>{m.count}</span>}
				</button>
			))}
		</>
	);
}

function groupLabel(store: PopupStore<SlashItem>, index: number) {
	const { items } = store.getSnapshot();
	const group = items[index]?.group;
	return group && group !== items[index - 1]?.group ? group : null;
}

function mentionGroup(store: PopupStore<MentionItem>, index: number) {
	const { items } = store.getSnapshot();
	const group = items[index]?.group;
	return group && group !== items[index - 1]?.group ? group : null;
}

function SlashRow({
	item,
	selected,
	first,
	onChoose,
	onHover,
	group,
}: {
	item: SlashItem;
	first: boolean;
	selected: boolean;
	onChoose: () => void;
	onHover: () => void;
	group: string | null;
}) {
	const isAi = item.id === "ai" || item.id === "generate-image";
	return (
		<>
			{group && (
				<div className="px-2 pt-2 pb-1 text-[12px] font-medium text-pencil">
					{group}
				</div>
			)}
			<button
				type="button"
				onMouseDown={(e) => {
					e.preventDefault();
					onChoose();
				}}
				onMouseMove={onHover}
				data-selected={selected}
				className={`flex h-[34px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[14px] coarse:h-11 coarse:text-[15px] ${selected ? (isAi ? "bg-link-soft" : "bg-wash-2") : ""} ${isAi ? "text-link" : "text-ink"} ${first ? "font-medium" : ""}`}
			>
				<span
					aria-hidden="true"
					className={`inline-flex w-5 justify-center text-[13px] ${isAi ? "text-link" : "text-graphite"}`}
				>
					{item.icon}
				</span>
				<span className="min-w-0 flex-1 truncate">{item.label}</span>
				{item.hint && (
					<span className="font-mono text-[12px] text-pencil">{item.hint}</span>
				)}
			</button>
		</>
	);
}

function MentionRow({
	item,
	selected,
	onChoose,
	onHover,
	group,
}: {
	item: MentionItem;
	selected: boolean;
	onChoose: () => void;
	onHover: () => void;
	group: string | null;
}) {
	return (
		<>
			{group && (
				<div className="px-2 pt-2 pb-1 text-[12px] font-medium text-pencil">
					{group}
				</div>
			)}
			<button
				type="button"
				onMouseDown={(e) => {
					e.preventDefault();
					onChoose();
				}}
				onMouseMove={onHover}
				className={`flex h-[34px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[14px] text-ink coarse:h-11 coarse:text-[15px] ${selected ? "bg-wash-2" : ""}`}
			>
				{item.kind === "person" ? (
					<Avatar id={item.id} name={item.label} size={22} />
				) : (
					<span className="inline-flex w-[22px] justify-center text-graphite">
						{item.kind === "date" ? <DateIcon /> : <PageIcon size={15} />}
					</span>
				)}
				<span className="min-w-0 flex-1 truncate">{item.label}</span>
				{item.here ? (
					<span className="text-[13px] text-green">Here now</span>
				) : item.detail ? (
					<span className="text-[13px] text-pencil">{item.detail}</span>
				) : null}
			</button>
		</>
	);
}

function SaveIndicator({ state }: { state: SaveState }) {
	const { status } = useLive();
	// A lost socket means edits only reach other people once it's back, same as the banner says.
	const disconnected = status === "reconnecting" || status === "offline";
	const shown: SaveState =
		disconnected && (state === "saved" || state === "saving")
			? "offline"
			: state;
	return (
		<output
			aria-live="polite"
			data-save-state={shown}
			className={`truncate text-[13px] leading-4 ${shown === "saved" ? "max-md:hidden" : ""} ${shown === "denied" || shown === "failed" || shown === "too-large" ? "text-coral" : "text-pencil"}`}
		>
			{SAVE_LABELS[shown]}
		</output>
	);
}

function PageMenu({
	onHistory,
	onComments,
	commentCount,
}: {
	onHistory: () => void;
	onComments: () => void;
	commentCount: number;
}) {
	const menu = useMenu();
	const phone = usePhone();
	const items: MenuItem[] = [
		...(phone
			? ([
					{
						id: "share",
						label: "Share",
						onSelect: () =>
							window.dispatchEvent(new CustomEvent("livepage:share")),
					},
					{
						id: "favorite",
						label: "Favorite",
						onSelect: () =>
							window.dispatchEvent(new CustomEvent("livepage:favorite")),
					},
				] satisfies MenuItem[])
			: []),
		{ id: "history", label: "Page history", onSelect: onHistory },
		{
			id: "comments",
			label: commentCount ? `Comments (${commentCount})` : "Comments",
			onSelect: onComments,
		},
	];
	return (
		<>
			<button
				ref={menu.anchor}
				type="button"
				onClick={menu.toggle}
				aria-label="More page options"
				title="Page options"
				className="flex h-7 w-7 items-center justify-center rounded-md text-graphite hover:bg-wash coarse:size-10"
			>
				<MoreIcon size={15} />
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				items={items}
				align="end"
				width={180}
			/>
		</>
	);
}

function EditorSurface({
	editor,
	surfaceRef,
	children,
}: {
	editor: Editor;
	surfaceRef: React.RefObject<HTMLDivElement | null>;
	children: React.ReactNode;
}) {
	return (
		<div
			ref={surfaceRef}
			className="lp-editor-surface relative max-[1100px]:pr-8"
		>
			<EditorContent editor={editor} />
			{children}
		</div>
	);
}

type HeadPatch = Partial<Pick<Page, "icon" | "coverFileId">>;

// One way to pick a cover, shared by "Add cover" and "Change cover".
function useCoverPicker(pageId: string, update: (patch: HeadPatch) => void) {
	const toast = useToast();
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const choose = () => input.current?.click();
	const inputEl = (
		<input
			ref={input}
			type="file"
			accept="image/*"
			hidden
			onChange={async (e) => {
				const file = e.target.files?.[0];
				e.target.value = "";
				if (!file) return;
				const form = new FormData();
				form.set("pageId", pageId);
				form.set("file", file);
				setBusy(true);
				try {
					const saved = await uploadFile({ data: form });
					update({ coverFileId: saved.fileId });
				} catch (err) {
					toast.show(errorText(err), { tone: "error" });
				} finally {
					setBusy(false);
				}
			}}
		/>
	);
	return { choose, busy, inputEl };
}

function PageHead({
	page,
	canEdit,
	title,
	update,
}: {
	page: Page;
	canEdit: boolean;
	title: Editor;
	update: (patch: HeadPatch) => void;
}) {
	const icon = useMenu();
	const [open, setOpen] = useState(false);
	const cover = useCoverPicker(page.id, update);

	const pickIcon = (value: string | null) => {
		update({ icon: value });
		setOpen(false);
	};

	return (
		<div>
			{/* With an icon, the actions sit beside it instead of overlapping it. */}
			<div className={page.icon ? "mb-2 flex items-end gap-4" : undefined}>
				{page.icon && (
					<button
						ref={icon.anchor}
						type="button"
						onClick={() => canEdit && setOpen(true)}
						aria-label={canEdit ? "Change icon" : undefined}
						className={`text-[44px] leading-none ${canEdit ? "" : "cursor-default"}`}
					>
						{page.icon}
					</button>
				)}
				{canEdit && (
					<div
						className={`lp-head-actions flex items-center gap-3 text-[13px] text-pencil ${page.icon ? "lp-head-actions-beside" : "pb-2"}`}
					>
						{!page.icon && (
							<button
								ref={icon.anchor}
								type="button"
								onClick={() => setOpen(true)}
								className="hover:text-ink coarse:h-10"
							>
								<PlusIcon size={12} className="mr-1 inline" />
								Add icon
							</button>
						)}
						{!page.coverFileId && (
							<>
								<button
									type="button"
									onClick={cover.choose}
									disabled={cover.busy}
									className="hover:text-ink disabled:opacity-60 coarse:h-10"
								>
									<PlusIcon size={12} className="mr-1 inline" />
									{cover.busy ? "Uploading cover" : "Add cover"}
								</button>
								{cover.inputEl}
							</>
						)}
					</div>
				)}
			</div>
			<Popover
				anchor={icon.anchor}
				open={open}
				onClose={() => setOpen(false)}
				className="p-2"
			>
				<div className="grid w-[272px] grid-cols-8 gap-0.5 max-md:w-full">
					{EMOJI.map((e) => (
						<button
							key={e}
							type="button"
							onClick={() => pickIcon(e)}
							className="h-8 w-8 rounded-md text-[20px] hover:bg-wash-2 coarse:size-10"
						>
							{e}
						</button>
					))}
				</div>
				{page.icon && (
					<button
						type="button"
						onClick={() => pickIcon(null)}
						className="mt-1 h-7 w-full rounded-md text-[13px] text-graphite hover:bg-wash"
					>
						Remove icon
					</button>
				)}
			</Popover>
			<EditorContent editor={title} />
		</div>
	);
}

function PageCover({
	page,
	canEdit,
	update,
}: {
	page: Page;
	canEdit: boolean;
	update: (patch: HeadPatch) => void;
}) {
	const cover = useCoverPicker(page.id, update);
	if (!page.coverFileId) return null;
	return (
		<div className="group relative -mr-14 -ml-[88px] h-[220px] overflow-hidden bg-wash max-lg:-mx-4">
			<img
				src={fileUrl(page.coverFileId)}
				alt=""
				className="h-full w-full object-cover"
			/>
			{canEdit && (
				<div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 coarse:opacity-100">
					<button
						type="button"
						onClick={cover.choose}
						disabled={cover.busy}
						className="rounded-md bg-paper/90 px-2 py-1 text-xs text-graphite hover:text-ink disabled:opacity-60"
					>
						{cover.busy ? "Uploading" : "Change cover"}
					</button>
					<button
						type="button"
						onClick={() => update({ coverFileId: null })}
						className="rounded-md bg-paper/90 px-2 py-1 text-xs text-graphite hover:text-ink"
					>
						Remove cover
					</button>
					{cover.inputEl}
				</div>
			)}
		</div>
	);
}

function Byline({ page, members }: { page: Page; members: Person[] }) {
	const owner = members.find((m) => m.userId === page.createdBy);
	const name = owner?.name || owner?.email;
	const edited = new Date(page.updatedAt).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	return (
		<div className="flex items-center gap-5 pt-3 pb-6 text-[13px] leading-4 text-graphite">
			{name && (
				<div className="flex items-center gap-1.5">
					<Avatar id={page.createdBy} name={name} size={20} />
					<span>{name}</span>
				</div>
			)}
			<span className="text-pencil">Edited {edited}</span>
		</div>
	);
}
