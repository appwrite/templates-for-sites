// The current workspace: its pages (kept live over Realtime), who's online, and page actions with
// optimistic updates. Everything inside the shell reads from useWorkspace().
import { useRouter } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	fetchPages,
	submitCreatePage,
	submitTrashPage,
	submitUpdatePage,
} from "#/functions/pages";
import { submitRestore } from "#/functions/settings";
import {
	jwtBroker,
	listPresences,
	type PresenceRow,
} from "#/lib/browser-appwrite";
import { errorText } from "#/lib/errors";
import type { LiveEvent } from "#/lib/live";
import { type PageRow, toPage } from "#/lib/rows";
import type {
	Page,
	PageDraft,
	PagePatch,
	Viewer,
	Workspace,
} from "#/lib/types";
import { PAGES, rowsChannel } from "#/server/schema";
import { useToast } from "../ui";
import { queryEqual, useChannel, useLive } from "./live-context";

export type Peer = {
	userId: string;
	name: string;
	pageId: string | null;
	workspaceId: string | null;
};

type PresenceMeta = {
	workspaceId?: string;
	pageId?: string | null;
	name?: string;
};

type WorkspaceApi = {
	viewer: Viewer;
	workspace: Workspace;
	workspaces: Workspace[];
	pages: Page[];
	pagesLoading: boolean;
	pagesError: string | null;
	// Other people online in this workspace.
	peers: Peer[];
	// The page the shell currently shows, if any. Set by the /p/$pageId route.
	activePageId: string | null;
	createPage: (draft: Omit<PageDraft, "workspaceId">) => Promise<Page | null>;
	updatePage: (id: string, patch: PagePatch) => void;
	trashPage: (id: string) => void;
};

const Ctx = createContext<WorkspaceApi | null>(null);

export function useWorkspace() {
	const value = useContext(Ctx);
	if (!value) throw new Error("useWorkspace must be inside the app shell.");
	return value;
}

function mergeRow(pages: Page[], next: Page) {
	if (next.kind === "row" || next.trashedAt)
		return pages.filter((p) => p.id !== next.id);
	const exists = pages.some((p) => p.id === next.id);
	return exists
		? pages.map((p) => (p.id === next.id ? next : p))
		: [...pages, next];
}

export function WorkspaceProvider({
	viewer,
	workspace,
	workspaces,
	activePageId,
	children,
}: {
	viewer: Viewer;
	workspace: Workspace;
	workspaces: Workspace[];
	activePageId: string | null;
	children: ReactNode;
}) {
	const toast = useToast();
	const router = useRouter();
	const { connection, onReconnect, status } = useLive();
	const [pages, setPages] = useState<Page[]>([]);
	const [pagesLoading, setPagesLoading] = useState(true);
	const [pagesError, setPagesError] = useState<string | null>(null);
	const workspaceId = workspace.id;

	const load = useCallback(async () => {
		try {
			const rows = await fetchPages({ data: { workspaceId } });
			setPages(rows);
			setPagesError(null);
		} catch (err) {
			setPagesError(errorText(err));
		} finally {
			setPagesLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		setPagesLoading(true);
		setPages([]);
		void load();
	}, [load]);

	useEffect(() => onReconnect(() => void load()), [onReconnect, load]);

	useChannel(
		`pages-${workspaceId}`,
		[rowsChannel(PAGES)],
		[queryEqual("workspaceId", workspaceId)],
		(event: LiveEvent) => {
			const row = event.payload as PageRow;
			if (event.events.some((e) => e.endsWith(".delete")))
				setPages((list) => list.filter((p) => p.id !== row.$id));
			else setPages((list) => mergeRow(list, toPage(row)));
		},
	);

	// Presence roster: everyone in this workspace who's online right now.
	const [presence, setPresence] = useState<Map<string, PresenceMeta>>(
		new Map(),
	);

	const applyPresence = useCallback(
		(row: PresenceRow) => {
			const meta = (row.metadata ?? {}) as PresenceMeta;
			setPresence((current) => {
				const next = new Map(current);
				if (meta.workspaceId === workspaceId) next.set(row.userId, meta);
				else next.delete(row.userId);
				return next;
			});
		},
		[workspaceId],
	);

	const loadPresence = useCallback(async () => {
		try {
			const rows = await listPresences();
			setPresence(
				new Map(
					rows
						.filter(
							(r) => (r.metadata as PresenceMeta)?.workspaceId === workspaceId,
						)
						.map((r) => [r.userId, r.metadata as PresenceMeta]),
				),
			);
		} catch {
			// The roster fills from events; a failed list isn't worth a message.
		}
	}, [workspaceId]);

	useEffect(() => {
		if (status === "live") void loadPresence();
	}, [status, loadPresence]);

	useChannel("presences", ["presences"], [], (event: LiveEvent) => {
		const row = event.payload as PresenceRow;
		if (event.events.some((e) => e.endsWith(".delete"))) {
			setPresence((current) => {
				if (!current.has(row.userId)) return current;
				const next = new Map(current);
				next.delete(row.userId);
				return next;
			});
		} else applyPresence(row);
	});

	// Announce where this tab is. A hidden tab stays quiet so a visible one's position wins.
	const sendPresence = useCallback(() => {
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		)
			return;
		connection?.setPresence({
			status: "online",
			metadata: { workspaceId, pageId: activePageId, name: viewer.name },
			permissions: [`read("team:${workspaceId}")`],
		});
	}, [connection, workspaceId, activePageId, viewer.name]);

	useEffect(() => {
		sendPresence();
		document.addEventListener("visibilitychange", sendPresence);
		return () => document.removeEventListener("visibilitychange", sendPresence);
	}, [sendPresence]);

	const peers = useMemo<Peer[]>(
		() =>
			[...presence.entries()]
				.filter(([userId]) => userId !== viewer.userId)
				.map(([userId, meta]) => ({
					userId,
					name: meta.name ?? "Someone",
					pageId: meta.pageId ?? null,
					workspaceId: meta.workspaceId ?? null,
				})),
		[presence, viewer.userId],
	);

	const pagesRef = useRef(pages);
	pagesRef.current = pages;

	const createPage = useCallback<WorkspaceApi["createPage"]>(
		async (draft) => {
			try {
				const page = await submitCreatePage({
					data: { ...draft, workspaceId },
				});
				setPages((list) => mergeRow(list, page));
				return page;
			} catch (err) {
				toast.show(errorText(err), { tone: "error" });
				return null;
			}
		},
		[toast, workspaceId],
	);

	const updatePage = useCallback<WorkspaceApi["updatePage"]>(
		(id, patch) => {
			const previous = pagesRef.current.find((p) => p.id === id);
			setPages((list) =>
				list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
			);
			submitUpdatePage({ data: { pageId: id, patch } }).catch((err) => {
				if (previous)
					setPages((list) => list.map((p) => (p.id === id ? previous : p)));
				toast.show(errorText(err), { tone: "error" });
			});
		},
		[toast],
	);

	const trashPage = useCallback<WorkspaceApi["trashPage"]>(
		(id) => {
			const previous = pagesRef.current.find((p) => p.id === id);
			setPages((list) => list.filter((p) => p.id !== id));
			submitTrashPage({ data: { pageId: id } }).then(
				() => {
					toast.show("Moved to Trash", {
						action: {
							label: "Undo",
							run: () => {
								if (previous) setPages((list) => [...list, previous]);
								submitRestore({ data: { pageId: id } }).catch((err) =>
									toast.show(errorText(err), { tone: "error" }),
								);
							},
						},
					});
					if (activePageId === id)
						router.navigate({ to: "/w/$workspaceId", params: { workspaceId } });
				},
				(err) => {
					if (previous) setPages((list) => [...list, previous]);
					toast.show(errorText(err), { tone: "error" });
				},
			);
		},
		[toast, activePageId, router, workspaceId],
	);

	// Drop the cached JWT when the person changes workspace, so a stale one isn't reused after sign-out.
	useEffect(() => () => jwtBroker.invalidate(), []);

	const api = useMemo<WorkspaceApi>(
		() => ({
			viewer,
			workspace,
			workspaces,
			pages,
			pagesLoading,
			pagesError,
			peers,
			activePageId,
			createPage,
			updatePage,
			trashPage,
		}),
		[
			viewer,
			workspace,
			workspaces,
			pages,
			pagesLoading,
			pagesError,
			peers,
			activePageId,
			createPage,
			updatePage,
			trashPage,
		],
	);

	return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
