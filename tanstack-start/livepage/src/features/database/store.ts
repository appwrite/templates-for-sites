// The live model of one database: rows, cells, properties and views, loaded with cursors and kept
// current over Realtime. Cell edits are optimistic and per cell: an in-flight write for a cell owns
// that cell until it lands, so an echo or a peer's write can't flicker it, and two people editing
// different cells never touch each other's data.
import { ID, Query } from "appwrite";
import { isTrusted } from "#/features/editor/access";
import {
	fetchDatabase,
	submitCells,
	submitCreateProperty,
	submitCreateRows,
	submitCreateView,
	submitDeleteProperty,
	submitDeleteView,
	submitDuplicateRows,
	submitRowMeta,
	submitTrashRows,
	submitUpdateProperty,
	submitUpdateView,
} from "#/functions/database";
import { listRows, upsertRow, WriteError } from "#/lib/browser-appwrite";
import { fitCell } from "#/lib/cells";
import { errorText } from "#/lib/errors";
import type { LiveConnection, LiveEvent } from "#/lib/live";
import { cellPermissions, cellRowId, rowHash } from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import type { TooLong } from "#/server/database";
import {
	CELLS,
	DATABASE_ID,
	PAGES,
	PROPERTIES,
	rowsChannel,
	VIEWS,
} from "#/server/schema";
import {
	evaluateSafe,
	type Node,
	parseFormula,
	RuntimeError,
	refMap,
	refSpans,
	type Val,
} from "./formula";
import type {
	Choice,
	DatabaseAccess,
	DbRow,
	Property,
	PropertyType,
	RollupFn,
	View,
	ViewConfig,
	ViewType,
} from "./types";
import { isComputed, withDefaults } from "./types";
import {
	asArray,
	compareRows,
	displayText,
	EMPTY_GROUP,
	formatDateValue,
	groupKeys,
	groupLabel,
	isEmptyValue,
	matches,
	type Names,
	toFormulaValue,
} from "./values";

export type CellRec = {
	value: unknown;
	updatedAt: string;
	updatedBy: string;
	// Stamped by this browser's clock, so it can't be compared with server times. The next server copy replaces it.
	local?: boolean;
};

export type ComputedError = { error: string; label?: string };

export function isComputedError(v: unknown): v is ComputedError {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		"error" in (v as object)
	);
}

export type TaskState = {
	label: string;
	done: number;
	total: number;
	status: "running" | "failed";
	error?: string;
	retry?: () => void;
};

export type ViewGroups = {
	ids: string[];
	groups: { key: string; label: string; ids: string[] }[] | null;
};

const LOAD_ROWS = 500;
const LOAD_CELLS = 2000;
const BATCH_ROWS = 50;
const CELL_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

type ServerError = { message?: string };

const cellKey = (rowId: string, propId: string) => `${rowId}|${propId}`;

function parseValue(raw: unknown): unknown {
	if (typeof raw !== "string") return raw ?? null;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function toRow(row: Record<string, unknown>): DbRow {
	return {
		id: String(row.$id),
		title: String(row.title ?? ""),
		icon: (row.icon as string) || null,
		coverFileId: (row.coverFileId as string) || null,
		position: Number(row.position ?? 0),
		createdAt: String(row.$createdAt),
		updatedAt: String(row.$updatedAt),
		createdBy: String(row.createdBy ?? ""),
		updatedBy: String(row.updatedBy ?? ""),
	};
}

function parseOptions(raw: unknown) {
	if (typeof raw !== "string" || !raw) return {};
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function toProperty(row: Record<string, unknown>): Property {
	return {
		id: String(row.$id),
		databaseId: String(row.databaseId),
		name: String(row.name ?? ""),
		type: String(row.type ?? "text") as PropertyType,
		options: parseOptions(row.options),
		position: Number(row.position ?? 0),
	};
}

function toView(row: Record<string, unknown>): View {
	return {
		id: String(row.$id),
		databaseId: String(row.databaseId),
		name: String(row.name ?? ""),
		type: String(row.type ?? "table") as ViewType,
		config: withDefaults(parseOptions(row.config) as Partial<ViewConfig>),
		position: Number(row.position ?? 0),
	};
}

const CIRCULAR = "This formula depends on itself.";

export class DatabaseStore {
	readonly databaseId: string;
	page: Page | null = null;
	access: DatabaseAccess = { canEdit: false, direct: false };
	aiEnabled = false;
	properties: Property[] = [];
	propsById = new Map<string, Property>();
	views: View[] = [];
	rows = new Map<string, DbRow>();
	rowIds: string[] = [];
	cells = new Map<string, Map<string, CellRec>>();
	status: "loading" | "ready" | "error" = "loading";
	loadingMore = false;
	error: string | null = null;
	task: TaskState | null = null;
	members = new Map<string, string>();
	viewerId = "";

	private listeners = new Set<() => void>();
	private version = 0;
	private pending = new Map<
		string,
		{
			value: unknown;
			rowId: string;
			propId: string;
			dirty: boolean;
			original: CellRec | null;
		}
	>();
	private events: LiveEvent[] = [];
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: read by the ??= in queueEvent
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubs: (() => void)[] = [];
	private reverseCache = new Map<string, Map<string, string[]>>();
	private computedCache = new Map<string, unknown>();
	private computing = new Set<string>();
	private bumping = false;
	private lastEditCache = new Map<string, { at: string; by: string }>();
	private parsedFormulas = new Map<
		string,
		{ src: string; parsed: ReturnType<typeof parseFormula> }
	>();
	private viewResults = new Map<
		string,
		{ version: number; key: string; result: ViewGroups }
	>();
	onError: (message: string) => void = () => undefined;
	loadPromise: Promise<void> | null = null;
	private connection: LiveConnection | null = null;

	constructor(databaseId: string) {
		this.databaseId = databaseId;
	}

	// ---------- Subscriptions ----------

	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};

	getVersion = () => this.version;

	private bump() {
		// Two databases linked both ways listen to each other, so stop when the notification comes back around.
		if (this.bumping) return;
		this.bumping = true;
		try {
			this.version++;
			this.invalidateCaches();
			for (const fn of this.listeners) fn();
		} finally {
			this.bumping = false;
		}
	}

	private invalidateCaches() {
		this.reverseCache.clear();
		this.computedCache.clear();
		this.lastEditCache.clear();
		this.viewResults.clear();
	}

	// ---------- Load ----------

	load() {
		this.loadPromise ??= this.reload();
		return this.loadPromise;
	}

	async reload() {
		try {
			const snapshot = await fetchDatabase({
				data: { databaseId: this.databaseId },
			});
			this.page = snapshot.page;
			this.access = snapshot.access;
			this.aiEnabled = snapshot.aiEnabled;
			this.members = new Map(snapshot.people.map((p) => [p.userId, p.name]));
			this.setProperties(snapshot.properties as unknown as Property[]);
			this.setViews(
				snapshot.views.map((v) => ({
					...v,
					type: v.type as ViewType,
					config: withDefaults(v.config as Partial<ViewConfig>),
				})),
			);
			this.status = "ready";
			this.loadingMore = true;
			this.bump();
			await Promise.all([this.loadRows(), this.loadCells()]);
			this.loadingMore = false;
			this.bump();
			// Never awaited: two databases linked both ways would otherwise wait on each other forever.
			void this.loadRelated();
		} catch (err) {
			this.status = "error";
			this.error = errorText(err);
			this.loadingMore = false;
			this.bump();
		}
	}

	private async loadRows() {
		const fresh = new Map<string, DbRow>();
		let cursor: string | undefined;
		for (;;) {
			const page = await listRows(DATABASE_ID, PAGES, [
				Query.equal("databaseId", [this.databaseId]),
				Query.isNull("trashedAt"),
				Query.limit(LOAD_ROWS),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			]);
			for (const row of page.rows) fresh.set(row.$id, toRow(row));
			this.mergeRows(fresh);
			this.bump();
			if (page.rows.length < LOAD_ROWS) break;
			cursor = page.rows[page.rows.length - 1].$id;
		}
		// Drop rows that were removed while this tab was away.
		for (const id of [...this.rows.keys()]) {
			if (!fresh.has(id)) this.rows.delete(id);
		}
		this.sortRows();
		this.bump();
	}

	private async loadCells() {
		let cursor: string | undefined;
		for (;;) {
			const page = await listRows(DATABASE_ID, CELLS, [
				Query.equal("databaseId", [this.databaseId]),
				Query.limit(LOAD_CELLS),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			]);
			for (const row of page.rows) {
				const rowId = String(row.pageId);
				const propId = String(row.propertyId);
				if (this.pending.has(cellKey(rowId, propId))) continue;
				// Anyone signed in can add a row naming this database; only members' rows count.
				if (!this.trusted(row)) continue;
				this.writeCell(rowId, propId, {
					value: parseValue(row.value),
					updatedAt: String(row.$updatedAt),
					updatedBy: String(row.updatedBy ?? ""),
				});
			}
			this.bump();
			if (page.rows.length < LOAD_CELLS) break;
			cursor = page.rows[page.rows.length - 1].$id;
		}
	}

	private mergeRows(next: Map<string, DbRow>) {
		for (const [id, row] of next) {
			const existing = this.rows.get(id);
			if (!existing || existing.local || existing.updatedAt <= row.updatedAt)
				this.rows.set(id, row);
		}
		this.sortRows();
	}

	private sortRows() {
		this.rowIds = [...this.rows.values()]
			.sort(
				(a, b) =>
					a.position - b.position || a.createdAt.localeCompare(b.createdAt),
			)
			.map((r) => r.id);
	}

	private writeCell(rowId: string, propId: string, rec: CellRec) {
		let row = this.cells.get(rowId);
		if (!row) {
			row = new Map();
			this.cells.set(rowId, row);
		}
		row.set(propId, rec);
	}

	private setProperties(list: Property[]) {
		this.properties = [...list].sort((a, b) => a.position - b.position);
		this.propsById = new Map(this.properties.map((p) => [p.id, p]));
		this.parsedFormulas.clear();
	}

	private setViews(list: View[]) {
		this.views = [...list].sort((a, b) => a.position - b.position);
	}

	// ---------- Related databases ----------

	private related = new Map<string, DatabaseStore>();
	private relatedSubs = new Map<string, () => void>();

	private relatedIds() {
		const ids = new Set<string>();
		for (const prop of this.properties) {
			if (prop.type === "relation" && prop.options.targetDatabaseId)
				ids.add(prop.options.targetDatabaseId);
		}
		ids.delete(this.databaseId);
		return ids;
	}

	private async loadRelated() {
		await Promise.all(
			[...this.relatedIds()].map((id) => this.relatedStore(id).load()),
		);
	}

	relatedStore(id: string): DatabaseStore {
		if (id === this.databaseId) return this;
		let store = this.related.get(id);
		if (!store) {
			store = storeFor(id, this.viewerId);
			store.attach(this.connection);
			this.related.set(id, store);
			this.relatedSubs.set(
				id,
				store.subscribe(() => this.bump()),
			);
			void store.load();
		}
		return store;
	}

	// ---------- Realtime ----------

	attach(connection: LiveConnection | null) {
		if (this.connection === connection) return;
		this.detach();
		this.connection = connection;
		if (!connection) return;
		const filter = [Query.equal("databaseId", [this.databaseId])];
		const channels = [CELLS, PROPERTIES, VIEWS, PAGES];
		for (const table of channels) {
			this.unsubs.push(
				connection.subscribe({
					id: `db-${rowHash("sub", this.databaseId, table).slice(0, 24)}`,
					channels: [rowsChannel(table)],
					queries: filter,
					onEvent: (event) => this.onEvent(event),
				}),
			);
		}
		// The database's own row is what says who has access, so writes use the live version of it.
		this.unsubs.push(
			connection.subscribe({
				id: `db-${rowHash("self", this.databaseId).slice(0, 24)}`,
				channels: [rowsChannel(PAGES)],
				queries: [Query.equal("$id", [this.databaseId])],
				onEvent: (event) => this.onEvent(event),
			}),
		);
		for (const store of this.related.values()) store.attach(connection);
	}

	detach() {
		for (const off of this.unsubs) off();
		this.unsubs = [];
		this.connection = null;
	}

	private onEvent(event: LiveEvent) {
		this.events.push(event);
		this.flushTimer ??= setTimeout(() => {
			this.flushTimer = null;
			this.flushEvents();
		}, 30);
	}

	private flushEvents() {
		const events = this.events;
		this.events = [];
		let touched = false;
		for (const event of events) {
			const row = event.payload as Record<string, unknown>;
			const removed = event.events.some((e) => e.endsWith(".delete"));
			const channel = event.channels.join(" ");
			if (channel.includes(`.tables.${CELLS}.`)) {
				touched = this.applyCellEvent(row, removed) || touched;
			} else if (channel.includes(`.tables.${PROPERTIES}.`)) {
				this.applyPropertyEvent(row, removed);
				touched = true;
			} else if (channel.includes(`.tables.${VIEWS}.`)) {
				this.applyViewEvent(row, removed);
				touched = true;
			} else if (channel.includes(`.tables.${PAGES}.`)) {
				if (String(row.$id) === this.databaseId) {
					this.applyDatabaseEvent(row, removed);
				} else this.applyRowEvent(row, removed);
				touched = true;
			}
		}
		if (touched) this.bump();
	}

	private trusted(row: Record<string, unknown>) {
		if (!this.page) return false;
		const $permissions = row.$permissions;
		return (
			Array.isArray($permissions) &&
			isTrusted({ $permissions: $permissions as string[] }, this.page)
		);
	}

	private applyCellEvent(row: Record<string, unknown>, removed: boolean) {
		const rowId = String(row.pageId);
		const propId = String(row.propertyId);
		const key = cellKey(rowId, propId);
		if (this.pending.has(key)) return false;
		if (!this.trusted(row)) return false;
		if (removed) {
			this.cells.get(rowId)?.delete(propId);
			return true;
		}
		const updatedAt = String(row.$updatedAt);
		const existing = this.cells.get(rowId)?.get(propId);
		if (existing && !existing.local && existing.updatedAt > updatedAt)
			return false;
		this.writeCell(rowId, propId, {
			value: parseValue(row.value),
			updatedAt,
			updatedBy: String(row.updatedBy ?? ""),
		});
		return true;
	}

	private applyPropertyEvent(row: Record<string, unknown>, removed: boolean) {
		const id = String(row.$id);
		const list = this.properties.filter((p) => p.id !== id);
		this.setProperties(removed ? list : [...list, toProperty(row)]);
		void this.loadRelated();
	}

	private applyViewEvent(row: Record<string, unknown>, removed: boolean) {
		const id = String(row.$id);
		const list = this.views.filter((v) => v.id !== id);
		this.setViews(removed ? list : [...list, toView(row)]);
	}

	// New cells are written with permissions from the page as it is now, not as it was on load.
	private applyDatabaseEvent(row: Record<string, unknown>, removed: boolean) {
		if (removed || !this.page) return;
		const next = toPage(row as unknown as PageRow);
		const changed =
			cellPermissions(next).join() !== cellPermissions(this.page).join();
		this.page = next;
		if (changed) void this.refreshAccess();
	}

	// Whether this person can still edit, and write rows directly, after the page changed access.
	private async refreshAccess() {
		try {
			const snapshot = await fetchDatabase({
				data: { databaseId: this.databaseId },
			});
			this.page = snapshot.page;
			this.access = snapshot.access;
			this.bump();
		} catch {
			// They lost access entirely. Writes will say so; a read here has nothing to add.
		}
	}

	private applyRowEvent(row: Record<string, unknown>, removed: boolean) {
		const id = String(row.$id);
		if (removed) {
			this.rows.delete(id);
			this.cells.delete(id);
		} else if (row.trashedAt) {
			// Its cells stay: a restore brings the row back and nothing else would reload them.
			this.rows.delete(id);
		} else {
			const existing = this.rows.get(id);
			if (
				existing &&
				!existing.local &&
				existing.updatedAt > String(row.$updatedAt)
			)
				return;
			this.rows.set(id, toRow(row));
		}
		this.sortRows();
	}

	// ---------- Reading values ----------

	names: Names = {
		person: (id) => this.members.get(id) || "Someone",
		row: (databaseId, id) => {
			const store =
				databaseId === this.databaseId ? this : this.related.get(databaseId);
			return store?.rows.get(id)?.title || "Untitled";
		},
	};

	value = (rowId: string, propId: string): unknown => {
		const prop = this.propsById.get(propId);
		if (!prop) return null;
		const row = this.rows.get(rowId);
		if (!row) return null;
		switch (prop.type) {
			case "title":
				return row.title;
			case "created_time":
				return row.createdAt;
			case "created_by":
				return row.createdBy ? [row.createdBy] : [];
			case "edited_time":
				return this.lastEdit(rowId).at;
			case "edited_by": {
				const by = this.lastEdit(rowId).by;
				return by ? [by] : [];
			}
			case "relation":
				if (prop.options.side === "reverse")
					return this.reverseIds(prop).get(rowId) ?? [];
				return this.cells.get(rowId)?.get(propId)?.value ?? [];
			case "formula":
			case "rollup":
				return this.computed(rowId, prop);
			default:
				return this.cells.get(rowId)?.get(propId)?.value ?? null;
		}
	};

	private lastEdit(rowId: string) {
		const cached = this.lastEditCache.get(rowId);
		if (cached) return cached;
		const row = this.rows.get(rowId);
		let at = row?.updatedAt ?? "";
		let by = row?.updatedBy ?? "";
		for (const rec of this.cells.get(rowId)?.values() ?? []) {
			if (rec.updatedAt > at) {
				at = rec.updatedAt;
				by = rec.updatedBy;
			}
		}
		const result = { at, by };
		this.lastEditCache.set(rowId, result);
		return result;
	}

	private reverseIds(prop: Property) {
		const cached = this.reverseCache.get(prop.id);
		if (cached) return cached;
		const index = new Map<string, string[]>();
		const targetId = prop.options.targetDatabaseId;
		const pairedId = prop.options.pairedPropertyId;
		if (targetId && pairedId) {
			const source = this.relatedStore(targetId);
			for (const sourceRowId of source.rowIds) {
				const linked = source.cells.get(sourceRowId)?.get(pairedId)?.value;
				for (const id of asArray(linked)) {
					const key = String(id);
					const list = index.get(key);
					if (list) list.push(sourceRowId);
					else index.set(key, [sourceRowId]);
				}
			}
		}
		this.reverseCache.set(prop.id, index);
		return index;
	}

	private computed(rowId: string, prop: Property): unknown {
		const key = cellKey(rowId, prop.id);
		if (this.computedCache.has(key)) return this.computedCache.get(key);
		if (this.computing.has(key)) return { error: CIRCULAR };
		this.computing.add(key);
		try {
			const result =
				prop.type === "formula"
					? this.runFormula(rowId, prop)
					: this.runRollup(rowId, prop);
			this.computedCache.set(key, result);
			return result;
		} finally {
			this.computing.delete(key);
		}
	}

	private parsedFormula(prop: Property) {
		const src = prop.options.expression ?? "";
		const existing = this.parsedFormulas.get(prop.id);
		if (existing?.src === src) return existing.parsed;
		const parsed = parseFormula(src, this.resolveRefs(prop));
		this.parsedFormulas.set(prop.id, { src, parsed });
		return parsed;
	}

	// A saved formula reads its own name-to-column table first, so "Points" keeps meaning the column
	// it pointed at when it was saved, whatever that column is called now.
	private resolveRefs(prop: Property) {
		const saved = Object.entries(prop.options.refs ?? {}).map(([name, id]) => ({
			id,
			name,
		}));
		const taken = new Set(saved.map((r) => r.name.toLowerCase()));
		return [
			...saved,
			...this.formulaRefs(prop.id).filter(
				(r) => !taken.has(r.name.toLowerCase()),
			),
		];
	}

	// The expression to edit: the saved text, with each column under its name today.
	formulaSource(prop: Property) {
		const src = prop.options.expression ?? "";
		const parsed = this.parsedFormula(prop);
		if (!parsed.ok) return src;
		let out = src;
		const spans = refSpans(parsed.ast).sort((a, b) => b.start - a.start);
		for (const span of spans) {
			const current = this.propsById.get(span.id)?.name;
			if (!current || current === span.name) continue;
			const written = src.slice(span.start, span.end);
			const text = written.toLowerCase().startsWith("prop(")
				? `prop("${current}")`
				: current;
			out = out.slice(0, span.start) + text + out.slice(span.end);
		}
		return out;
	}

	// What to save with a formula typed against the current column names.
	formulaOptions(expression: string, formulaId: string | null) {
		const parsed = parseFormula(
			expression,
			this.formulaRefs(formulaId ?? undefined),
		);
		return parsed.ok
			? { expression, refs: refMap(parsed.ast) }
			: { expression };
	}

	formulaRefs(excludeId?: string) {
		return this.properties
			.filter((p) => p.id !== excludeId)
			.map((p) => ({ id: p.id, name: p.name }));
	}

	evalFormulaAst(rowId: string, ast: Node): unknown {
		const result = evaluateSafe(ast, {
			ref: (id) => {
				const dep = this.propsById.get(id);
				if (!dep) return null;
				const value = this.value(rowId, id);
				if (isComputedError(value)) throw new RuntimeError(value.error);
				return toFormulaValue(dep, value, this.names);
			},
		});
		return result.ok ? result.value : { error: result.error };
	}

	private runFormula(rowId: string, prop: Property): unknown {
		const parsed = this.parsedFormula(prop);
		if (!parsed.ok) return { error: parsed.error.message };
		const missing = parsed.refs.find((id) => !this.propsById.has(id));
		if (missing) {
			const name = Object.entries(prop.options.refs ?? {}).find(
				([, id]) => id === missing,
			)?.[0];
			return {
				error: `This formula uses ${name ? `"${name}"` : "a column"}, which was deleted.`,
				label: "Column deleted",
			};
		}
		return this.evalFormulaAst(rowId, parsed.ast);
	}

	// Validates a formula against this database's columns, including ones that reference each other.
	checkFormula(expression: string, formulaId: string | null) {
		const refs = this.formulaRefs(formulaId ?? undefined);
		const parsed = parseFormula(expression, refs);
		if (!parsed.ok) return parsed;
		const cycle = this.findCycle(parsed.refs, formulaId);
		if (cycle) {
			return {
				ok: false as const,
				error: {
					message: `This formula uses ${cycle}, which uses this formula.`,
					start: 0,
					end: expression.length,
					line: 1,
					col: 1,
				},
			};
		}
		return parsed;
	}

	private findCycle(refs: string[], formulaId: string | null) {
		if (!formulaId) return null;
		const visit = (id: string, seen: Set<string>): string | null => {
			const dep = this.propsById.get(id);
			if (!dep || dep.type !== "formula") return null;
			if (id === formulaId) return dep.name;
			if (seen.has(id)) return null;
			seen.add(id);
			const parsed = this.parsedFormula(dep);
			if (!parsed.ok) return null;
			for (const ref of parsed.refs) {
				if (ref === formulaId) return dep.name;
				const hit = visit(ref, seen);
				if (hit) return hit;
			}
			return null;
		};
		for (const ref of refs) {
			const hit = visit(ref, new Set());
			if (hit) return hit;
		}
		return null;
	}

	private runRollup(rowId: string, prop: Property): unknown {
		const relationId = prop.options.relationId ?? "";
		const targetPropId = prop.options.targetPropertyId ?? "";
		const relation = this.propsById.get(relationId);
		const show: RollupFn = prop.options.show ?? "count";
		if (!relation?.options.targetDatabaseId) return null;
		const store = this.relatedStore(relation.options.targetDatabaseId);
		const linked = asArray(this.value(rowId, relationId)).map(String);
		const target = store.propsById.get(targetPropId);
		const values = linked
			.filter((id) => store.rows.has(id))
			.map((id) => (target ? store.value(id, targetPropId) : null));
		switch (show) {
			case "count":
				return linked.filter((id) => store.rows.has(id)).length;
			case "count_values":
				return values.filter((v) => !isEmptyValue(v)).length;
			case "unique":
				return new Set(
					values.map((v) =>
						target ? displayText(target, v, store.names) : "",
					),
				).size;
			case "empty":
				return values.filter(isEmptyValue).length;
			case "not_empty":
				return values.filter((v) => !isEmptyValue(v)).length;
			case "show_original":
				return values
					.map((v) => (target ? displayText(target, v, store.names) : ""))
					.filter(Boolean)
					.join(", ");
			case "open_of_total": {
				const openId = prop.options.openChoiceId;
				const open = values.filter((v) => v !== openId).length;
				return `${open} of ${values.length}`;
			}
			case "percent_checked": {
				if (!values.length) return null;
				const n = values.filter(Boolean).length;
				return `${Math.round((n / values.length) * 100)}%`;
			}
			case "earliest":
			case "latest":
			case "date_range": {
				const days = values
					.map((v) => {
						if (typeof v === "string") return Date.parse(v);
						if (v && typeof v === "object" && "start" in v)
							return Date.parse(String((v as { start: string }).start));
						return Number.NaN;
					})
					.filter((n) => !Number.isNaN(n));
				if (!days.length) return null;
				const min = new Date(Math.min(...days)).toISOString();
				const max = new Date(Math.max(...days)).toISOString();
				if (show === "date_range")
					return formatDateValue({ start: min, end: max });
				return formatDateValue({ start: show === "earliest" ? min : max });
			}
			default: {
				const nums = values
					.map((v) => (typeof v === "number" ? v : Number(v)))
					.filter((n, i) => !isEmptyValue(values[i]) && !Number.isNaN(n));
				if (!nums.length) return null;
				if (show === "sum") return nums.reduce((a, b) => a + b, 0);
				if (show === "average")
					return nums.reduce((a, b) => a + b, 0) / nums.length;
				if (show === "min") return Math.min(...nums);
				if (show === "max") return Math.max(...nums);
				const sorted = [...nums].sort((a, b) => a - b);
				const mid = Math.floor(sorted.length / 2);
				return sorted.length % 2
					? sorted[mid]
					: (sorted[mid - 1] + sorted[mid]) / 2;
			}
		}
	}

	text(rowId: string, propId: string) {
		const prop = this.propsById.get(propId);
		if (!prop) return "";
		const value = this.value(rowId, propId);
		if (isComputedError(value)) return "";
		return displayText(prop, value, this.names);
	}

	formulaValue(rowId: string, prop: Property): Val {
		const value = this.value(rowId, prop.id);
		if (isComputedError(value)) return null;
		return toFormulaValue(prop, value, this.names);
	}

	// ---------- Views ----------

	private overlayKey(viewId: string) {
		return `livepage:view:${this.viewerId}:${viewId}`;
	}

	private overlays = new Map<string, ViewConfig | null>();

	configFor(view: View): ViewConfig {
		let overlay = this.overlays.get(view.id);
		if (overlay === undefined) {
			overlay = this.readOverlay(view.id);
			this.overlays.set(view.id, overlay);
		}
		return overlay ?? view.config;
	}

	hasOverlay(view: View) {
		return Boolean(this.configFor(view) !== view.config);
	}

	private readOverlay(viewId: string): ViewConfig | null {
		if (typeof window === "undefined") return null;
		try {
			const raw = window.localStorage.getItem(this.overlayKey(viewId));
			return raw ? (JSON.parse(raw) as ViewConfig) : null;
		} catch {
			return null;
		}
	}

	updateConfig(view: View, patch: Partial<ViewConfig>) {
		const next = { ...this.configFor(view), ...patch };
		this.overlays.set(view.id, next);
		try {
			window.localStorage.setItem(
				this.overlayKey(view.id),
				JSON.stringify(next),
			);
		} catch {
			// Private mode. The change still applies for this visit.
		}
		this.bump();
	}

	clearOverlay(view: View) {
		this.overlays.set(view.id, null);
		try {
			window.localStorage.removeItem(this.overlayKey(view.id));
		} catch {
			// Nothing stored.
		}
		this.bump();
	}

	async saveConfig(view: View) {
		const config = this.configFor(view);
		const previous = view.config;
		this.setViews(
			this.views.map((v) => (v.id === view.id ? { ...v, config } : v)),
		);
		this.clearOverlay(view);
		try {
			await submitUpdateView({
				data: {
					databaseId: this.databaseId,
					viewId: view.id,
					patch: { config },
				},
			});
		} catch (err) {
			this.setViews(
				this.views.map((v) =>
					v.id === view.id ? { ...v, config: previous } : v,
				),
			);
			this.fail(err);
		}
	}

	rowsFor(
		view: View,
		search: string,
		groupFallback?: string | null,
	): ViewGroups {
		const config = this.configFor(view);
		const key = `${JSON.stringify(config)}\u0000${search}\u0000${groupFallback ?? ""}`;
		const cached = this.viewResults.get(view.id);
		if (cached?.version === this.version && cached.key === key)
			return cached.result;

		const query = search.trim().toLowerCase();
		let ids = this.rowIds;
		if (query) {
			ids = ids.filter((id) => {
				for (const prop of this.properties) {
					if (this.text(id, prop.id).toLowerCase().includes(query)) return true;
				}
				return false;
			});
		}
		if (config.filter.items.length) {
			ids = ids.filter((id) =>
				matches(
					config.filter,
					id,
					this.propsById,
					this.value,
					this.viewerId,
					this.names,
				),
			);
		}
		if (config.sorts.length) {
			ids = [...ids].sort((a, b) =>
				compareRows(config.sorts, a, b, this.propsById, this.value, this.names),
			);
		}
		const groupId = config.groupBy ?? groupFallback ?? null;
		const groupBy = groupId ? this.propsById.get(groupId) : null;
		let groups: ViewGroups["groups"] = null;
		if (groupBy && (view.type === "table" || view.type === "board")) {
			const buckets = new Map<string, string[]>();
			for (const id of ids) {
				for (const key of groupKeys(groupBy, this.value(id, groupBy.id))) {
					const list = buckets.get(key);
					if (list) list.push(id);
					else buckets.set(key, [id]);
				}
			}
			const known = this.groupOrder(groupBy, config.groupOrder, buckets);
			groups = known
				.filter((key) =>
					key === EMPTY_GROUP
						? config.showEmptyGroup || buckets.has(key)
						: !config.hideEmptyGroups || buckets.has(key),
				)
				.map((key) => ({
					key,
					label: groupLabel(groupBy, key, this.names),
					ids: buckets.get(key) ?? [],
				}));
		}
		const result: ViewGroups = { ids, groups };
		this.viewResults.set(view.id, { version: this.version, key, result });
		return result;
	}

	private groupOrder(
		prop: Property,
		order: string[],
		buckets: Map<string, string[]>,
	) {
		const choices =
			prop.type === "select" ||
			prop.type === "status" ||
			prop.type === "multi_select"
				? (prop.options.choices ?? []).map((c) => c.id)
				: [];
		const keys = [...choices];
		if (prop.type === "checkbox") keys.push("true", "false");
		for (const key of buckets.keys()) if (!keys.includes(key)) keys.push(key);
		// Rows without a value come first, as in Notion, so they never sit off the right edge.
		if (keys.includes(EMPTY_GROUP)) keys.splice(keys.indexOf(EMPTY_GROUP), 1);
		keys.unshift(EMPTY_GROUP);
		const index = (key: string) => {
			const at = order.indexOf(key);
			return at < 0 ? order.length + keys.indexOf(key) : at;
		};
		return keys.sort((a, b) => index(a) - index(b));
	}

	// ---------- Writing cells ----------

	private fail(err: unknown) {
		this.onError(errorText(err));
	}

	setCell(rowId: string, propId: string, raw: unknown) {
		const prop = this.propsById.get(propId);
		if (!prop || isComputed(prop.type)) return;
		const fit = fitCell(raw);
		if (!fit.fits) {
			this.onError(
				`That's too much for one cell, so ${prop.name} wasn't changed.`,
			);
			return;
		}
		if (fit.clipped)
			this.onError(`${prop.name} was too long, so the end was cut off.`);
		const value = fit.value;
		const key = cellKey(rowId, propId);
		const current = this.cells.get(rowId)?.get(propId) ?? null;
		const entry = this.pending.get(key);
		if (entry) {
			entry.value = value;
			entry.dirty = true;
		} else {
			this.pending.set(key, {
				value,
				rowId,
				propId,
				dirty: true,
				original: current,
			});
		}
		this.writeCell(rowId, propId, {
			value,
			updatedAt: new Date().toISOString(),
			local: true,
			updatedBy: this.viewerId,
		});
		this.bump();
		this.pushCell(key);
		if (this.access.canEdit) this.scheduleRefill(rowId, propId);
	}

	private inflight = new Set<string>();

	private async pushCell(key: string) {
		if (this.inflight.has(key)) return;
		const entry = this.pending.get(key);
		if (!entry) return;
		this.inflight.add(key);
		try {
			while (entry.dirty) {
				entry.dirty = false;
				const value = entry.value;
				await this.writeOneWithRetry(entry.rowId, entry.propId, value);
			}
			this.pending.delete(key);
		} catch (err) {
			this.pending.delete(key);
			if (entry.original)
				this.writeCell(entry.rowId, entry.propId, entry.original);
			else this.cells.get(entry.rowId)?.delete(entry.propId);
			this.bump();
			this.fail(err);
		} finally {
			this.inflight.delete(key);
		}
	}

	// A network blip or a rate limit shouldn't cost someone their edit: wait it out for a while.
	private async writeOneWithRetry(
		rowId: string,
		propId: string,
		value: unknown,
	) {
		for (let attempt = 0; ; attempt++) {
			try {
				await this.writeOne(rowId, propId, value);
				return;
			} catch (err) {
				const passing =
					err instanceof TypeError ||
					(err instanceof WriteError && (err.code === 429 || err.code >= 500));
				if (!passing || attempt >= CELL_RETRY_MS.length) throw err;
				await new Promise((resolve) =>
					setTimeout(resolve, CELL_RETRY_MS[attempt]),
				);
			}
		}
	}

	private async writeOne(rowId: string, propId: string, value: unknown) {
		if (this.access.direct && this.page) {
			await upsertRow(
				DATABASE_ID,
				CELLS,
				cellRowId(rowId, propId),
				{
					workspaceId: this.page.workspaceId,
					databaseId: this.databaseId,
					pageId: rowId,
					propertyId: propId,
					value: JSON.stringify(value ?? null),
					updatedBy: this.viewerId,
				},
				cellPermissions(this.page),
			);
		} else {
			await submitCells({
				data: {
					databaseId: this.databaseId,
					edits: [{ rowId, propertyId: propId, value }],
				},
			});
		}
	}

	// Sets a relation from whichever side is being edited. The source side owns the data: its cell
	// is the only copy, so the reverse side stays correct without a second write that could race.
	async setRelation(rowId: string, prop: Property, next: string[]) {
		if (prop.options.side !== "reverse") {
			this.setCell(rowId, prop.id, next);
			return;
		}
		const sourceId = prop.options.targetDatabaseId;
		const pairedId = prop.options.pairedPropertyId;
		if (!sourceId || !pairedId) return;
		const source = this.relatedStore(sourceId);
		// The change is what the person asked for. It's worked out now, against what they could see,
		// and applied to the full list after the source has loaded. Before that, the list of links
		// is partial, and writing it back would delete the links not seen yet.
		const shown = this.reverseIds(prop).get(rowId) ?? [];
		const add = next.filter((id) => !shown.includes(id));
		const remove = shown.filter((id) => !next.includes(id));
		await source.load();
		if (source.status === "error") {
			this.fail(
				new Error(source.error ?? "Couldn't load the linked database."),
			);
			return;
		}
		for (const id of add) {
			const existing = asArray(source.value(id, pairedId)).map(String);
			source.setCell(id, pairedId, [...existing, rowId]);
		}
		for (const id of remove) {
			const existing = asArray(source.value(id, pairedId)).map(String);
			source.setCell(
				id,
				pairedId,
				existing.filter((x) => x !== rowId),
			);
		}
	}

	setTitle(rowId: string, title: string) {
		const row = this.rows.get(rowId);
		if (!row) return;
		const previous = row.title;
		row.title = title;
		row.updatedAt = new Date().toISOString();
		row.local = true;
		row.updatedBy = this.viewerId;
		this.bump();
		this.writeMeta(rowId, { title }, () => {
			row.title = previous;
		});
		// The title isn't a cell, but AI columns read it like one.
		const titleProp = this.properties.find((p) => p.type === "title");
		if (titleProp && this.access.canEdit)
			this.scheduleRefill(rowId, titleProp.id);
	}

	setPosition(rowId: string, position: number) {
		const row = this.rows.get(rowId);
		if (!row) return;
		const previous = row.position;
		row.position = position;
		this.sortRows();
		this.bump();
		this.writeMeta(rowId, { position }, () => {
			row.position = previous;
			this.sortRows();
		});
	}

	setRowCover(rowId: string, coverFileId: string | null) {
		const row = this.rows.get(rowId);
		if (!row) return;
		const previous = row.coverFileId;
		row.coverFileId = coverFileId;
		this.bump();
		this.writeMeta(rowId, { coverFileId }, () => {
			row.coverFileId = previous;
		});
	}

	private async writeMeta(
		rowId: string,
		patch: {
			title?: string;
			position?: number;
			coverFileId?: string | null;
			icon?: string | null;
		},
		undo: () => void,
	) {
		// A row still being created can't be written to yet. These wait for it, in order. If the create
		// fails the row is gone from the screen and there's nothing to write.
		const creating = this.creating.get(rowId);
		if (creating && !(await creating)) return;
		try {
			await submitRowMeta({
				data: { databaseId: this.databaseId, rowId, patch },
			});
		} catch (err) {
			undo();
			this.bump();
			this.fail(err);
		}
	}

	// ---------- Rows ----------

	nextPosition() {
		const last = this.rowIds[this.rowIds.length - 1];
		const base = last ? (this.rows.get(last)?.position ?? 0) : 0;
		return Math.max(Date.now() / 1000, base + 0.001);
	}

	private insertOptimistic(id: string, title: string, position: number) {
		const now = new Date().toISOString();
		this.rows.set(id, {
			id,
			title,
			icon: null,
			coverFileId: null,
			position,
			createdAt: now,
			updatedAt: now,
			local: true,
			createdBy: this.viewerId,
			updatedBy: this.viewerId,
		});
	}

	private creating = new Map<string, Promise<boolean>>();

	// Adds one row. Used by New, by quick add in a board column and on the calendar.
	createRow(init?: {
		title?: string;
		cells?: Record<string, unknown>;
	}): string {
		const id = ID.unique();
		const position = this.nextPosition();
		this.insertOptimistic(id, init?.title ?? "", position);
		const cells = Object.entries(init?.cells ?? {});
		for (const [propId, value] of cells) {
			this.writeCell(id, propId, {
				value,
				updatedAt: new Date().toISOString(),
				local: true,
				updatedBy: this.viewerId,
			});
		}
		this.sortRows();
		this.bump();
		this.creating.set(
			id,
			submitCreateRows({
				data: {
					databaseId: this.databaseId,
					rows: [
						{
							id,
							title: init?.title ?? "",
							position,
							cells: cells.map(([propertyId, value]) => ({
								propertyId,
								value,
							})),
						},
					],
				},
			})
				.then(() => true)
				.catch((err) => {
					this.rows.delete(id);
					this.cells.delete(id);
					this.sortRows();
					this.bump();
					this.fail(err);
					return false;
				})
				.finally(() => this.creating.delete(id)),
		);
		return id;
	}

	private setTask(task: TaskState | null) {
		this.task = task;
		this.bump();
	}

	// Runs a large operation in batches through server functions, with a progress state and retry.
	// A failed batch stops the run and offers Retry from where it stopped, so nothing is lost silently.
	async runTask<T>(
		label: string,
		items: T[],
		size: number,
		run: (batch: T[]) => Promise<unknown>,
	): Promise<boolean> {
		let index = 0;
		const start = async (): Promise<boolean> => {
			this.setTask({
				label,
				done: index,
				total: items.length,
				status: "running",
			});
			while (index < items.length) {
				const batch = items.slice(index, index + size);
				try {
					await run(batch);
				} catch (err) {
					this.setTask({
						label,
						done: index,
						total: items.length,
						status: "failed",
						error: errorText(err),
						retry: () => void start(),
					});
					return false;
				}
				index += batch.length;
				this.setTask({
					label,
					done: index,
					total: items.length,
					status: "running",
				});
			}
			this.setTask(null);
			return true;
		};
		return start();
	}

	// Resolves once a row made with createRow exists on the server (or the create failed).
	waitForRow(rowId: string): Promise<unknown> {
		return this.creating.get(rowId) ?? Promise.resolve();
	}

	dismissTask() {
		this.setTask(null);
	}

	async trashRows(rowIds: string[]) {
		const removed = rowIds
			.map((id) => this.rows.get(id))
			.filter((r): r is DbRow => Boolean(r));
		const saved = new Map(removed.map((r) => [r.id, this.cells.get(r.id)]));
		const trashed = new Set<string>();
		for (const row of removed) this.rows.delete(row.id);
		this.sortRows();
		this.bump();
		const ok = await this.runTask(
			`Moving ${rowIds.length} ${rowIds.length === 1 ? "row" : "rows"} to Trash`,
			rowIds,
			BATCH_ROWS,
			async (batch) => {
				await submitTrashRows({
					data: { databaseId: this.databaseId, rowIds: batch },
				});
				for (const id of batch) {
					trashed.add(id);
					// A retry after a failure restored these: take them off the screen again.
					this.rows.delete(id);
				}
				this.sortRows();
				this.bump();
			},
		);
		if (!ok) {
			// Rows already in Trash stay there. The rest come back so nothing looks gone that isn't.
			for (const row of removed) {
				if (trashed.has(row.id)) continue;
				this.rows.set(row.id, row);
				const cells = saved.get(row.id);
				if (cells) this.cells.set(row.id, cells);
			}
			this.sortRows();
			this.bump();
		}
		return ok;
	}

	async restoreRows(rowIds: string[]) {
		await this.runTask("Restoring rows", rowIds, BATCH_ROWS, (batch) =>
			submitTrashRows({
				data: { databaseId: this.databaseId, rowIds: batch, restore: true },
			}),
		);
		await this.reload();
	}

	async duplicateRows(rowIds: string[]) {
		const copies = rowIds.map((sourceId) => ({ id: ID.unique(), sourceId }));
		const ok = await this.runTask(
			`Duplicating ${rowIds.length} ${rowIds.length === 1 ? "row" : "rows"}`,
			copies,
			BATCH_ROWS,
			(batch) =>
				submitDuplicateRows({
					data: { databaseId: this.databaseId, copies: batch },
				}),
		);
		if (ok) await this.reload();
		return ok;
	}

	async importRows(
		drafts: {
			title: string;
			cells: { propertyId: string; value: unknown }[];
		}[],
	) {
		const base = this.nextPosition();
		// Ids are fixed before the first batch, so a retry after a failure rewrites the same rows.
		const rows = drafts.map((d, i) => ({
			id: ID.unique(),
			title: d.title,
			position: base + i * 0.001,
			cells: d.cells,
		}));
		const ok = await this.runTask(
			`Importing ${rows.length} rows`,
			rows,
			BATCH_ROWS,
			(batch) =>
				submitCreateRows({
					data: { databaseId: this.databaseId, rows: batch },
				}).then((res) => this.reportTooLong(res.tooLong)),
		);
		if (ok) await this.reload();
		return ok;
	}

	async bulkSet(rowIds: string[], propertyId: string, value: unknown) {
		for (const rowId of rowIds) {
			this.writeCell(rowId, propertyId, {
				value,
				updatedAt: new Date().toISOString(),
				local: true,
				updatedBy: this.viewerId,
			});
		}
		this.bump();
		const edits = rowIds.map((rowId) => ({ rowId, propertyId, value }));
		return this.runTask(
			`Updating ${rowIds.length} ${rowIds.length === 1 ? "row" : "rows"}`,
			edits,
			BATCH_ROWS,
			(batch) =>
				submitCells({
					data: { databaseId: this.databaseId, edits: batch },
				}).then((res) => this.reportTooLong(res.tooLong)),
		);
	}

	// Says which cells a bulk write had to shorten or leave out, instead of failing the batch.
	private reportTooLong(list: TooLong[]) {
		if (!list.length) return;
		const named = list.slice(0, 3).map((t) => {
			const row = this.rows.get(t.rowId)?.title || "Untitled";
			const column = this.propsById.get(t.propertyId)?.name ?? "a column";
			return `${row}: ${column}`;
		});
		const rest = list.length - named.length;
		const skipped = list.some((t) => !t.saved);
		this.onError(
			`${list.length} ${list.length === 1 ? "cell was" : "cells were"} too long and ${skipped ? "not saved or " : ""}shortened (${named.join(", ")}${rest ? `, and ${rest} more` : ""}).`,
		);
	}

	// ---------- Properties ----------

	async createProperty(input: {
		name: string;
		type: PropertyType;
		options?: Property["options"];
		reverseName?: string;
	}) {
		const position =
			(this.properties[this.properties.length - 1]?.position ?? 0) + 1;
		const result = await submitCreateProperty({
			data: {
				databaseId: this.databaseId,
				name: input.name,
				type: input.type,
				options: input.options ?? {},
				position,
				reverseName: input.reverseName,
			},
		});
		this.setProperties([
			...this.properties,
			result.property as unknown as Property,
		]);
		if (input.type === "relation") void this.loadRelated();
		this.bump();
		return result.property as unknown as Property;
	}

	async updateProperty(
		propertyId: string,
		patch: {
			name?: string;
			type?: PropertyType;
			options?: Property["options"];
			position?: number;
		},
	) {
		const previous = this.propsById.get(propertyId);
		if (!previous) return;
		if (patch.name && patch.name !== previous.name) await this.pinFormulas();
		this.setProperties(
			this.properties.map((p) =>
				p.id === propertyId ? { ...p, ...patch } : p,
			),
		);
		this.bump();
		try {
			await submitUpdateProperty({
				data: { databaseId: this.databaseId, propertyId, patch },
			});
			if (patch.options?.targetDatabaseId) void this.loadRelated();
		} catch (err) {
			this.setProperties(
				this.properties.map((p) => (p.id === propertyId ? previous : p)),
			);
			this.bump();
			this.fail(err);
		}
	}

	// Formulas saved before references were stored by column id only know names. Before a name changes,
	// write down which column each one means, while the old names still resolve.
	private async pinFormulas() {
		for (const formula of this.properties) {
			if (formula.type !== "formula" || formula.options.refs) continue;
			const src = formula.options.expression;
			if (!src) continue;
			const parsed = parseFormula(src, this.formulaRefs(formula.id));
			if (!parsed.ok) continue;
			const options = { ...formula.options, refs: refMap(parsed.ast) };
			this.setProperties(
				this.properties.map((p) =>
					p.id === formula.id ? { ...p, options } : p,
				),
			);
			await submitUpdateProperty({
				data: {
					databaseId: this.databaseId,
					propertyId: formula.id,
					patch: { options },
				},
			});
		}
	}

	async deleteProperty(propertyId: string) {
		const previous = this.properties;
		this.setProperties(this.properties.filter((p) => p.id !== propertyId));
		this.bump();
		try {
			for (;;) {
				const { done } = await submitDeleteProperty({
					data: { databaseId: this.databaseId, propertyId },
				});
				if (done) break;
			}
		} catch (err) {
			this.setProperties(previous);
			this.bump();
			this.fail(err);
		}
	}

	// Converts stored values when a column changes type, in server batches with a progress state.
	async convertProperty(
		prop: Property,
		type: PropertyType,
		options: Property["options"],
	) {
		const nextOptions = { ...options };
		const toChoices =
			type === "select" || type === "status" || type === "multi_select";
		if (
			toChoices &&
			(prop.type === "text" ||
				prop.type === "select" ||
				prop.type === "status" ||
				prop.type === "multi_select")
		) {
			const names = new Set<string>();
			for (const rowId of this.rowIds) {
				for (const part of this.text(rowId, prop.id).split(",")) {
					const name = part.trim();
					if (name) names.add(name);
				}
			}
			const existing = options.choices ?? [];
			const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
			const choices = [...existing];
			for (const name of names) {
				if (!byName.has(name.toLowerCase()))
					choices.push({
						id: `opt-${ID.unique()}`,
						name,
						color: ["gray", "green", "amber", "blue", "violet", "coral"][
							choices.length % 6
						] as Choice["color"],
					});
			}
			nextOptions.choices = choices;
		}
		const edits: { rowId: string; propertyId: string; value: unknown }[] = [];
		for (const rowId of this.rowIds) {
			if (!this.cells.get(rowId)?.has(prop.id)) continue;
			const next = convertValue(
				this.value(rowId, prop.id),
				this.text(rowId, prop.id),
				type,
				nextOptions,
			);
			edits.push({ rowId, propertyId: prop.id, value: next });
		}
		await this.updateProperty(prop.id, { type, options: nextOptions });
		if (edits.length) {
			for (const e of edits) {
				this.writeCell(e.rowId, e.propertyId, {
					value: e.value,
					updatedAt: new Date().toISOString(),
					local: true,
					updatedBy: this.viewerId,
				});
			}
			this.bump();
			await this.runTask(
				`Converting ${edits.length} values`,
				edits,
				100,
				(batch) =>
					submitCells({ data: { databaseId: this.databaseId, edits: batch } }),
			);
		}
	}

	async duplicateProperty(prop: Property) {
		const options = { ...prop.options };
		delete options.pairedPropertyId;
		const created = await this.createProperty({
			name: `${prop.name} copy`,
			type: prop.type,
			options,
		});
		const edits: { rowId: string; propertyId: string; value: unknown }[] = [];
		for (const rowId of this.rowIds) {
			const rec = this.cells.get(rowId)?.get(prop.id);
			if (rec) edits.push({ rowId, propertyId: created.id, value: rec.value });
		}
		if (edits.length)
			await this.runTask(
				`Copying ${edits.length} values`,
				edits,
				100,
				(batch) =>
					submitCells({ data: { databaseId: this.databaseId, edits: batch } }),
			);
		await this.reload();
	}

	// ---------- AI columns ----------

	aiFilling = new Set<string>();

	// Asks the server to fill an AI column. A few rows per request, because a Site request is cut
	// off at 30 seconds. The server writes results to cells, which arrive here over Realtime.
	async fillAi(
		prop: Property,
		rowIds: string[],
		opts: { throwOnError?: boolean } = {},
	) {
		const workspaceId = this.page?.workspaceId;
		if (!workspaceId) return;
		const keys = rowIds.map((id) => cellKey(id, prop.id));
		for (const key of keys) this.aiFilling.add(key);
		this.bump();
		let failure: unknown = null;
		for (let i = 0; i < rowIds.length; i += 4) {
			const batch = rowIds.slice(i, i + 4);
			try {
				const res = await fetch("/api/ai/column", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						workspaceId,
						databaseId: this.databaseId,
						propertyId: prop.id,
						rowIds: batch,
					}),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as ServerError;
					throw new Error(body.message || "The AI request failed.");
				}
			} catch (err) {
				failure = err;
				break;
			} finally {
				for (const id of batch) this.aiFilling.delete(cellKey(id, prop.id));
				this.bump();
			}
		}
		for (const key of keys) this.aiFilling.delete(key);
		this.bump();
		if (failure) {
			if (opts.throwOnError) throw failure;
			this.fail(failure);
		}
	}

	private refillTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private scheduleRefill(rowId: string, propId: string) {
		for (const prop of this.properties) {
			if (prop.type !== "ai" || !prop.options.refill) continue;
			if (!prop.options.sources?.includes(propId)) continue;
			const key = cellKey(rowId, prop.id);
			const previous = this.refillTimers.get(key);
			if (previous) clearTimeout(previous);
			this.refillTimers.set(
				key,
				setTimeout(() => {
					this.refillTimers.delete(key);
					void this.fillAi(prop, [rowId]);
				}, 5_000),
			);
		}
	}

	// ---------- Views ----------

	async createView(input: {
		name: string;
		type: ViewType;
		config?: Partial<ViewConfig>;
	}) {
		const position = (this.views[this.views.length - 1]?.position ?? 0) + 1;
		const created = await submitCreateView({
			data: {
				databaseId: this.databaseId,
				name: input.name,
				type: input.type,
				config: (input.config ?? {}) as Record<string, unknown>,
				position,
			},
		});
		const view: View = {
			id: created.id,
			databaseId: this.databaseId,
			name: input.name,
			type: input.type,
			config: withDefaults(input.config),
			position,
		};
		this.setViews([...this.views.filter((v) => v.id !== view.id), view]);
		this.bump();
		return view;
	}

	async renameView(viewId: string, name: string) {
		this.setViews(
			this.views.map((v) => (v.id === viewId ? { ...v, name } : v)),
		);
		this.bump();
		try {
			await submitUpdateView({
				data: { databaseId: this.databaseId, viewId, patch: { name } },
			});
		} catch (err) {
			this.fail(err);
		}
	}

	async duplicateView(view: View) {
		return this.createView({
			name: `${view.name} copy`,
			type: view.type,
			config: this.configFor(view),
		});
	}

	async deleteView(viewId: string) {
		const previous = this.views;
		this.setViews(this.views.filter((v) => v.id !== viewId));
		this.bump();
		try {
			await submitDeleteView({
				data: { databaseId: this.databaseId, viewId },
			});
		} catch (err) {
			this.setViews(previous);
			this.bump();
			this.fail(err);
		}
	}

	async updateViewPosition(viewId: string, position: number) {
		this.setViews(
			this.views.map((v) => (v.id === viewId ? { ...v, position } : v)),
		);
		this.bump();
		try {
			await submitUpdateView({
				data: { databaseId: this.databaseId, viewId, patch: { position } },
			});
		} catch (err) {
			this.fail(err);
		}
	}
}

// ---------- Registry ----------

const stores = new Map<string, DatabaseStore>();
const roots = new Map<string, number>();

// Tests reach the live store of a database through this. Dev only.
if (import.meta.env?.DEV)
	(globalThis as Record<string, unknown>).__livepageStores = stores;

export function storeFor(databaseId: string, viewerId: string): DatabaseStore {
	let store = stores.get(databaseId);
	if (!store) {
		store = new DatabaseStore(databaseId);
		stores.set(databaseId, store);
	}
	store.viewerId = viewerId;
	return store;
}

// Also puts the store back in the registry: a remount can release it and retain it again, and a
// second store for one database would take over its Realtime subscriptions.
export function retainStore(store: DatabaseStore) {
	stores.set(store.databaseId, store);
	roots.set(store.databaseId, (roots.get(store.databaseId) ?? 0) + 1);
}

// Drops stores that are no longer reachable from anything on screen.
export function releaseStore(databaseId: string) {
	const next = (roots.get(databaseId) ?? 1) - 1;
	if (next > 0) {
		roots.set(databaseId, next);
		return;
	}
	roots.delete(databaseId);
	const keep = new Set<string>();
	const walk = (id: string) => {
		if (keep.has(id)) return;
		keep.add(id);
		const store = stores.get(id);
		if (!store) return;
		for (const prop of store.properties) {
			const target = prop.options.targetDatabaseId;
			if (prop.type === "relation" && target) walk(target);
		}
	};
	for (const id of roots.keys()) walk(id);
	for (const [id, store] of stores) {
		if (!keep.has(id)) {
			store.detach();
			stores.delete(id);
		}
	}
}

function convertValue(
	raw: unknown,
	text: string,
	type: PropertyType,
	options: Property["options"],
): unknown {
	if (type === "text" || type === "url" || type === "email" || type === "phone")
		return text;
	if (type === "number") {
		if (typeof raw === "number") return raw;
		const n = Number(text.split(",").join(""));
		return text.trim() === "" || Number.isNaN(n) ? null : n;
	}
	if (type === "checkbox") return Boolean(raw) && text !== "No";
	if (type === "select" || type === "status") {
		const name = text.split(",")[0]?.trim().toLowerCase();
		return (
			options.choices?.find((c) => c.name.toLowerCase() === name)?.id ?? null
		);
	}
	if (type === "multi_select") {
		const names = text.split(",").map((s) => s.trim().toLowerCase());
		return (options.choices ?? [])
			.filter((c) => names.includes(c.name.toLowerCase()))
			.map((c) => c.id);
	}
	if (type === "date") {
		const parsed = Date.parse(text);
		return Number.isNaN(parsed)
			? null
			: { start: new Date(parsed).toISOString().slice(0, 10) };
	}
	return null;
}
