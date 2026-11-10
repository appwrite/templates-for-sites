// Timeline view: rows as bars across months, dragged to move and resized at either end.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, usePhone } from "#/components/ui";
import {
	chipColorFor,
	dateProps,
	parseDay,
	statusProp,
	toIso,
	viewDateProp,
} from "./CalendarView";
import { localToday } from "./cells";
import type { DatabaseStore } from "./store";
import type { DateValue, View, ViewConfig } from "./types";
import { CHIP_CLASSES, CHIP_SOLID } from "./types";
import { nextPropertyName } from "./ui";
import { asArray, formatDateValue } from "./values";

const DAY_MS = 86_400_000;
const NAME_COL = 224;
const ROW_H = 64;

const PX_PER_DAY: Record<ViewConfig["scale"], number> = {
	quarters: 2.67,
	months: 6,
	weeks: 18,
};

const SCALES: { value: ViewConfig["scale"]; label: string }[] = [
	{ value: "quarters", label: "Quarters" },
	{ value: "months", label: "Months" },
	{ value: "weeks", label: "Weeks" },
];

type DragState = {
	rowId: string;
	kind: "move" | "start" | "end";
	originX: number;
	startIso: string;
	endIso: string;
	deltaDays: number;
};

export function TimelineView({
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
	const prop = viewDateProp(store, view);
	const { ids } = store.rowsFor(view, search);
	const canEdit = store.access.canEdit;
	const status = statusProp(store);
	const person = store.properties.find((p) => p.type === "person") ?? null;
	const pxPerDay = PX_PER_DAY[config.scale];
	const [drag, setDrag] = useState<DragState | null>(null);
	const axisStart = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const phone = usePhone();
	const nameCol = phone ? 128 : NAME_COL;
	// Opens on today, not three months ago.
	const opened = useRef(false);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el || opened.current) return;
		opened.current = true;
		el.scrollLeft = Math.max(
			0,
			((Date.now() - axisStart.current) / DAY_MS) * PX_PER_DAY[config.scale] -
				80,
		);
	});

	const axis = useMemo(() => {
		const now = new Date();
		let min = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1),
		);
		let max = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 9, 1),
		);
		if (prop) {
			for (const id of ids) {
				const value = store.value(id, prop.id) as DateValue | null;
				if (!value?.start) continue;
				const start = parseDay(value.start);
				const end = parseDay(value.end ?? value.start);
				if (start < min)
					min = new Date(
						Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1),
					);
				if (end > max)
					max = new Date(
						Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 2, 1),
					);
			}
		}
		const months: { key: string; label: string; start: number; end: number }[] =
			[];
		const cursor = new Date(min);
		while (cursor < max) {
			const start = cursor.getTime();
			const next = new Date(
				Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
			);
			months.push({
				key: toIso(cursor),
				label: cursor.toLocaleDateString(undefined, {
					month: "short",
					timeZone: "UTC",
				}),
				start,
				end: next.getTime(),
			});
			cursor.setTime(next.getTime());
		}
		return { start: min.getTime(), end: max.getTime(), months };
	}, [ids, prop, store]);

	const quarters = useMemo(() => {
		const out: { key: string; label: string; width: number }[] = [];
		for (const m of axis.months) {
			const d = new Date(m.start);
			const label = `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
			const last = out[out.length - 1];
			const width = ((m.end - m.start) / DAY_MS) * pxPerDay;
			if (last?.label === label) last.width += width;
			else out.push({ key: `${label}-${m.key}`, label, width });
		}
		return out;
	}, [axis.months, pxPerDay]);

	if (!prop) {
		return (
			<div className="px-4 py-12 text-base text-graphite md:px-8">
				<p>A timeline needs a Date column to place its rows.</p>
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

	axisStart.current = axis.start;
	const totalWidth = ((axis.end - axis.start) / DAY_MS) * pxPerDay;
	const xOf = (iso: string) =>
		((parseDay(iso).getTime() - axis.start) / DAY_MS) * pxPerDay;
	const todayX = xOf(localToday());
	const widthOf = (range: DateValue) =>
		Math.max(
			10,
			((parseDay(range.end ?? range.start).getTime() -
				parseDay(range.start).getTime()) /
				DAY_MS +
				1) *
				pxPerDay,
		);

	const previewRange = (d: DragState) => {
		const shift = (iso: string, days: number) =>
			toIso(new Date(parseDay(iso).getTime() + days * DAY_MS));
		if (d.kind === "move")
			return {
				start: shift(d.startIso, d.deltaDays),
				end: shift(d.endIso, d.deltaDays),
			};
		if (d.kind === "start") {
			const start = shift(d.startIso, d.deltaDays);
			return { start: start <= d.endIso ? start : d.endIso, end: d.endIso };
		}
		const end = shift(d.endIso, d.deltaDays);
		return { start: d.startIso, end: end >= d.startIso ? end : d.startIso };
	};

	const beginDrag = (
		e: React.PointerEvent,
		rowId: string,
		kind: DragState["kind"],
		value: DateValue,
	) => {
		if (!canEdit) return;
		e.preventDefault();
		e.stopPropagation();
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		const originX = e.clientX;
		const end = value.end ?? value.start;
		let moved = false;
		let latest: DragState | null = null;
		const onMove = (ev: PointerEvent) => {
			const deltaDays = Math.round((ev.clientX - originX) / pxPerDay);
			moved = moved || Math.abs(ev.clientX - originX) > 3;
			latest = {
				rowId,
				kind,
				originX,
				startIso: value.start,
				endIso: end,
				deltaDays,
			};
			setDrag(latest);
		};
		const onUp = () => {
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			setDrag(null);
			if (latest && latest.deltaDays !== 0) {
				const range = previewRange(latest);
				store.setCell(
					rowId,
					prop.id,
					range.end > range.start ? range : { start: range.start },
				);
			}
			if (!moved && kind === "move") onOpenRow(rowId);
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
	};

	const legend = status?.options.choices ?? [];

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-end gap-3 px-4 md:px-8 pt-3 pb-2 text-sm">
				<label className="flex items-center gap-1.5 text-graphite">
					Show by
					<select
						aria-label="Timeline date column"
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
				</label>
				<select
					aria-label="Timeline zoom"
					className="h-[26px] rounded-sm border border-rule bg-paper px-1 text-sm coarse:h-10"
					value={config.scale}
					onChange={(e) =>
						store.updateConfig(view, {
							scale: e.target.value as ViewConfig["scale"],
						})
					}
				>
					{SCALES.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>
			</div>
			<div
				ref={scrollRef}
				className="min-h-0 flex-1 overflow-auto"
				data-testid="timeline"
			>
				<div className="relative" style={{ width: nameCol + totalWidth }}>
					<div className="sticky top-0 z-30 flex bg-paper">
						<div
							className="sticky left-0 z-30 flex items-end border-r border-b border-rule bg-paper pb-2 pl-8 text-sm text-pencil max-md:pl-5"
							style={{ width: nameCol, height: 57 }}
						>
							Name
						</div>
						<div className="border-b border-rule" style={{ width: totalWidth }}>
							<div className="flex h-7 items-end">
								{quarters.map((q) => (
									<div
										key={q.key}
										className="border-l border-rule pb-0.5 pl-2 text-sm font-medium text-ink"
										style={{ width: q.width }}
									>
										{q.label}
									</div>
								))}
							</div>
							<div className="flex h-7 items-end">
								{axis.months.map((m) => (
									<div
										key={m.key}
										className="truncate border-l border-rule pb-1 pl-2 text-xs text-pencil"
										style={{ width: ((m.end - m.start) / DAY_MS) * pxPerDay }}
									>
										{m.label}
									</div>
								))}
							</div>
						</div>
					</div>
					<div
						className="pointer-events-none absolute z-20 w-0.5 bg-accent"
						style={{
							left: nameCol + todayX,
							top: 0,
							height: ids.length * ROW_H + 57 + ROW_H,
						}}
					/>
					<div
						className="absolute top-1 z-20 rounded-sm bg-accent px-1.5 text-xs leading-[18px] font-medium whitespace-nowrap text-white"
						style={{ left: nameCol + todayX - 50 }}
					>
						Today
					</div>
					{ids.map((id) => {
						const value = store.value(id, prop.id) as DateValue | null;
						const dragging = drag?.rowId === id ? previewRange(drag) : null;
						const range: DateValue | null = dragging ?? value;
						const persons = person
							? asArray(store.value(id, person.id)).map(String)
							: [];
						const color = chipColorFor(store, status, id);
						return (
							<div
								key={id}
								className="relative flex border-b border-rule"
								style={{ height: ROW_H, width: nameCol + totalWidth }}
								data-timeline-row={store.rows.get(id)?.title ?? ""}
							>
								<button
									type="button"
									onClick={() => onOpenRow(id)}
									className="sticky left-0 z-20 flex items-center border-r border-rule bg-paper pl-8 text-left text-base font-medium max-md:pl-5"
									style={{ width: nameCol }}
								>
									<span className="truncate">
										{store.rows.get(id)?.title || "Untitled"}
									</span>
								</button>
								<div className="relative" style={{ width: totalWidth }}>
									{range?.start ? (
										// biome-ignore lint/a11y/useSemanticElements: bars are dragged and resized with the pointer, and hold a handle
										<div
											role="button"
											aria-disabled={!canEdit}
											tabIndex={canEdit ? 0 : undefined}
											aria-label={`${store.rows.get(id)?.title || "Untitled"}, ${formatDateValue(range)}`}
											data-timeline-bar={store.rows.get(id)?.title ?? ""}
											className={`absolute top-[15px] flex h-[34px] touch-none items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm whitespace-nowrap ${CHIP_CLASSES[color]} ${dragging ? "ring-2 ring-link" : ""}`}
											style={{
												left: xOf(range.start),
												width: widthOf(range),
											}}
											onPointerDown={(e) =>
												beginDrag(e, id, "move", value as DateValue)
											}
										>
											{canEdit && (
												<span
													className="absolute top-0 left-0 z-10 h-full cursor-ew-resize"
													style={{ width: Math.min(8, widthOf(range) / 4) }}
													onPointerDown={(e) =>
														beginDrag(e, id, "start", value as DateValue)
													}
												/>
											)}
											{persons[0] && widthOf(range) >= 40 && (
												<Avatar
													id={persons[0]}
													name={store.names.person(persons[0])}
													size={20}
												/>
											)}
											{widthOf(range) >= 120 && (
												<span>{formatDateValue(range)}</span>
											)}
											{canEdit && (
												<span
													data-timeline-end-handle
													className="absolute top-0 right-0 z-10 h-full cursor-ew-resize"
													style={{ width: Math.min(8, widthOf(range) / 4) }}
													onPointerDown={(e) =>
														beginDrag(e, id, "end", value as DateValue)
													}
												/>
											)}
										</div>
									) : canEdit ? (
										<button
											type="button"
											className="group/empty absolute inset-0 text-left hover:bg-wash/60"
											aria-label={`Set a date for ${store.rows.get(id)?.title || "this row"}`}
											onClick={(e) => {
												const rect = e.currentTarget.getBoundingClientRect();
												const days = Math.round(
													(e.clientX - rect.left) / pxPerDay,
												);
												const start = toIso(
													new Date(axis.start + days * DAY_MS),
												);
												store.setCell(id, prop.id, {
													start,
													end: toIso(
														new Date(parseDay(start).getTime() + 7 * DAY_MS),
													),
												});
											}}
										>
											<span className="absolute top-[22px] left-3 hidden text-sm text-pencil group-hover/empty:inline">
												Click to set a date
											</span>
										</button>
									) : null}
								</div>
							</div>
						);
					})}
					{canEdit && (
						<button
							type="button"
							className="sticky left-0 z-20 flex h-11 items-center pl-8 text-base text-pencil hover:text-ink"
							onClick={() => onOpenRow(store.createRow())}
						>
							+ New row
						</button>
					)}
				</div>
			</div>
			<div className="flex h-11 shrink-0 items-center justify-end gap-4 border-t border-rule px-4 md:px-8 text-sm text-graphite">
				{legend.map((choice) => (
					<span key={choice.id} className="flex items-center gap-1.5">
						<span
							className="h-2 w-2 rounded-[2px]"
							style={{ backgroundColor: CHIP_SOLID[choice.color] }}
						/>
						{choice.name}
					</span>
				))}
			</div>
		</div>
	);
}
