// Shared pieces for the database views: the store hook, presence, chips and small controls.
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	queryEqual,
	useChannel,
	useLive,
} from "#/components/shell/live-context";
import { useWorkspace } from "#/components/shell/workspace-context";
import { useToast } from "#/components/ui";
import { listPresences, type PresenceRow } from "#/lib/browser-appwrite";
import type { LiveEvent } from "#/lib/live";
import { rowHash } from "#/lib/permissions";
import type { DatabaseStore } from "./store";
import { releaseStore, retainStore, storeFor } from "./store";
import { CHIP_CLASSES, type ChipColor, type Property } from "./types";

// Mounts the store for a database and keeps this component in sync with it.
export function useDatabaseStore(databaseId: string) {
	const { viewer } = useWorkspace();
	const { connection, onReconnect } = useLive();
	const toast = useToast();
	const store = useMemo(
		() => storeFor(databaseId, viewer.userId),
		[databaseId, viewer.userId],
	);

	// Separate from the effect below: a toast must never release the store this page is showing.
	useEffect(() => {
		store.onError = (message) => toast.show(message, { tone: "error" });
	}, [store, toast]);

	useEffect(() => {
		retainStore(store);
		void store.load();
		return () => releaseStore(databaseId);
	}, [databaseId, store]);

	useEffect(() => store.attach(connection), [store, connection]);

	useEffect(() => onReconnect(() => void store.reload()), [onReconnect, store]);

	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
	return store;
}

export function useStoreVersion(store: DatabaseStore) {
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

const noSubscribe = () => () => undefined;
const noVersion = () => 0;

// For a store that may not exist yet (a rollup before its relation is picked).
export function useMaybeStoreVersion(store: DatabaseStore | null) {
	useSyncExternalStore(
		store ? store.subscribe : noSubscribe,
		store ? store.getVersion : noVersion,
		store ? store.getVersion : noVersion,
	);
}

// Up, Down and Enter over a filtered list inside a popover.
export function useListNav(count: number, onEnter: (index: number) => void) {
	const [active, setActive] = useState(0);
	const clamped = count ? Math.min(active, count - 1) : 0;
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((v) => (count ? (Math.min(v, count - 1) + 1) % count : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((v) => (count ? (v - 1 + count) % count : 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			onEnter(clamped);
		}
	};
	return { active: clamped, setActive, onKeyDown };
}

// ---------- Presence on a cell ----------

export type CellPresence = {
	userId: string;
	name: string;
	rowId: string;
	propertyId: string | null;
	drag: boolean;
};

type PresenceMeta = {
	workspaceId?: string;
	pageId?: string | null;
	name?: string;
	db?: string;
	row?: string;
	prop?: string | null;
	drag?: boolean;
};

export function useCellPresence(store: DatabaseStore) {
	const { viewer, workspace, activePageId } = useWorkspace();
	const { connection, status } = useLive();
	const [peers, setPeers] = useState<Map<string, CellPresence>>(new Map());
	const lastCell = useRef<string>("");

	const apply = useCallback(
		(row: PresenceRow, removed: boolean) => {
			setPeers((current) => {
				const meta = (row.metadata ?? {}) as PresenceMeta;
				const next = new Map(current);
				if (
					removed ||
					meta.db !== store.databaseId ||
					!meta.row ||
					row.userId === viewer.userId
				) {
					if (!next.has(row.userId)) return current;
					next.delete(row.userId);
					return next;
				}
				next.set(row.userId, {
					userId: row.userId,
					name: meta.name ?? "Someone",
					rowId: meta.row,
					propertyId: meta.prop ?? null,
					drag: Boolean(meta.drag),
				});
				return next;
			});
		},
		[store.databaseId, viewer.userId],
	);

	useChannel(
		`dbp-${rowHash(store.databaseId).slice(0, 24)}`,
		["presences"],
		[],
		(event: LiveEvent) => {
			const row = event.payload as PresenceRow;
			apply(
				row,
				event.events.some((e) => e.endsWith(".delete")),
			);
		},
	);

	useEffect(() => {
		if (status !== "live") return;
		listPresences()
			.then((rows) => {
				for (const row of rows) apply(row, false);
			})
			.catch(() => undefined);
	}, [status, apply]);

	// Merged with the shell's own fields so the roster keeps working. Throttled to 2.5 s by the
	// connection, so a peer sees selection moves at that pace.
	const announce = useCallback(
		(
			cell: { rowId: string; propertyId: string | null; drag?: boolean } | null,
		) => {
			const key = cell
				? `${cell.rowId}|${cell.propertyId}|${cell.drag ?? false}`
				: "";
			if (lastCell.current === key) return;
			lastCell.current = key;
			if (
				typeof document !== "undefined" &&
				document.visibilityState === "hidden"
			)
				return;
			connection?.setPresence({
				status: "online",
				metadata: {
					workspaceId: workspace.id,
					pageId: activePageId,
					name: viewer.name,
					...(cell
						? {
								db: store.databaseId,
								row: cell.rowId,
								prop: cell.propertyId,
								drag: Boolean(cell.drag),
							}
						: {}),
				},
				permissions: [`read("team:${workspace.id}")`],
			});
		},
		[connection, workspace.id, activePageId, viewer.name, store.databaseId],
	);

	useEffect(() => () => announce(null), [announce]);

	return { peers, announce };
}

export function presenceAt(
	peers: Map<string, CellPresence>,
	rowId: string,
	propertyId: string,
) {
	for (const peer of peers.values()) {
		if (peer.rowId === rowId && peer.propertyId === propertyId) return peer;
	}
	return null;
}

export function dragPresenceAt(
	peers: Map<string, CellPresence>,
	rowId: string,
) {
	for (const peer of peers.values()) {
		if (peer.rowId === rowId && peer.drag) return peer;
	}
	return null;
}

// ---------- Small pieces ----------

export function Chip({
	color,
	children,
}: {
	color: ChipColor;
	children: ReactNode;
}) {
	return (
		<span
			className={`inline-flex h-[22px] max-w-full items-center truncate rounded-sm px-[7px] text-sm leading-4 ${CHIP_CLASSES[color]}`}
		>
			<span className="truncate">{children}</span>
		</span>
	);
}

export function ToolbarButton({
	label,
	count,
	active,
	onClick,
	buttonRef,
}: {
	label: string;
	count?: number;
	active?: boolean;
	onClick: () => void;
	buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			onClick={onClick}
			aria-expanded={active}
			className={`shrink-0 whitespace-nowrap pb-3 text-base leading-[18px] outline-none hover:text-ink focus-visible:text-ink focus-visible:underline coarse:flex coarse:h-10 coarse:items-center coarse:pb-0 ${count ? "text-link" : "text-graphite"} ${active ? "text-ink" : ""}`}
		>
			{label}
			{count ? ` ${count}` : ""}
		</button>
	);
}

export const NEW_PROPERTY_NAMES: Partial<Record<Property["type"], string>> = {
	text: "Text",
	number: "Number",
	select: "Select",
	multi_select: "Tags",
	status: "Status",
	date: "Date",
	person: "Owner",
	checkbox: "Done",
	url: "Link",
	email: "Email",
	phone: "Phone",
	files: "Files",
	formula: "Formula",
	relation: "Related",
	rollup: "Rollup",
	created_time: "Created",
	created_by: "Created by",
	edited_time: "Last edited",
	edited_by: "Last edited by",
};

export function nextPropertyName(store: DatabaseStore, base: string) {
	const names = new Set(store.properties.map((p) => p.name.toLowerCase()));
	if (!names.has(base.toLowerCase())) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base} ${i}`;
		if (!names.has(candidate.toLowerCase())) return candidate;
	}
}

export { queryEqual };

// Popovers measure themselves hidden first, and a hidden input can't take focus, so autoFocus does nothing there.
// Attach this ref to the input a popover should focus when it opens.
export function useOpenFocus<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	useEffect(() => {
		const frame = requestAnimationFrame(() => ref.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	return ref;
}
