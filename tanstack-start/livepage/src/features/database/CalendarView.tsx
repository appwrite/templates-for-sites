// Month calendar: rows by date, drag a row to another day to move it.
import { useState } from "react";
import { ChevronRight } from "#/components/icons";
import { Button, usePhone } from "#/components/ui";
import { localToday } from "./cells";
import type { DatabaseStore } from "./store";
import type { ChipColor, DateValue, Property, View } from "./types";
import { CHIP_CLASSES } from "./types";
import { nextPropertyName } from "./ui";
import { choiceById } from "./values";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MS = 86_400_000;

export const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (iso: string) =>
	new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export function dateProps(store: DatabaseStore) {
	return store.properties.filter((p) => p.type === "date");
}

export function viewDateProp(store: DatabaseStore, view: View) {
	const config = store.configFor(view);
	return (
		(config.dateProperty ? store.propsById.get(config.dateProperty) : null) ??
		dateProps(store)[0] ??
		null
	);
}

export function shiftDate(value: DateValue, days: number): DateValue {
	const start = new Date(parseDay(value.start).getTime() + days * DAY_MS);
	const end = value.end
		? new Date(parseDay(value.end).getTime() + days * DAY_MS)
		: undefined;
	return { start: toIso(start), ...(end ? { end: toIso(end) } : {}) };
}

export function statusProp(store: DatabaseStore) {
	return (
		store.properties.find((p) => p.type === "status") ??
		store.properties.find((p) => p.type === "select") ??
		null
	);
}

export function chipColorFor(
	store: DatabaseStore,
	prop: Property | null,
	rowId: string,
): ChipColor {
	if (!prop) return "blue";
	const choice = choiceById(prop, store.value(rowId, prop.id));
	return choice?.color ?? "blue";
}

export function CalendarView({
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
	const prop = viewDateProp(store, view);
	const today = new Date(`${localToday()}T00:00:00Z`);
	const [month, setMonth] = useState(
		new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
	);
	const [dragId, setDragId] = useState<string | null>(null);
	const [overDay, setOverDay] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const canEdit = store.access.canEdit;
	const phone = usePhone();
	const { ids } = store.rowsFor(view, search);
	const status = statusProp(store);

	if (!prop) {
		return (
			<div className="px-4 py-12 text-base text-graphite md:px-8">
				<p>A calendar needs a Date column to place its rows.</p>
				{canEdit && (
					<Button
						className="mt-3"
						onClick={() =>
							void store.createProperty({
								name: nextPropertyName(store, "Date"),
								type: "date",
								options: {},
							})
						}
					>
						Add a Date column
					</Button>
				)}
			</div>
		);
	}

	const first = new Date(month);
	const startOffset = (first.getUTCDay() + 6) % 7;
	const cells = Array.from({ length: 42 }, (_, i) => {
		const d = new Date(first);
		d.setUTCDate(1 - startOffset + i);
		return d;
	});
	const weeks = cells.length / 7;
	const byDay = new Map<string, string[]>();
	for (const id of ids) {
		const value = store.value(id, prop.id) as DateValue | null;
		if (!value?.start) continue;
		const key = value.start.slice(0, 10);
		const list = byDay.get(key);
		if (list) list.push(id);
		else byDay.set(key, [id]);
	}
	const todayIso = localToday();
	const monthLabel = month.toLocaleDateString(undefined, {
		month: "long",
		timeZone: "UTC",
	});

	const moveTo = (rowId: string, iso: string) => {
		const current = store.value(rowId, prop.id) as DateValue | null;
		if (current?.start) {
			const delta = Math.round(
				(parseDay(iso).getTime() - parseDay(current.start).getTime()) / DAY_MS,
			);
			store.setCell(rowId, prop.id, shiftDate(current, delta));
		} else store.setCell(rowId, prop.id, { start: iso });
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-end justify-between gap-x-3 px-4 md:px-8 pt-4 pb-2">
				<h2 className="font-serif text-[28px] md:text-[36px] leading-[44px] font-medium tracking-[-0.02em]">
					{monthLabel}{" "}
					<span className="text-pencil">{month.getUTCFullYear()}</span>
				</h2>
				<div className="flex items-center gap-2 text-base text-graphite">
					{dateProps(store).length > 1 && (
						<select
							aria-label="Calendar date column"
							className="h-[26px] rounded-sm border border-rule bg-paper px-1 text-sm coarse:h-10"
							value={prop.id}
							onChange={(e) =>
								store.updateConfig(view, { dateProperty: e.target.value })
							}
						>
							{dateProps(store).map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							setMonth(
								new Date(
									Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
								),
							)
						}
					>
						Today
					</Button>
					<button
						type="button"
						aria-label="Previous month"
						className="rounded-sm p-1 hover:bg-wash-2 coarse:flex coarse:size-10 coarse:items-center coarse:justify-center"
						onClick={() =>
							setMonth(
								new Date(
									Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1),
								),
							)
						}
					>
						<ChevronRight size={14} className="rotate-180" />
					</button>
					<button
						type="button"
						aria-label="Next month"
						className="rounded-sm p-1 hover:bg-wash-2 coarse:flex coarse:size-10 coarse:items-center coarse:justify-center"
						onClick={() =>
							setMonth(
								new Date(
									Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
								),
							)
						}
					>
						<ChevronRight size={14} />
					</button>
				</div>
			</div>
			{phone && (
				<PhoneAgenda
					store={store}
					byDay={byDay}
					monthKey={`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`}
					todayIso={todayIso}
					status={status}
					onOpenRow={onOpenRow}
				/>
			)}
			{!phone && (
				<>
					<div className="grid grid-cols-7 border-b border-rule px-4 md:px-8 text-sm text-pencil">
						{DAYS.map((d) => (
							<div key={d} className="px-1.5 pb-2">
								{d}
							</div>
						))}
					</div>
					<div
						className="grid min-h-0 flex-1 grid-cols-7 overflow-auto px-4 md:px-8"
						style={{
							gridTemplateRows: `repeat(${weeks}, minmax(124px, auto))`,
						}}
					>
						{cells.map((date) => {
							const iso = toIso(date);
							const inMonth = date.getUTCMonth() === month.getUTCMonth();
							const isToday = iso === todayIso;
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the day's chips are the controls
								<div
									key={iso}
									data-day={iso}
									className={`group/day relative border-b border-rule p-1.5 ${inMonth ? "" : "bg-wash/60"} ${overDay === iso ? "bg-link-soft" : ""}`}
									onDragOver={(e) => {
										if (!dragId) return;
										e.preventDefault();
										setOverDay(iso);
									}}
									onDrop={(e) => {
										e.preventDefault();
										if (dragId) moveTo(dragId, iso);
										setDragId(null);
										setOverDay(null);
									}}
								>
									<div className="flex items-center justify-between">
										<span
											className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-sm ${isToday ? "bg-accent font-semibold text-white" : inMonth ? "text-graphite" : "text-pencil"}`}
										>
											{date.getUTCDate()}
										</span>
										{canEdit && (
											<button
												type="button"
												aria-label={`New row on ${iso}`}
												className="hidden h-5 w-5 items-center justify-center rounded-sm text-pencil hover:bg-wash-2 group-hover/day:flex"
												onClick={() => {
													const id = store.createRow({
														cells: { [prop.id]: { start: iso } },
													});
													onOpenRow(id);
												}}
											>
												+
											</button>
										)}
									</div>
									<div className="mt-1 flex flex-col gap-1">
										{(expanded === iso
											? (byDay.get(iso) ?? [])
											: (byDay.get(iso) ?? []).slice(0, 3)
										).map((id) => (
											<button
												key={id}
												type="button"
												draggable={canEdit}
												data-calendar-card={store.rows.get(id)?.title ?? ""}
												onDragStart={(e) => {
													e.dataTransfer.setData("text/plain", id);
													e.dataTransfer.effectAllowed = "move";
													setDragId(id);
												}}
												onDragEnd={() => {
													setDragId(null);
													setOverDay(null);
												}}
												onClick={() => onOpenRow(id)}
												className={`h-[22px] truncate rounded-sm px-1.5 text-left text-sm ${CHIP_CLASSES[chipColorFor(store, status, id)]} ${dragId === id ? "opacity-50" : ""}`}
											>
												{store.rows.get(id)?.title || "Untitled"}
											</button>
										))}
										{(byDay.get(iso)?.length ?? 0) > 3 && (
											<button
												type="button"
												className="px-1 text-left text-xs text-pencil hover:text-ink"
												onClick={() =>
													setExpanded(expanded === iso ? null : iso)
												}
											>
												{expanded === iso
													? "Show fewer"
													: `+${(byDay.get(iso)?.length ?? 0) - 3} more`}
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</>
			)}
		</div>
	);
}

// A month grid has no room for titles on a phone, so the month reads as a day list instead.
function PhoneAgenda({
	store,
	byDay,
	monthKey,
	todayIso,
	status,
	onOpenRow,
}: {
	store: DatabaseStore;
	byDay: Map<string, string[]>;
	monthKey: string;
	todayIso: string;
	status: Property | null;
	onOpenRow: (rowId: string) => void;
}) {
	const days = [...byDay.keys()]
		.filter((iso) => iso.startsWith(monthKey))
		.sort();
	if (days.length === 0)
		return (
			<p className="px-5 py-10 text-center text-base text-pencil">
				Nothing scheduled this month.
			</p>
		);
	return (
		<div
			className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
			data-testid="calendar-agenda"
		>
			{days.map((iso) => {
				const date = new Date(`${iso}T00:00:00Z`);
				const label = date.toLocaleDateString(undefined, {
					weekday: "short",
					day: "numeric",
					timeZone: "UTC",
				});
				return (
					<div key={iso} className="flex gap-3 border-b border-rule py-2.5">
						<div
							className={`flex h-10 w-14 shrink-0 items-center text-sm ${iso === todayIso ? "font-semibold text-link" : "text-pencil"}`}
						>
							{label}
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							{(byDay.get(iso) ?? []).map((id) => (
								<button
									key={id}
									type="button"
									data-calendar-card={store.rows.get(id)?.title ?? ""}
									onClick={() => onOpenRow(id)}
									className={`flex h-10 w-full items-center truncate rounded-md px-2.5 text-left text-[15px] ${CHIP_CLASSES[chipColorFor(store, status, id)]}`}
								>
									<span className="truncate">
										{store.rows.get(id)?.title || "Untitled"}
									</span>
								</button>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
