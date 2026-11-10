// A table is too wide for a phone, so rows read as a list (board 92). Tapping one opens its page.
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "#/components/icons";
import { Skeleton } from "#/components/ui";
import { ValueDisplay } from "./cells";
import type { DatabaseStore } from "./store";
import { columnsFor } from "./TableView";
import type { Property, View } from "./types";
import { isEmptyValue } from "./values";

export function PhoneRows({
	store,
	view,
	search,
}: {
	store: DatabaseStore;
	view: View;
	search: string;
}) {
	const config = store.configFor(view);
	const props = columnsFor(store, config);
	const { ids, groups } = store.rowsFor(view, search);

	if (store.status === "loading" && ids.length === 0) {
		return (
			<div className="flex flex-col gap-3 px-5 pt-4" aria-busy="true">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-16" />
				))}
			</div>
		);
	}

	if (ids.length === 0) {
		return (
			<div className="px-5 py-10 text-center text-base text-pencil">
				{search ? "No rows match that search." : "Nothing here yet."}
				{store.access.canEdit && !search && (
					<button
						type="button"
						className="mt-3 flex h-10 w-full items-center justify-center gap-1 text-link"
						onClick={() => store.createRow({ cells: {} })}
					>
						<PlusIcon size={13} /> New row
					</button>
				)}
			</div>
		);
	}

	const row = (id: string) => (
		<PhoneRow key={id} store={store} id={id} props={props} />
	);

	return (
		<div
			className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
			data-testid="db-phone-rows"
		>
			{groups
				? groups.map((group) =>
						group.ids.length ? (
							<section key={group.key}>
								<h3 className="pb-1 pt-4 text-sm font-medium text-pencil">
									{group.label}
									<span className="ml-1.5">{group.ids.length}</span>
								</h3>
								{group.ids.map(row)}
							</section>
						) : null,
					)
				: ids.map(row)}
		</div>
	);
}

function PhoneRow({
	store,
	id,
	props,
}: {
	store: DatabaseStore;
	id: string;
	props: Property[];
}) {
	const has = (p: Property) => !isEmptyValue(store.value(id, p.id));
	const chip = props.find(
		(p) => (p.type === "status" || p.type === "select") && has(p),
	);
	const line = props.find(
		(p) => ["text", "ai", "formula"].includes(p.type) && has(p),
	);
	const person = props.find((p) => p.type === "person" && has(p));
	const trailing = props.find(
		(p) =>
			p !== chip && ["select", "number", "date"].includes(p.type) && has(p),
	);
	return (
		<Link
			to="/p/$pageId"
			params={{ pageId: id }}
			className="block border-b border-rule py-3 active:bg-wash"
			data-phone-row={store.rows.get(id)?.title ?? ""}
		>
			<div className="flex items-start justify-between gap-3">
				<span className="min-w-0 truncate text-[15px] font-semibold leading-[22px] text-ink">
					{store.rows.get(id)?.title || (
						<span className="font-normal text-pencil">Untitled</span>
					)}
				</span>
				{chip && (
					<span className="shrink-0">
						<ValueDisplay
							store={store}
							prop={chip}
							value={store.value(id, chip.id)}
							rowId={id}
						/>
					</span>
				)}
			</div>
			{line && (
				<p className="mt-0.5 line-clamp-2 text-sm leading-[19px] text-graphite">
					{store.text(id, line.id)}
				</p>
			)}
			{(person || trailing) && (
				<div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-graphite">
					<span className="flex min-w-0 items-center">
						{person && (
							<ValueDisplay
								store={store}
								prop={person}
								value={store.value(id, person.id)}
								rowId={id}
							/>
						)}
					</span>
					<span className="shrink-0 text-pencil">
						{trailing && (
							<ValueDisplay
								store={store}
								prop={trailing}
								value={store.value(id, trailing.id)}
								rowId={id}
							/>
						)}
					</span>
				</div>
			)}
		</Link>
	);
}
