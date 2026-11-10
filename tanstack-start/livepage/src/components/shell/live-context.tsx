// One Realtime connection per tab, shared by everything under the app shell.
import { Query } from "appwrite";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { fetchToken } from "#/functions/realtime";
import { LiveConnection, type LiveEvent, type LiveStatus } from "#/lib/live";

type LiveApi = {
	status: LiveStatus;
	connection: LiveConnection | null;
	// Runs after a dropped socket comes back, because events sent while it was away aren't replayed.
	onReconnect: (fn: () => void) => () => void;
};

const Ctx = createContext<LiveApi>({
	status: "connecting",
	connection: null,
	onReconnect: () => () => undefined,
});
export const useLive = () => useContext(Ctx);

export function LiveProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<LiveStatus>("connecting");
	const [connection, setConnection] = useState<LiveConnection | null>(null);
	const reconnectListeners = useRef(new Set<() => void>());

	useEffect(() => {
		const live = new LiveConnection({
			fetchToken: () => fetchToken(),
			onStatus: setStatus,
			onConnected: ({ reconnect }) => {
				if (!reconnect) return;
				for (const fn of reconnectListeners.current) fn();
			},
		});
		live.start();
		setConnection(live);
		const onOnline = () => live.online();
		const onOffline = () => live.offline();
		const onVisible = () => {
			if (document.visibilityState === "visible") live.check();
		};
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
			document.removeEventListener("visibilitychange", onVisible);
			live.stop();
			setConnection(null);
		};
	}, []);

	const api = useMemo<LiveApi>(
		() => ({
			status,
			connection,
			onReconnect: (fn) => {
				reconnectListeners.current.add(fn);
				return () => {
					reconnectListeners.current.delete(fn);
				};
			},
		}),
		[status, connection],
	);

	return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// Subscribes to Realtime channels for as long as the component is mounted.
export function useChannel(
	id: string,
	channels: string[],
	queries: string[],
	onEvent: (event: LiveEvent) => void,
) {
	const { connection } = useLive();
	const handler = useRef(onEvent);
	handler.current = onEvent;
	const channelKey = channels.join(",");
	const queryKey = queries.join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: channels and queries are represented by their keys
	useEffect(() => {
		if (!connection) return;
		return connection.subscribe({
			id,
			channels,
			queries,
			onEvent: (e) => handler.current(e),
		});
	}, [connection, id, channelKey, queryKey]);
}

export const queryEqual = (attribute: string, value: string) =>
	Query.equal(attribute, [value]);
