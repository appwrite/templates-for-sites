// CSV import: choose or paste a file, map its columns, then write through batches with progress.
import { useMemo, useState } from "react";
import { Button, Dialog } from "#/components/ui";
import { errorText } from "#/lib/errors";
import {
	type CsvTable,
	inferType,
	parseBool,
	parseCsv,
	parseDateText,
	parseNumber,
} from "./csv";
import type { DatabaseStore } from "./store";
import type { Choice, Property, PropertyType } from "./types";
import { COLOR_CYCLE } from "./types";

type Mapping = {
	skip: boolean;
	existingId: string | null;
	name: string;
	type: PropertyType;
};

const IMPORT_TYPES: { value: PropertyType; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "select", label: "Select" },
	{ value: "multi_select", label: "Multi-select" },
	{ value: "status", label: "Status" },
	{ value: "date", label: "Date" },
	{ value: "checkbox", label: "Checkbox" },
	{ value: "url", label: "URL" },
	{ value: "email", label: "Email" },
];

function convertCell(
	raw: string,
	type: PropertyType,
	choices: Choice[],
): unknown {
	const value = raw.trim();
	switch (type) {
		case "number":
			return parseNumber(value);
		case "checkbox":
			return parseBool(value);
		case "date": {
			const iso = parseDateText(value);
			return iso ? { start: iso } : null;
		}
		case "select":
		case "status":
			return (
				choices.find((c) => c.name.toLowerCase() === value.toLowerCase())?.id ??
				null
			);
		case "multi_select":
			return value
				.split(",")
				.map((s) => s.trim().toLowerCase())
				.map((name) => choices.find((c) => c.name.toLowerCase() === name)?.id)
				.filter(Boolean);
		default:
			return value || null;
	}
}

export function ImportDialog({
	store,
	onClose,
	initialText,
	mode,
}: {
	store: DatabaseStore;
	onClose: () => void;
	initialText?: string;
	mode?: "paste";
}) {
	const [dropped] = useState<CsvTable | null>(() =>
		initialText ? parseCsv(initialText) : null,
	);
	const [table, setTable] = useState<CsvTable | null>(
		dropped?.rows.length ? dropped : null,
	);
	const [paste, setPaste] = useState("");
	const [error, setError] = useState<string | null>(
		dropped && !dropped.rows.length ? "That file has no rows." : null,
	);
	const nameColumn = (csv: CsvTable) => {
		const at = csv.headers.findIndex((h) =>
			["name", "title", "task"].includes(h.toLowerCase()),
		);
		return at >= 0 ? at : 0;
	};
	const [titleCol, setTitleCol] = useState(() =>
		table ? nameColumn(table) : 0,
	);
	const [busy, setBusy] = useState(false);
	const [mappings, setMappings] = useState<Mapping[]>(() =>
		table ? initialMappings(table, store) : [],
	);

	const load = (csv: CsvTable) => {
		if (!csv.headers.length || !csv.rows.length) {
			setError("That file has no rows.");
			return;
		}
		setError(null);
		setTable(csv);
		setMappings(initialMappings(csv, store));
		setTitleCol(nameColumn(csv));
	};

	const onFile = async (file: File | undefined) => {
		if (!file) return;
		load(parseCsv(await file.text()));
	};

	const patch = (i: number, p: Partial<Mapping>) =>
		setMappings((list) => list.map((m, x) => (x === i ? { ...m, ...p } : m)));

	const preview = useMemo(() => table?.rows.slice(0, 3) ?? [], [table]);

	const run = async () => {
		if (!table || busy) return;
		setBusy(true);
		setError(null);
		const titleIndex = titleCol;
		// New columns first, so the batches can reference their ids.
		const columns: { index: number; prop: Property }[] = [];
		const existingPropertyIds = new Set(store.properties.map((p) => p.id));
		try {
			for (let i = 0; i < table.headers.length; i++) {
				const m = mappings[i];
				if (i === titleIndex || m.skip) continue;
				if (m.existingId && existingPropertyIds.has(m.existingId)) {
					columns.push({
						index: i,
						prop: store.propsById.get(m.existingId) as Property,
					});
					continue;
				}
				const choices: Choice[] = [];
				if (
					m.type === "select" ||
					m.type === "status" ||
					m.type === "multi_select"
				) {
					const seen = new Set<string>();
					for (const row of table.rows) {
						const parts =
							m.type === "multi_select" ? row[i].split(",") : [row[i]];
						for (const part of parts) {
							const name = part.trim();
							if (name && !seen.has(name.toLowerCase())) {
								seen.add(name.toLowerCase());
								choices.push({
									id: `opt-${i}-${seen.size}`,
									name,
									color: COLOR_CYCLE[(seen.size - 1) % COLOR_CYCLE.length],
								});
							}
						}
					}
				}
				const prop = await store.createProperty({
					name: m.name,
					type: m.type,
					options: choices.length
						? { choices }
						: m.type === "number"
							? { format: "number" }
							: {},
				});
				columns.push({ index: i, prop });
			}
		} catch (err) {
			setBusy(false);
			setError(`Couldn't add a column: ${errorText(err)}`);
			return;
		}
		const drafts = table.rows.map((row) => ({
			title: row[titleIndex] ?? "",
			cells: columns
				.map(({ index, prop }) => ({
					propertyId: prop.id,
					value: convertCell(row[index], prop.type, prop.options.choices ?? []),
				}))
				.filter((c) => c.value !== null && c.value !== ""),
		}));
		onClose();
		await store.importRows(drafts);
	};

	if (!table) {
		return (
			<Dialog
				open
				onClose={onClose}
				title={mode === "paste" ? "Paste from a spreadsheet" : "Import CSV"}
				width={520}
			>
				{mode === "paste" ? (
					<>
						<textarea
							aria-label="Paste spreadsheet rows"
							className="h-48 w-full rounded-md border border-rule-strong bg-paper p-2 font-mono text-sm outline-none focus:border-link"
							placeholder="Paste rows copied from Google Sheets or Excel. The first row becomes the column names."
							value={paste}
							onChange={(e) => setPaste(e.target.value)}
						/>
						{error && <p className="mt-1 text-xs text-coral">{error}</p>}
						<div className="mt-3 flex justify-end gap-2">
							<Button variant="ghost" onClick={onClose}>
								Cancel
							</Button>
							<Button variant="primary" onClick={() => load(parseCsv(paste))}>
								Continue
							</Button>
						</div>
					</>
				) : (
					<>
						<label className="flex h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-rule-strong text-base text-graphite hover:text-ink">
							<span>Choose a CSV file</span>
							<span className="text-sm text-pencil">
								Exports from Notion, Airtable and spreadsheets work.
							</span>
							<input
								type="file"
								accept=".csv,.tsv,text/csv,text/tab-separated-values"
								hidden
								aria-label="Choose a CSV file"
								onChange={(e) => void onFile(e.target.files?.[0])}
							/>
						</label>
						{error && <p className="mt-2 text-xs text-coral">{error}</p>}
					</>
				)}
			</Dialog>
		);
	}

	return (
		<Dialog
			open
			onClose={onClose}
			title={`Import ${table.rows.length} rows`}
			width={640}
		>
			<div className="max-h-[52vh] overflow-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-left text-pencil">
							<th className="w-[44%] pb-1 font-normal">Column in your file</th>
							<th className="pb-1 font-normal">Becomes</th>
						</tr>
					</thead>
					<tbody>
						{table.headers.map((header, i) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: columns of a parsed file never reorder, and names can repeat
								key={`${header}-${i}`}
								className="border-t border-rule"
								data-testid="import-row"
							>
								<td className="py-1.5 pr-3">
									<div className="truncate font-medium">{header}</div>
									<div className="truncate text-pencil">
										{preview
											.map((r) => r[i])
											.filter(Boolean)
											.join(", ")}
									</div>
								</td>
								<td className="py-1.5">
									{i === titleCol ? (
										<span className="text-graphite">Name column</span>
									) : (
										<div className="flex items-center gap-2">
											<select
												aria-label={`Type for ${header}`}
												className="h-8 rounded-md border border-rule-strong bg-paper px-1.5 text-sm"
												value={
													mappings[i].existingId
														? `e:${mappings[i].existingId}`
														: `t:${mappings[i].type}`
												}
												onChange={(e) => {
													const v = e.target.value;
													if (v.startsWith("e:"))
														patch(i, { existingId: v.slice(2), skip: false });
													else if (v === "skip")
														patch(i, { skip: true, existingId: null });
													else
														patch(i, {
															skip: false,
															existingId: null,
															type: v.slice(2) as PropertyType,
														});
												}}
											>
												{store.properties
													.filter((p) => p.type !== "title")
													.map((p) => (
														<option key={p.id} value={`e:${p.id}`}>
															Add to {p.name}
														</option>
													))}
												{IMPORT_TYPES.map((t) => (
													<option key={t.value} value={`t:${t.value}`}>
														New {t.label} column
													</option>
												))}
												<option value="skip">Don't import</option>
											</select>
										</div>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-3">
				<label className="flex items-center gap-2 text-sm text-graphite">
					Name comes from
					<select
						aria-label="Name column"
						className="h-8 rounded-md border border-rule-strong bg-paper px-1.5 text-sm"
						value={titleCol}
						onChange={(e) => setTitleCol(Number(e.target.value))}
					>
						{table.headers.map((h, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: columns of a parsed file never reorder, and names can repeat
							<option key={`${h}-${i}`} value={i}>
								{h}
							</option>
						))}
					</select>
				</label>
				<div className="flex items-center gap-2">
					{error && <span className="text-xs text-coral">{error}</span>}
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" loading={busy} onClick={run}>
						Import rows
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

function initialMappings(table: CsvTable, store: DatabaseStore): Mapping[] {
	return table.headers.map((header, i) => {
		const inferred = inferType(table.rows.map((r) => r[i]));
		const existing = store.properties.find(
			(p) =>
				p.type !== "title" && p.name.toLowerCase() === header.toLowerCase(),
		);
		return {
			skip: false,
			existingId: existing?.id ?? null,
			name: header,
			type: inferred as PropertyType,
		};
	});
}

export function exportCsv(
	store: DatabaseStore,
	rowIds: string[],
	props: Property[],
	fileName: string,
) {
	const headers = props.map((p) => p.name);
	const rows = rowIds.map((id) => props.map((p) => store.text(id, p.id)));
	const csv = [headers, ...rows]
		.map((row) => row.map(csvField).join(","))
		.join("\r\n");
	const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${fileName}.csv`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function csvField(value: string) {
	return value.includes(",") ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
		? `"${value.split('"').join('""')}"`
		: value;
}
