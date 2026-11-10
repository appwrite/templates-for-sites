// Per-person state around the workspace: favorites, recents, unread counts and photos. Lives above
// the sidebar and the page so both read the same data, and stays live over Realtime.
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	queryEqual,
	useChannel,
	useLive,
} from "#/components/shell/live-context";
import { useWorkspace } from "#/components/shell/workspace-context";
import { setAvatars } from "#/components/ui/avatar";
import { fetchAvatars } from "#/functions/settings";
import type { LiveEvent } from "#/lib/live";
import { FAVORITES, NOTIFICATIONS, rowsChannel } from "#/server/schema";
import { fetchExtras, submitFavorite, submitVisit } from "./functions";

type Extras = {
	favorites: string[];
	recents: { pageId: string; visitedAt: string }[];
	unread: Record<string, number>;
	toggleFavorite: (pageId: string) => void;
	reload: () => void;
};

const Ctx = createContext<Extras | null>(null);

export function useExtras() {
	const value = useContext(Ctx);
	if (!value) throw new Error("useExtras must be inside the app shell.");
	return value;
}

export function ExtrasProvider({ children }: { children: ReactNode }) {
	const { viewer, workspace, activePageId } = useWorkspace();
	const { onReconnect } = useLive();
	const [favorites, setFavorites] = useState<string[]>([]);
	const [recents, setRecents] = useState<Extras["recents"]>([]);
	const [unread, setUnread] = useState<Record<string, number>>({});
	const workspaceId = workspace.id;
	const userId = viewer.userId;

	const reload = useCallback(() => {
		fetchExtras({ data: { workspaceId } })
			.then((next) => {
				setFavorites(next.favorites);
				setRecents(next.recents);
				setUnread(next.unread);
			})
			.catch(() => undefined);
	}, [workspaceId]);

	useEffect(() => {
		reload();
		fetchAvatars({ data: { workspaceId } })
			.then(setAvatars)
			.catch(() => undefined);
	}, [reload, workspaceId]);

	// A new or removed photo shows everywhere right away. A removed file would otherwise be a broken
	// image until the next page load.
	useEffect(() => {
		const refresh = () => {
			fetchAvatars({ data: { workspaceId } })
				.then(setAvatars)
				.catch(() => undefined);
		};
		window.addEventListener("livepage:avatars", refresh);
		return () => window.removeEventListener("livepage:avatars", refresh);
	}, [workspaceId]);

	useEffect(() => onReconnect(reload), [onReconnect, reload]);

	useChannel(
		`favorites-${userId}`,
		[rowsChannel(FAVORITES)],
		[queryEqual("userId", userId)],
		() => reload(),
	);

	useChannel(
		`notifications-${userId}`,
		[rowsChannel(NOTIFICATIONS)],
		[queryEqual("userId", userId)],
		(event: LiveEvent) => {
			const row = event.payload as {
				workspaceId: string;
				readAt: string | null;
			};
			if (event.events.some((e) => e.endsWith(".create")) && !row.readAt)
				setUnread((u) => ({
					...u,
					[row.workspaceId]: (u[row.workspaceId] ?? 0) + 1,
				}));
			else reload();
		},
	);

	// Every open of a page counts as a visit: it feeds Home and Recent.
	useEffect(() => {
		if (!activePageId) return;
		const timer = setTimeout(() => {
			const visitedAt = new Date().toISOString();
			setRecents((list) => [
				{ pageId: activePageId, visitedAt },
				...list.filter((r) => r.pageId !== activePageId),
			]);
			void submitVisit({ data: { pageId: activePageId } }).catch(
				() => undefined,
			);
		}, 1200);
		return () => clearTimeout(timer);
	}, [activePageId]);

	const toggleFavorite = useCallback(
		(pageId: string) => {
			setFavorites((list) => {
				const favorite = !list.includes(pageId);
				void submitFavorite({ data: { pageId, favorite } }).catch(reload);
				return favorite ? [...list, pageId] : list.filter((p) => p !== pageId);
			});
		},
		[reload],
	);

	const value = useMemo(
		() => ({ favorites, recents, unread, toggleFavorite, reload }),
		[favorites, recents, unread, toggleFavorite, reload],
	);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
