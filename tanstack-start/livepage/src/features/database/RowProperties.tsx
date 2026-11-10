// The properties of one row: the header above a row's page, and inside the row peek.
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "#/components/icons";
import { TopBarLead } from "#/components/shell/top-bar";
import {
	CellDisplay,
	CellPopoverEditor,
	canEditType,
	InlineEditor,
	inlineEditable,
} from "./cells";
import type { DatabaseStore } from "./store";
import type { Property } from "./types";
import { presenceAt, useCellPresence, useDatabaseStore } from "./ui";

type Announce = (
	c: { rowId: string; propertyId: string | null } | null,
) => void;

// Row properties in the board 74 style. Used by the peek, and by the row page through the export below.
export function RowPropertyList({
	store,
	rowId,
	layout = "list",
	peers,
	announce,
}: {
	store: DatabaseStore;
	rowId: string;
	layout?: "list" | "grid";
	peers: Parameters<typeof presenceAt>[0];
	announce: Announce;
}) {
	const props = store.properties.filter((p) => p.type !== "title");
	if (layout === "grid") {
		return (
			<div className="grid grid-cols-3 gap-x-6 gap-y-4 max-md:block">
				{props.map((prop) => (
					<div
						key={prop.id}
						className="min-w-0 max-md:flex max-md:min-h-11 max-md:items-start max-md:gap-3 max-md:border-t max-md:border-rule max-md:py-2"
					>
						<div className="mb-1 text-sm text-pencil max-md:mb-0 max-md:w-[92px] max-md:shrink-0 max-md:pt-1.5 max-md:text-[15px] max-md:text-graphite">
							{prop.name}
						</div>
						<RowValue
							store={store}
							rowId={rowId}
							prop={prop}
							peers={peers}
							announce={announce}
						/>
					</div>
				))}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			{props.map((prop) => (
				<div
					key={prop.id}
					className="flex min-h-9 items-center gap-3 coarse:min-h-11"
				>
					<span className="w-36 shrink-0 truncate text-base text-pencil max-md:w-[92px]">
						{prop.name}
					</span>
					<div className="min-w-0 flex-1">
						<RowValue
							store={store}
							rowId={rowId}
							prop={prop}
							peers={peers}
							announce={announce}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

function RowValue({
	store,
	rowId,
	prop,
	peers,
	announce,
}: {
	store: DatabaseStore;
	rowId: string;
	prop: Property;
	peers: Parameters<typeof presenceAt>[0];
	announce: Announce;
}) {
	const [editing, setEditing] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const canEdit = store.access.canEdit && canEditType(prop);
	const peer = presenceAt(peers, rowId, prop.id);

	const begin = () => {
		if (!canEdit) return;
		if (prop.type === "checkbox") {
			store.setCell(rowId, prop.id, !store.value(rowId, prop.id));
			return;
		}
		setEditing(true);
		announce({ rowId, propertyId: prop.id });
	};

	const end = () => {
		setEditing(false);
		announce(null);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: opens the editor; keyboard users get the inner button
		<div
			ref={ref}
			onClick={begin}
			onKeyDown={undefined}
			className={`relative flex min-h-[30px] w-full max-w-full items-center rounded-sm px-1.5 max-md:-ml-1.5 max-md:[&_span]:whitespace-normal coarse:min-h-9 ${canEdit ? "cursor-pointer hover:bg-wash" : ""}`}
			style={{
				boxShadow: peer ? "inset 0 0 0 2px var(--color-green)" : undefined,
			}}
		>
			{peer && (
				<span className="absolute -top-[18px] left-1 rounded-t-[3px] bg-green px-1.5 text-xs leading-[18px] font-medium text-paper">
					{peer.name}
				</span>
			)}
			{editing && inlineEditable(prop) ? (
				<span className="inline-flex h-[30px] w-[220px] max-w-full items-center coarse:h-9">
					<InlineEditor store={store} rowId={rowId} prop={prop} onDone={end} />
				</span>
			) : (
				<CellDisplay store={store} rowId={rowId} prop={prop} />
			)}
			{editing && !inlineEditable(prop) && (
				<CellPopoverEditor
					store={store}
					rowId={rowId}
					prop={prop}
					anchor={ref}
					onClose={end}
				/>
			)}
			{!editing &&
				canEdit &&
				prop.type !== "checkbox" &&
				isBlank(store, rowId, prop) && (
					<span className="text-sm text-pencil">Empty</span>
				)}
		</div>
	);
}

function isBlank(store: DatabaseStore, rowId: string, prop: Property) {
	const v = store.value(rowId, prop.id);
	return (
		v === null ||
		v === undefined ||
		v === "" ||
		(Array.isArray(v) && v.length === 0)
	);
}

// Exported for the editor: shown above a row's page body when it opens as a full page.
export function RowProperties({
	databaseId,
	rowId,
	layout = "grid",
}: {
	databaseId: string;
	rowId: string;
	layout?: "list" | "grid";
}) {
	const store = useDatabaseStore(databaseId);
	const { peers, announce } = useCellPresence(store);
	if (store.status === "error")
		return <p className="text-sm text-coral">{store.error}</p>;
	if (!store.rows.has(rowId) && store.loadingMore)
		return <div className="h-16 w-1/2 animate-pulse rounded-sm bg-wash" />;
	return (
		<>
			<RowTopBar store={store} databaseId={databaseId} rowId={rowId} />
			<RowPropertyList
				store={store}
				rowId={rowId}
				layout={layout}
				peers={peers}
				announce={announce}
			/>
		</>
	);
}

// The way back to the database and on to the next row, in the top bar (boards 23 and 93).
function RowTopBar({
	store,
	databaseId,
	rowId,
}: {
	store: DatabaseStore;
	databaseId: string;
	rowId: string;
}) {
	const index = store.rowIds.indexOf(rowId);
	const prev = index > 0 ? store.rowIds[index - 1] : null;
	const next =
		index >= 0 && index < store.rowIds.length - 1
			? store.rowIds[index + 1]
			: null;
	const title = store.page?.title || "Database";
	const arrow =
		"flex size-7 shrink-0 items-center justify-center rounded-md text-graphite hover:bg-wash-2 coarse:size-10 aria-disabled:pointer-events-none aria-disabled:opacity-30";
	return (
		<TopBarLead>
			<div className="flex min-w-0 flex-1 items-center gap-3 text-sm leading-4 max-md:gap-1">
				<Link
					to="/p/$pageId"
					params={{ pageId: databaseId }}
					className="flex min-w-0 items-center gap-1 truncate text-pencil hover:text-ink max-md:h-10 max-md:text-[15px] max-md:text-ink"
				>
					<ChevronRight size={15} className="rotate-180 md:hidden" />
					{title}
				</Link>
				<span className="text-rule-strong max-md:hidden">/</span>
				<span className="truncate font-medium text-ink max-md:hidden">
					{store.rows.get(rowId)?.title || "Untitled"}
				</span>
				<span className="flex-1" />
				<div className="flex items-center gap-0.5">
					<Link
						to="/p/$pageId"
						params={{ pageId: prev ?? rowId }}
						aria-label="Previous row"
						aria-disabled={!prev}
						className={arrow}
					>
						<ChevronDown size={14} className="rotate-180" />
					</Link>
					<Link
						to="/p/$pageId"
						params={{ pageId: next ?? rowId }}
						aria-label="Next row"
						aria-disabled={!next}
						className={arrow}
					>
						<ChevronDown size={14} />
					</Link>
				</div>
			</div>
		</TopBarLead>
	);
}
