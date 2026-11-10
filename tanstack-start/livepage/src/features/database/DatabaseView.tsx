// The database page: title, view tabs, toolbar, the active view, and the row peek.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, SearchIcon, TrashIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Button,
	Menu,
	type MenuItem,
	Skeleton,
	Spinner,
	usePhone,
	useToast,
} from "#/components/ui";
import type { Page } from "#/lib/types";
import { BoardView, boardGroupProp } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { EmptyDatabase } from "./EmptyDatabase";
import { GalleryView } from "./GalleryView";
import { exportCsv, ImportDialog } from "./import";
import { PhoneRows } from "./PhoneRows";
import {
	AddViewPanel,
	FilterPanel,
	PropertiesPanel,
	SortGroupPanel,
} from "./panels";
import { RowPeek } from "./RowPeek";
import type { DatabaseStore } from "./store";
import { columnsFor, TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import type { View } from "./types";
import { ToolbarButton, useCellPresence, useDatabaseStore } from "./ui";
import { countFilters } from "./values";

export function DatabaseView({ page }: { page: Page }) {
	const store = useDatabaseStore(page.id);
	const { updatePage } = useWorkspace();
	const [viewId, setViewId] = useState<string | null>(null);
	const [openRow, setOpenRow] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [searching, setSearching] = useState(false);
	const [importing, setImporting] = useState<"file" | "paste" | null>(null);
	const { peers, announce } = useCellPresence(store);

	const view =
		store.views.find((v) => v.id === viewId) ?? store.views[0] ?? null;

	useEffect(() => {
		document.title = `${page.title || "Untitled"} · Livepage`;
	}, [page.title]);

	useEffect(() => {
		if (!viewId || store.views.some((v) => v.id === viewId)) return;
		setViewId(null);
	}, [store.views, viewId]);

	const empty =
		store.status === "ready" &&
		!store.loadingMore &&
		store.rowIds.length === 0 &&
		store.properties.length <= 1 &&
		store.views.length <= 1 &&
		!search &&
		store.access.canEdit;

	if (store.status === "error") {
		return (
			<div className="mx-auto max-w-[560px] px-6 pt-20">
				<h1 className="text-xl">This database didn't load.</h1>
				<p className="mt-2 text-graphite">{store.error}</p>
				<Button className="mt-4" onClick={() => void store.reload()}>
					Try again
				</Button>
			</div>
		);
	}

	const onNew = () => {
		if (!view) return;
		const config = store.configFor(view);
		const cells: Record<string, unknown> = {};
		// Rows made inside a filtered view get the filter's simple values, so they don't vanish.
		for (const item of config.filter.items) {
			if (config.filter.op === "or" || "items" in item) continue;
			if (
				item.condition === "is" ||
				item.condition === "eq" ||
				item.condition === "contains"
			) {
				const prop = store.propsById.get(item.propertyId);
				if (!prop || item.value === "" || item.value === undefined) continue;
				if (prop.type === "select" || prop.type === "status")
					cells[prop.id] = item.value;
				if (prop.type === "multi_select") cells[prop.id] = [item.value];
			}
		}
		const id = store.createRow({ cells });
		setOpenRow(id);
	};

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="database-view">
			<TitleBlock
				store={store}
				page={page}
				updatePage={updatePage}
				onNew={view ? onNew : undefined}
			/>

			{store.status === "loading" && (
				<div className="flex flex-col gap-3 px-4 md:px-8 pt-8" aria-busy="true">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-4 w-3/5" />
				</div>
			)}

			{view && (
				<>
					<div className="flex min-h-[37px] flex-wrap items-end gap-x-5 border-b border-rule px-4 md:px-8 pt-[18px] max-md:flex-col max-md:flex-nowrap max-md:items-stretch max-md:border-0 max-md:px-0 max-md:pt-1">
						<div className="flex min-w-0 items-end gap-x-5 scrollbar-none max-md:overflow-x-auto max-md:border-b max-md:border-rule max-md:px-5 md:contents">
							<ViewTabs store={store} activeId={view.id} onSelect={setViewId} />
						</div>
						<div className="flex-1 max-md:hidden" />
						<Toolbar
							store={store}
							view={view}
							searching={searching}
							search={search}
							setSearch={setSearch}
							setSearching={setSearching}
							onNew={onNew}
							onImport={() => setImporting("file")}
							onExport={() => {
								const props = columnsFor(store, store.configFor(view));
								const { ids } = store.rowsFor(view, search);
								exportCsv(store, ids, props, store.page?.title || "database");
							}}
							canEdit={store.access.canEdit}
						/>
					</div>

					{empty ? (
						<EmptyDatabase
							store={store}
							onImport={(mode) => setImporting(mode)}
						/>
					) : (
						<ActiveView
							key={view.id}
							store={store}
							view={view}
							search={search}
							onOpenRow={setOpenRow}
							peers={peers}
							announce={announce}
						/>
					)}

					{!empty && <StatusBar store={store} view={view} search={search} />}
				</>
			)}

			{openRow && (
				<RowPeek
					store={store}
					rowId={openRow}
					onClose={() => setOpenRow(null)}
					onOpen={setOpenRow}
				/>
			)}
			{importing && (
				<ImportDialog
					store={store}
					mode={importing === "paste" ? "paste" : undefined}
					onClose={() => setImporting(null)}
				/>
			)}
		</div>
	);
}

function TitleBlock({
	store,
	page,
	updatePage,
	onNew,
}: {
	store: DatabaseStore;
	page: Page;
	updatePage: (id: string, patch: { title: string }) => void;
	onNew?: () => void;
}) {
	const title = store.page?.title ?? page.title;
	const [draft, setDraft] = useState(title);
	const titleProp = store.properties.find((p) => p.type === "title");
	const description = titleProp?.options.description ?? "";
	const [desc, setDesc] = useState(description);
	useEffect(() => setDraft(title), [title]);
	useEffect(() => setDesc(description), [description]);
	const canEdit = store.access.canEdit;

	return (
		<div className="relative px-4 md:px-8 pt-9 max-md:px-5 max-md:pt-4">
			{canEdit && onNew && (
				<button
					type="button"
					onClick={onNew}
					className="absolute right-5 top-4 flex h-10 items-center rounded-md bg-accent px-4 text-[15px] font-medium text-white md:hidden"
				>
					New
				</button>
			)}
			<input
				aria-label="Database title"
				readOnly={!canEdit}
				placeholder="Untitled"
				className="w-full bg-transparent font-serif text-[40px] leading-[46px] font-medium tracking-[-0.02em] text-ink outline-none placeholder:text-pencil max-md:pr-20 max-md:text-[36px] max-md:leading-[44px]"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => {
					if (draft !== title) {
						if (store.page) store.page.title = draft;
						updatePage(page.id, { title: draft });
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") (e.target as HTMLInputElement).blur();
				}}
			/>
			{(canEdit || description) && (
				<input
					aria-label="Description"
					readOnly={!canEdit}
					placeholder={canEdit ? "Add a description" : ""}
					className={`mt-1.5 w-full bg-transparent text-base leading-[21px] text-graphite outline-none placeholder:text-pencil ${description ? "" : "max-md:hidden"}`}
					value={desc}
					onChange={(e) => setDesc(e.target.value)}
					onBlur={() => {
						if (desc !== description && titleProp) {
							void store.updateProperty(titleProp.id, {
								options: { ...titleProp.options, description: desc },
							});
						}
					}}
				/>
			)}
		</div>
	);
}

function ViewTabs({
	store,
	activeId,
	onSelect,
}: {
	store: DatabaseStore;
	activeId: string;
	onSelect: (id: string) => void;
}) {
	const addRef = useRef<HTMLButtonElement>(null);
	const [adding, setAdding] = useState(false);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const canEdit = store.access.canEdit;

	return (
		<>
			<div
				role="tablist"
				aria-label="Views"
				className="flex gap-x-5 md:contents"
			>
				{store.views.map((view) => (
					<TabButton
						key={view.id}
						store={store}
						view={view}
						active={view.id === activeId}
						canEdit={canEdit}
						renaming={renaming === view.id}
						setRenaming={setRenaming}
						menuOpen={menuFor === view.id}
						onMenu={(open) => setMenuFor(open ? view.id : null)}
						onSelect={onSelect}
					/>
				))}
			</div>
			{canEdit && (
				<>
					<button
						ref={addRef}
						type="button"
						onClick={() => setAdding(true)}
						className="shrink-0 pb-3 text-base text-pencil hover:text-ink whitespace-nowrap coarse:flex coarse:h-10 coarse:items-center coarse:pb-0"
					>
						+ Add view
					</button>
					{adding && (
						<AddViewPanel
							anchor={addRef}
							store={store}
							onAdded={(view) => onSelect(view.id)}
							onClose={() => setAdding(false)}
						/>
					)}
				</>
			)}
		</>
	);
}

function TabButton({
	store,
	view,
	active,
	canEdit,
	renaming,
	setRenaming,
	menuOpen,
	onMenu,
	onSelect,
}: {
	store: DatabaseStore;
	view: View;
	active: boolean;
	canEdit: boolean;
	renaming: boolean;
	setRenaming: (id: string | null) => void;
	menuOpen: boolean;
	onMenu: (open: boolean) => void;
	onSelect: (id: string) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	const [name, setName] = useState(view.name);
	useEffect(() => setName(view.name), [view.name]);
	const toast = useToast();

	const items: MenuItem[] = [
		{ id: "rename", label: "Rename", onSelect: () => setRenaming(view.id) },
		{
			id: "duplicate",
			label: "Duplicate",
			onSelect: () => {
				void store.duplicateView(view).then((v) => onSelect(v.id));
			},
		},
		{
			id: "delete",
			label: "Delete",
			danger: true,
			disabled: store.views.length <= 1,
			icon: <TrashIcon size={14} />,
			onSelect: () => {
				void store.deleteView(view.id);
				toast.show("View deleted");
			},
		},
	];

	if (renaming)
		return (
			<input
				// biome-ignore lint/a11y/noAutofocus: rename input the person just asked for
				autoFocus
				aria-label="View name"
				className="mb-[9px] h-[22px] w-28 rounded-sm border border-link bg-paper px-1 text-base"
				value={name}
				onChange={(e) => setName(e.target.value)}
				onBlur={() => {
					setRenaming(null);
					if (name.trim() && name !== view.name)
						void store.renameView(view.id, name.trim());
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					if (e.key === "Escape") setRenaming(null);
				}}
			/>
		);

	return (
		<>
			<button
				ref={ref}
				type="button"
				role="tab"
				aria-selected={active}
				onClick={() => {
					if (active && canEdit) onMenu(true);
					else onSelect(view.id);
				}}
				onContextMenu={(e) => {
					if (!canEdit) return;
					e.preventDefault();
					onMenu(true);
				}}
				className={`shrink-0 whitespace-nowrap border-b-2 pb-[10px] text-base leading-[18px] coarse:flex coarse:h-10 coarse:items-center coarse:pb-0 coarse:text-[15px] ${active ? "border-ink font-medium text-ink" : "border-transparent text-graphite hover:text-ink"}`}
			>
				{view.name}
				{active && canEdit && (
					<ChevronDown size={10} className="ml-1 inline text-pencil" />
				)}
				{store.hasOverlay(view) && (
					<span className="ml-1 text-link" title="Only you see these changes">
						•
					</span>
				)}
			</button>
			<Menu
				anchor={ref}
				open={menuOpen}
				onClose={() => onMenu(false)}
				items={items}
			/>
		</>
	);
}

function Toolbar({
	store,
	view,
	searching,
	search,
	setSearch,
	setSearching,
	onNew,
	onImport,
	onExport,
	canEdit,
}: {
	store: DatabaseStore;
	view: View;
	searching: boolean;
	search: string;
	setSearch: (v: string) => void;
	setSearching: (v: boolean) => void;
	onNew: () => void;
	onImport: () => void;
	onExport: () => void;
	canEdit: boolean;
}) {
	const config = store.configFor(view);
	const filterRef = useRef<HTMLButtonElement>(null);
	const sortRef = useRef<HTMLButtonElement>(null);
	const groupRef = useRef<HTMLButtonElement>(null);
	const propsRef = useRef<HTMLButtonElement>(null);
	const moreRef = useRef<HTMLButtonElement>(null);
	const [panel, setPanel] = useState<
		null | "filter" | "sort" | "group" | "properties" | "more"
	>(null);

	const close = () => setPanel(null);
	const filterCount = countFilters(config.filter, store.propsById);
	const groupCount = config.groupBy ? 1 : 0;
	const inBoard = view.type === "board";

	const moreItems: MenuItem[] = [
		{ id: "export", label: "Export CSV", onSelect: onExport },
		...(canEdit
			? [{ id: "import", label: "Import CSV", onSelect: onImport }]
			: []),
	];

	return (
		<div className="lp-hit flex flex-wrap items-end gap-x-5 scrollbar-none max-md:flex-nowrap max-md:items-center max-md:gap-x-4 max-md:overflow-x-auto max-md:border-b max-md:border-rule max-md:px-5 coarse:items-center">
			{searching ? (
				<input
					// biome-ignore lint/a11y/noAutofocus: the person just opened search
					autoFocus
					aria-label="Search rows"
					placeholder="Search"
					className="mb-2 h-[26px] w-[180px] shrink-0 rounded-md border border-rule-strong bg-paper px-2 text-sm outline-none focus:border-link coarse:mb-0 coarse:h-9"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onBlur={() => {
						if (!search) setSearching(false);
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setSearch("");
							setSearching(false);
						}
					}}
				/>
			) : (
				<button
					type="button"
					aria-label="Search rows"
					className="pb-3 text-graphite hover:text-ink coarse:flex coarse:h-10 coarse:w-9 coarse:shrink-0 coarse:items-center coarse:pb-0"
					onClick={() => setSearching(true)}
				>
					<SearchIcon size={15} />
				</button>
			)}
			<ToolbarButton
				buttonRef={filterRef}
				label="Filter"
				count={filterCount}
				active={panel === "filter"}
				onClick={() => setPanel(panel === "filter" ? null : "filter")}
			/>
			<ToolbarButton
				buttonRef={sortRef}
				label="Sort"
				count={config.sorts.length}
				active={panel === "sort"}
				onClick={() => setPanel(panel === "sort" ? null : "sort")}
			/>
			{!inBoard || boardGroupProp(store, view) ? (
				<ToolbarButton
					buttonRef={groupRef}
					label="Group"
					count={groupCount}
					active={panel === "group"}
					onClick={() => setPanel(panel === "group" ? null : "group")}
				/>
			) : null}
			<ToolbarButton
				buttonRef={propsRef}
				label="Properties"
				active={panel === "properties"}
				onClick={() => setPanel(panel === "properties" ? null : "properties")}
			/>
			<button
				ref={moreRef}
				type="button"
				aria-label="More"
				className="pb-3 text-graphite hover:text-ink coarse:flex coarse:h-10 coarse:w-9 coarse:shrink-0 coarse:items-center coarse:justify-center coarse:pb-0"
				onClick={() => setPanel(panel === "more" ? null : "more")}
			>
				•••
			</button>
			<Menu
				anchor={moreRef}
				open={panel === "more"}
				onClose={close}
				items={moreItems}
				align="end"
			/>
			{canEdit && (
				<div className="pb-2 max-md:hidden coarse:pb-0">
					<button
						type="button"
						onClick={onNew}
						className="flex h-[28px] items-center rounded-[5px] bg-accent px-[10px] text-sm font-medium text-white hover:opacity-90 coarse:h-9 coarse:px-3"
					>
						New
					</button>
				</div>
			)}
			{panel === "filter" && (
				<FilterPanel
					anchor={filterRef}
					store={store}
					view={view}
					onClose={close}
				/>
			)}
			{(panel === "sort" || panel === "group") && (
				<SortGroupPanel
					anchor={panel === "group" ? groupRef : sortRef}
					store={store}
					view={view}
					onClose={close}
				/>
			)}
			{panel === "properties" && (
				<PropertiesPanel
					anchor={propsRef}
					store={store}
					view={view}
					onClose={close}
				/>
			)}
		</div>
	);
}

function ActiveView({
	store,
	view,
	search,
	onOpenRow,
	peers,
	announce,
}: {
	store: DatabaseStore;
	view: View;
	search: string;
	onOpenRow: (id: string) => void;
	peers: ReturnType<typeof useCellPresence>["peers"];
	announce: ReturnType<typeof useCellPresence>["announce"];
}) {
	const shared = { store, view, search, onOpenRow };
	const phone = usePhone();
	if (phone && view.type === "table")
		return <PhoneRows store={store} view={view} search={search} />;
	switch (view.type) {
		case "board":
			return <BoardView {...shared} peers={peers} announce={announce} />;
		case "calendar":
			return <CalendarView {...shared} />;
		case "timeline":
			return <TimelineView {...shared} />;
		case "gallery":
			return <GalleryView {...shared} />;
		default:
			return <TableView {...shared} peers={peers} announce={announce} />;
	}
}

function StatusBar({
	store,
	view,
	search,
}: {
	store: DatabaseStore;
	view: View;
	search: string;
}) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: recomputed whenever the store changes
	const { ids, groups } = useMemo(
		() => store.rowsFor(view, search),
		[store, view, search, store.getVersion()],
	);
	if (view.type === "timeline" && !store.task) return null;
	const task = store.task;
	const fillingCount = store.aiFilling.size;
	return (
		<div
			className="flex h-11 shrink-0 items-center gap-5 border-t border-rule px-4 md:px-8 text-sm text-pencil max-md:h-[calc(44px+env(safe-area-inset-bottom))] max-md:px-5 max-md:pb-safe"
			data-testid="db-status"
		>
			<span>
				{ids.length.toLocaleString()} {ids.length === 1 ? "row" : "rows"}
				{groups
					? ` in ${groups.length} ${groups.length === 1 ? "group" : "groups"}`
					: ""}
				{store.loadingMore && " (loading)"}
			</span>
			{task && (
				// biome-ignore lint/a11y/useSemanticElements: a live status line, not a form output
				<span className="flex min-w-0 flex-1 items-center gap-2" role="status">
					{task.status === "running" && <Spinner size={12} />}
					<span
						className={
							task.status === "failed" ? "text-coral" : "text-graphite"
						}
					>
						{task.status === "failed"
							? `${task.label}: stopped at ${task.done} of ${task.total}. ${task.error}`
							: `${task.label}: ${task.done} of ${task.total}`}
					</span>
					{task.status === "running" ? (
						<span className="h-1.5 w-40 overflow-hidden rounded-sm bg-wash-2">
							<span
								className="block h-full bg-accent"
								style={{ width: `${(task.done / task.total) * 100}%` }}
							/>
						</span>
					) : (
						<>
							<button type="button" className="text-link" onClick={task.retry}>
								Retry
							</button>
							<button
								type="button"
								className="text-pencil hover:text-ink"
								onClick={() => store.dismissTask()}
							>
								Dismiss
							</button>
						</>
					)}
				</span>
			)}
			{!task && <span className="flex-1" />}
			{fillingCount > 0 && (
				<span className="text-link">
					AI is filling {fillingCount} {fillingCount === 1 ? "cell" : "cells"}
				</span>
			)}
		</div>
	);
}
