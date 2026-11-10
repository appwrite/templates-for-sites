// Gallery view: each row is a card with a cover image.
import { statusProp } from "./CalendarView";
import type { DatabaseStore } from "./store";
import { columnsFor } from "./TableView";
import type { FileValue, View } from "./types";
import { Chip } from "./ui";
import { asArray, choiceById, displayText, isEmptyValue } from "./values";

export function coverFor(store: DatabaseStore, rowId: string, mode: string) {
	const row = store.rows.get(rowId);
	if (mode === "none") return null;
	if (mode === "page-cover") return row?.coverFileId ?? null;
	const firstImage = store.properties
		.filter((p) => p.type === "files")
		.flatMap((p) => asArray(store.value(rowId, p.id)) as FileValue[])
		.find((f) => f.mime?.startsWith("image/") ?? true);
	return firstImage?.fileId ?? row?.coverFileId ?? null;
}

export function GalleryView({
	store,
	view,
	search,
	onOpenRow,
}: {
	store: DatabaseStore;
	view: View;
	search: string;
	onOpenRow: (rowId: string) => void;
}) {
	const config = store.configFor(view);
	const { ids } = store.rowsFor(view, search);
	const status = statusProp(store);
	const canEdit = store.access.canEdit;
	const meta = columnsFor(store, config).filter(
		(p) => p.type !== "title" && p.id !== status?.id && p.type !== "files",
	);
	return (
		<div className="min-h-0 flex-1 overflow-auto px-4 md:px-8 pt-5 pb-6">
			<div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-5 pt-1">
				{ids.map((id) => {
					const row = store.rows.get(id);
					const cover = coverFor(store, id, config.cover);
					const choice = status
						? choiceById(status, store.value(id, status.id))
						: undefined;
					const line = meta
						.filter((p) => !isEmptyValue(store.value(id, p.id)))
						.slice(0, 2)
						.map((p) => displayText(p, store.value(id, p.id), store.names))
						.filter(Boolean)
						.join(", ");
					return (
						<button
							key={id}
							type="button"
							data-gallery-card={row?.title ?? ""}
							onClick={() => onOpenRow(id)}
							className="flex flex-col justify-start overflow-hidden rounded-lg border border-rule bg-card text-left hover:border-pencil"
						>
							<div className="flex h-[200px] items-center justify-center overflow-hidden border-b border-rule bg-wash">
								{cover ? (
									<img
										src={`/api/files/${cover}`}
										alt=""
										loading="lazy"
										className="h-full w-full object-cover"
									/>
								) : (
									<span className="font-serif text-[28px] text-pencil">
										{(row?.title || "Untitled").slice(0, 1).toUpperCase()}
									</span>
								)}
							</div>
							<div className="flex items-start gap-3 p-3.5">
								<div className="min-w-0 flex-1">
									<div className="truncate text-base font-medium text-ink">
										{row?.title || "Untitled"}
									</div>
									<div className="truncate text-sm text-graphite">{line}</div>
								</div>
								{choice && <Chip color={choice.color}>{choice.name}</Chip>}
							</div>
						</button>
					);
				})}
				{!ids.length && (
					<p className="col-span-full py-8 text-base text-graphite">
						No rows to show.
					</p>
				)}
				{canEdit && (
					<button
						type="button"
						onClick={() => onOpenRow(store.createRow())}
						className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-rule-strong text-base text-pencil hover:text-ink"
					>
						+ New
					</button>
				)}
			</div>
		</div>
	);
}
