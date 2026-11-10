// Server side of databases: access checks, bulk row writes, properties and views.
// Reads and low-volume writes run with the person's session, so Appwrite enforces permissions.
// Bulk writes use the site key after an explicit access check: Appwrite's bulk row APIs only accept
// API keys, and batches through them don't spend the person's 120-writes-a-minute budget.
import {
	type Client,
	ID,
	type Models,
	Query,
	TablesDB,
	Teams,
} from "node-appwrite";
import { isTrusted } from "#/features/editor/access";
import { fitCell } from "#/lib/cells";
import {
	canWriteDirect,
	cellPermissions,
	cellRowId,
	contentPermissions,
	pagePermissions,
	rowHash,
} from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import { loadConfig } from "./ai";
import { adminClient, errorCode } from "./appwrite";
import { AuthError, requireViewer, workspaceRole } from "./auth";
import { fileBelongsTo } from "./files";
import { BODIES, CELLS, DATABASE_ID, PAGES, PROPERTIES, VIEWS } from "./schema";

const BATCH = 100;

export const MAX_ROWS_PER_CALL = 100;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type RawProperty = {
	id: string;
	databaseId: string;
	name: string;
	type: string;
	options: Record<string, Json>;
	position: number;
};

export type RawView = {
	id: string;
	databaseId: string;
	name: string;
	type: string;
	config: Record<string, Json>;
	position: number;
};

export type RowDraft = {
	id: string;
	title: string;
	position: number;
	cells?: { propertyId: string; value: unknown }[];
};

export type CellEdit = {
	rowId: string;
	propertyId: string;
	value: unknown;
};

export type DatabaseSnapshot = {
	page: Page;
	access: { canEdit: boolean; direct: boolean };
	properties: RawProperty[];
	views: RawView[];
	aiEnabled: boolean;
	people: { userId: string; name: string }[];
};

const db = (client: Client) => new TablesDB(client);

type Access = Awaited<ReturnType<typeof resolveAccess>>;

async function resolveAccess(databaseId: string) {
	const session = await requireViewer();
	const row = await db(session.client).getRow<Models.Row & PageRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: databaseId,
	});
	const page = toPage(row);
	if (page.kind !== "database")
		throw new AuthError("That page isn't a database.", "forbidden");
	// Access starts from a real, confirmed membership of the workspace the row says it's in.
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		page.workspaceId,
	);
	if (!role) throw new AuthError("You can't open this database.", "forbidden");
	const share = page.shares.find((s) => s.userId === session.viewer.userId);
	const owns = page.createdBy === session.viewer.userId;
	const canEdit =
		share?.level === "edit" ||
		(role !== "guest" && (page.visibility === "workspace" || owns));
	const direct =
		canEdit &&
		canWriteDirect(page, {
			userId: session.viewer.userId,
			role,
		});
	return { ...session, page, role, canEdit, direct };
}

async function editAccess(databaseId: string): Promise<Access> {
	const access = await resolveAccess(databaseId);
	if (!access.canEdit)
		throw new AuthError("You can't edit this database.", "forbidden");
	return access;
}

function chunk<T>(items: T[], size: number) {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

function parseJson(value: unknown): Record<string, Json> {
	if (typeof value !== "string" || !value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

type PropertyRow = {
	$id: string;
	databaseId: string;
	name: string;
	type: string;
	options: string | null;
	position: number;
};
type ViewRow = {
	$id: string;
	databaseId: string;
	name: string;
	type: string;
	config: string | null;
	position: number;
};

const toProperty = (row: PropertyRow): RawProperty => ({
	id: row.$id,
	databaseId: row.databaseId,
	name: row.name,
	type: row.type,
	options: parseJson(row.options),
	position: row.position,
});

const toView = (row: ViewRow): RawView => ({
	id: row.$id,
	databaseId: row.databaseId,
	name: row.name,
	type: row.type,
	config: parseJson(row.config),
	position: row.position,
});

async function listAll<T>(client: Client, tableId: string, filters: string[]) {
	const out: T[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await db(client).listRows({
			databaseId: DATABASE_ID,
			tableId,
			queries: [
				...filters,
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		out.push(...(page.rows as unknown as T[]));
		if (page.rows.length < 500) return out;
		cursor = page.rows[page.rows.length - 1].$id;
	}
}

async function readRows(access: Access) {
	const filter = [Query.equal("databaseId", [access.page.id])];
	const [properties, views] = await Promise.all([
		listAll<PropertyRow>(access.client, PROPERTIES, filter),
		listAll<ViewRow>(access.client, VIEWS, filter),
	]);
	return { properties, views };
}

// Default property and view use deterministic ids, so two people opening a new database at once
// can't create two of them. A 409 means the other one got there first.
async function ensureDefaults(access: Access) {
	const { page } = access;
	const perms = contentPermissions(page);
	const admin = adminClient();
	const propId = rowHash("title", page.id);
	const viewId = rowHash("view", page.id);
	await db(admin)
		.createRow({
			databaseId: DATABASE_ID,
			tableId: PROPERTIES,
			rowId: propId,
			data: {
				workspaceId: page.workspaceId,
				databaseId: page.id,
				name: "Name",
				type: "title",
				options: "{}",
				position: 0,
			},
			permissions: perms,
		})
		.catch((err) => {
			if (errorCode(err) !== 409) throw err;
		});
	await db(admin)
		.createRow({
			databaseId: DATABASE_ID,
			tableId: VIEWS,
			rowId: viewId,
			data: {
				workspaceId: page.workspaceId,
				databaseId: page.id,
				name: "Table",
				type: "table",
				config: "{}",
				position: 0,
			},
			permissions: perms,
		})
		.catch((err) => {
			if (errorCode(err) !== 409) throw err;
		});
}

export async function getDatabase(
	databaseId: string,
): Promise<DatabaseSnapshot> {
	const access = await resolveAccess(databaseId);
	let { properties, views } = await readRows(access);
	if ((!properties.length || !views.length) && access.canEdit) {
		await ensureDefaults(access);
		({ properties, views } = await readRows(access));
	}
	// A workspace with its own key counts too, not just the Site's.
	const ai = await loadConfig(access.page.workspaceId).catch(() => null);
	return {
		page: access.page,
		access: { canEdit: access.canEdit, direct: access.direct },
		properties: properties.map(toProperty),
		views: views.map(toView),
		aiEnabled: Boolean(ai?.config),
		people: await listPeople(access),
	};
}

// Names for the Person column. Read with the site key after the access check above, because
// Appwrite hides member names from non-admin sessions when a project keeps memberships private.
// A guest only sees what Appwrite would show them anyway, as in listMembers.
async function listPeople(access: Access) {
	const reader = access.role === "guest" ? access.client : adminClient();
	const { memberships } = await new Teams(reader).listMemberships({
		teamId: access.page.workspaceId,
		queries: [Query.limit(500)],
	});
	return memberships
		.filter((m) => m.userId && m.confirm)
		.map((m) => ({
			userId: m.userId,
			name: m.userName || m.userEmail || "Someone",
		}));
}

// ---------- Ownership checks ----------
//
// Everything below writes with the site key, which ignores row permissions, so each function first
// loads what the request names and refuses anything that isn't really part of this database.

async function propertyIdsOf(databaseId: string) {
	const rows = await listAll<PropertyRow>(adminClient(), PROPERTIES, [
		Query.equal("databaseId", [databaseId]),
		Query.select(["$id"]),
	]);
	return new Set(rows.map((r) => r.$id));
}

// The rows a batch names that already exist, whichever database they're in.
async function existingRows(rowIds: string[]) {
	const out = new Map<string, PageRow & { $id: string }>();
	for (const ids of chunk([...new Set(rowIds)], BATCH)) {
		const rows = await listAll<PageRow & { $id: string }>(
			adminClient(),
			PAGES,
			[
				Query.equal("$id", ids),
				Query.select(["$id", "databaseId", "kind", "createdBy"]),
			],
		);
		for (const row of rows) out.set(row.$id, row);
	}
	return out;
}

async function requireRowsIn(databaseId: string, rowIds: string[]) {
	const found = await existingRows(rowIds);
	for (const id of new Set(rowIds)) {
		const row = found.get(id);
		if (!row || row.kind !== "row" || row.databaseId !== databaseId)
			throw new AuthError("That row isn't in this database.", "forbidden");
	}
	return found;
}

async function requireProperties(databaseId: string, propertyIds: string[]) {
	const known = await propertyIdsOf(databaseId);
	for (const id of propertyIds)
		if (!known.has(id))
			throw new AuthError("That column isn't in this database.", "forbidden");
}

// Row ids come from the browser (a retried batch lands on the same rows), so one that already exists
// anywhere but this database is refused rather than overwritten.
async function refuseOutsideIds(databaseId: string, rowIds: string[]) {
	const found = await existingRows(rowIds);
	for (const row of found.values())
		if (row.kind !== "row" || row.databaseId !== databaseId)
			throw new AuthError("That row id is already taken.", "forbidden");
	return found;
}

async function propertyIn<T extends PropertyRow | ViewRow>(
	tableId: string,
	databaseId: string,
	rowId: string,
): Promise<T> {
	let row: T;
	try {
		row = await db(adminClient()).getRow<Models.Row & T>({
			databaseId: DATABASE_ID,
			tableId,
			rowId,
		});
	} catch (err) {
		if (errorCode(err) === 404)
			throw new AuthError("That isn't in this database.", "forbidden");
		throw err;
	}
	if (row.databaseId !== databaseId)
		throw new AuthError("That isn't in this database.", "forbidden");
	return row;
}

// ---------- Cells ----------

export type TooLong = { rowId: string; propertyId: string; saved: boolean };

function cellRow(
	access: Access,
	edit: CellEdit,
	perms: string[],
	tooLong: TooLong[],
) {
	const value = edit.value === undefined ? null : edit.value;
	const fit = fitCell(value);
	// One long value used to fail its whole batch. It's cut or left out, and reported, on its own.
	if (!fit.fits || fit.clipped)
		tooLong.push({
			rowId: edit.rowId,
			propertyId: edit.propertyId,
			saved: fit.fits,
		});
	if (!fit.fits) return null;
	return {
		$id: cellRowId(edit.rowId, edit.propertyId),
		$permissions: perms,
		workspaceId: access.page.workspaceId,
		databaseId: access.page.id,
		pageId: edit.rowId,
		propertyId: edit.propertyId,
		value: fit.json,
		updatedBy: access.viewer.userId,
	};
}

// Cell writes for people who can't write rows directly (guests with edit access, shared databases)
// and bulk edits. Keyed by the same deterministic ids as direct writes.
export async function writeCells(databaseId: string, edits: CellEdit[]) {
	const access = await editAccess(databaseId);
	await requireRowsIn(
		databaseId,
		edits.map((e) => e.rowId),
	);
	await requireProperties(databaseId, [
		...new Set(edits.map((e) => e.propertyId)),
	]);
	const perms = cellPermissions(access.page);
	const tooLong: TooLong[] = [];
	const rows = edits.flatMap((e) => cellRow(access, e, perms, tooLong) ?? []);
	const tables = db(adminClient());
	for (const batch of chunk(rows, BATCH)) {
		await tables.upsertRows({
			databaseId: DATABASE_ID,
			tableId: CELLS,
			rows: batch as unknown as object[],
		});
	}
	return { saved: rows.length, tooLong };
}

// ---------- Rows ----------

export async function createRows(databaseId: string, drafts: RowDraft[]) {
	if (drafts.length > MAX_ROWS_PER_CALL)
		throw new Error(`Send at most ${MAX_ROWS_PER_CALL} rows at a time.`);
	const access = await editAccess(databaseId);
	const { page, viewer } = access;
	const existing = await refuseOutsideIds(
		databaseId,
		drafts.map((d) => d.id),
	);
	await requireProperties(databaseId, [
		...new Set(drafts.flatMap((d) => (d.cells ?? []).map((c) => c.propertyId))),
	]);
	const tables = db(adminClient());
	const pagePerms = pagePermissions(page);
	const cellPerms = cellPermissions(page);
	const pageRows = drafts.map((d) => ({
		$id: d.id,
		$permissions: pagePerms,
		workspaceId: page.workspaceId,
		parentId: null,
		sectionId: null,
		kind: "row",
		title: d.title.slice(0, 512),
		icon: null,
		coverFileId: null,
		position: d.position,
		databaseId: page.id,
		visibility: page.visibility,
		shares: page.shares.length ? JSON.stringify(page.shares) : null,
		publishedSlug: null,
		trashedAt: null,
		createdBy: existing.get(d.id)?.createdBy ?? viewer.userId,
		updatedBy: viewer.userId,
	}));
	await tables.upsertRows({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rows: pageRows as unknown as object[],
	});
	const bodyRows = drafts.map((d) => ({
		$id: d.id,
		$permissions: cellPerms,
		workspaceId: page.workspaceId,
		pageId: d.id,
	}));
	await tables.upsertRows({
		databaseId: DATABASE_ID,
		tableId: BODIES,
		rows: bodyRows as unknown as object[],
	});
	const tooLong: TooLong[] = [];
	const cellRows = drafts.flatMap((d) =>
		(d.cells ?? []).flatMap(
			(c) =>
				cellRow(
					access,
					{ rowId: d.id, propertyId: c.propertyId, value: c.value },
					cellPerms,
					tooLong,
				) ?? [],
		),
	);
	for (const batch of chunk(cellRows, BATCH)) {
		await tables.upsertRows({
			databaseId: DATABASE_ID,
			tableId: CELLS,
			rows: batch as unknown as object[],
		});
	}
	return { created: drafts.length, tooLong };
}

export async function updateRowMeta(
	databaseId: string,
	rowId: string,
	patch: {
		title?: string;
		position?: number;
		coverFileId?: string | null;
		icon?: string | null;
	},
) {
	const access = await editAccess(databaseId);
	const row = (await requireRowsIn(databaseId, [rowId])).get(rowId);
	const data: Record<string, unknown> = { updatedBy: access.viewer.userId };
	if (patch.title !== undefined) data.title = String(patch.title).slice(0, 512);
	if (patch.position !== undefined) data.position = Number(patch.position);
	if (patch.icon !== undefined) data.icon = patch.icon;
	if (patch.coverFileId !== undefined) {
		// A row's cover was uploaded against the row, which may have been created by someone other
		// than the database's creator on a shared database; either belonging is fine.
		if (
			patch.coverFileId &&
			!(await fileBelongsTo(patch.coverFileId, access.page)) &&
			!(await fileBelongsTo(patch.coverFileId, {
				workspaceId: access.page.workspaceId,
				createdBy: row?.createdBy ?? "",
			}))
		)
			throw new AuthError("You can't use that file here.", "forbidden");
		data.coverFileId = patch.coverFileId;
	}
	return db(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId,
		data,
	});
}

async function updateRowsById(
	access: Access,
	rowIds: string[],
	data: Record<string, unknown>,
) {
	const tables = db(adminClient());
	for (const batch of chunk(rowIds, BATCH)) {
		await tables.updateRows({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			data: { ...data, updatedBy: access.viewer.userId },
			queries: [
				Query.equal("$id", batch),
				Query.equal("databaseId", [access.page.id]),
			],
		});
	}
}

export async function trashRows(
	databaseId: string,
	rowIds: string[],
	restore: boolean,
) {
	if (rowIds.length > MAX_ROWS_PER_CALL)
		throw new Error(`Send at most ${MAX_ROWS_PER_CALL} rows at a time.`);
	const access = await editAccess(databaseId);
	await updateRowsById(access, rowIds, {
		trashedAt: restore ? null : new Date().toISOString(),
	});
	return { done: rowIds.length };
}

type RowCopy = { id: string; sourceId: string };

// Duplicates rows with their cells and body. Ids come from the browser so a retried batch lands on
// the same rows instead of making more copies.
export async function duplicateRows(databaseId: string, copies: RowCopy[]) {
	if (copies.length > MAX_ROWS_PER_CALL)
		throw new Error(`Send at most ${MAX_ROWS_PER_CALL} rows at a time.`);
	const access = await editAccess(databaseId);
	const sourceIds = copies.map((c) => c.sourceId);
	const tables = db(adminClient());
	const sources = await listAll<PageRow & { $id: string }>(
		access.client,
		PAGES,
		[Query.equal("$id", sourceIds), Query.equal("databaseId", [databaseId])],
	);
	const byId = new Map(sources.map((s) => [s.$id, s]));
	const cells = (
		await listAll<{
			pageId: string;
			propertyId: string;
			value: string;
			$permissions: string[];
		}>(access.client, CELLS, [
			Query.equal("pageId", sourceIds),
			Query.equal("databaseId", [databaseId]),
		])
	).filter((c) => isTrusted(c, access.page));
	const bodies = await listAll<{
		$id: string;
		snapshot: string | null;
		stateVector: string | null;
		snapshotAt: string | null;
		text: string | null;
	}>(access.client, BODIES, [Query.equal("$id", sourceIds)]);
	const bodyById = new Map(bodies.map((b) => [b.$id, b]));
	const perms = contentPermissions(access.page);
	const drafts: RowDraft[] = [];
	for (const copy of copies) {
		const source = byId.get(copy.sourceId);
		if (!source) continue;
		drafts.push({
			id: copy.id,
			title: source.title ? `${source.title} (copy)` : "",
			position: source.position + Math.random() / 1000,
			cells: cells
				.filter((c) => c.pageId === copy.sourceId)
				.map((c) => ({
					propertyId: c.propertyId,
					value: c.value === null ? null : JSON.parse(c.value),
				})),
		});
	}
	await createRows(databaseId, drafts);
	for (const copy of copies) {
		const body = bodyById.get(copy.sourceId);
		if (body?.snapshot) {
			await tables.updateRow({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: copy.id,
				data: {
					snapshot: body.snapshot,
					stateVector: body.stateVector,
					snapshotAt: body.snapshotAt,
					text: body.text,
				},
			});
		}
	}
	return { created: drafts.length, permissions: perms.length };
}

// ---------- Properties ----------

export type PropertyDraft = {
	databaseId: string;
	name: string;
	type: string;
	options: Record<string, unknown>;
	position: number;
	reverseName?: string;
};

export async function createProperty(draft: PropertyDraft) {
	const access = await editAccess(draft.databaseId);
	const perms = contentPermissions(access.page);
	const admin = db(adminClient());
	const id = ID.unique();
	const options: Record<string, unknown> = { ...draft.options };
	// Set below, or not at all: a client can't plant a pairing that deleteProperty would later follow.
	delete options.pairedPropertyId;
	delete options.side;
	let paired: RawProperty | null = null;

	if (draft.type === "relation" && draft.reverseName) {
		const targetId = String(options.targetDatabaseId ?? "");
		const target = await editAccess(targetId);
		const reverseId = ID.unique();
		const targetPerms = contentPermissions(target.page);
		const reverseOptions = {
			targetDatabaseId: draft.databaseId,
			pairedPropertyId: id,
			side: "reverse" as const,
		};
		await admin.createRow({
			databaseId: DATABASE_ID,
			tableId: PROPERTIES,
			rowId: reverseId,
			data: {
				workspaceId: target.page.workspaceId,
				databaseId: targetId,
				name: draft.reverseName.slice(0, 128),
				type: "relation",
				options: JSON.stringify(reverseOptions),
				position: Date.now() / 1000,
			},
			permissions: targetPerms,
		});
		options.pairedPropertyId = reverseId;
		options.side = "source";
		paired = {
			id: reverseId,
			databaseId: targetId,
			name: draft.reverseName,
			type: "relation",
			options: reverseOptions as Record<string, Json>,
			position: Date.now() / 1000,
		};
	}

	await admin.createRow({
		databaseId: DATABASE_ID,
		tableId: PROPERTIES,
		rowId: id,
		data: {
			workspaceId: access.page.workspaceId,
			databaseId: draft.databaseId,
			name: draft.name.slice(0, 128),
			type: draft.type,
			options: JSON.stringify(options),
			position: draft.position,
		},
		permissions: perms,
	});
	return {
		property: {
			id,
			databaseId: draft.databaseId,
			name: draft.name,
			type: draft.type,
			options: options as Record<string, Json>,
			position: draft.position,
		} satisfies RawProperty,
		paired,
	};
}

const RELATION_LINKS = ["pairedPropertyId", "side"] as const;

export async function updateProperty(
	databaseId: string,
	propertyId: string,
	patch: {
		name?: string;
		type?: string;
		options?: Record<string, unknown>;
		position?: number;
	},
) {
	await editAccess(databaseId);
	const existing = await propertyIn<PropertyRow>(
		PROPERTIES,
		databaseId,
		propertyId,
	);
	if (existing.type === "title" && patch.type && patch.type !== "title")
		throw new Error("The name column can't change type.");
	const data: Record<string, unknown> = {};
	if (patch.name !== undefined) data.name = patch.name.slice(0, 128);
	if (patch.type !== undefined) data.type = patch.type;
	if (patch.options !== undefined) {
		// Which property a relation points at is set once, when it's created; the client can't redirect it.
		const stored = parseJson(existing.options);
		const options: Record<string, unknown> = { ...patch.options };
		for (const key of RELATION_LINKS) {
			if (key in stored) options[key] = stored[key];
			else delete options[key];
		}
		data.options = JSON.stringify(options);
	}
	if (patch.position !== undefined) data.position = patch.position;
	await db(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: PROPERTIES,
		rowId: propertyId,
		data,
	});
}

const DELETE_MS = 12_000;

async function deleteCellsOf(propertyIds: string[], deadline: number) {
	const tables = db(adminClient());
	for (const propertyId of propertyIds) {
		for (;;) {
			const { rows } = await tables.listRows({
				databaseId: DATABASE_ID,
				tableId: CELLS,
				queries: [Query.equal("propertyId", [propertyId]), Query.limit(BATCH)],
			});
			if (!rows.length) break;
			await tables.deleteRows({
				databaseId: DATABASE_ID,
				tableId: CELLS,
				queries: [
					Query.equal(
						"$id",
						rows.map((r) => r.$id),
					),
				],
			});
			if (rows.length < BATCH) break;
			if (Date.now() > deadline) return false;
		}
	}
	return true;
}

// One slice per call: cells go first, so the property row, which is what the browser retries on,
// is removed last. `done: false` means call again.
export async function deleteProperty(databaseId: string, propertyId: string) {
	const access = await editAccess(databaseId);
	const rows = await listAll<PropertyRow>(access.client, PROPERTIES, [
		Query.equal("databaseId", [databaseId]),
	]);
	const target = rows.find((r) => r.$id === propertyId);
	if (!target) return { deleted: 0, done: true };
	if (target.type === "title")
		throw new Error("The name column can't be deleted.");
	const admin = db(adminClient());
	const ids = [propertyId];
	const options = parseJson(target.options);
	const paired = options.pairedPropertyId;
	const targetDatabase = options.targetDatabaseId;
	if (
		target.type === "relation" &&
		typeof paired === "string" &&
		paired &&
		typeof targetDatabase === "string" &&
		targetDatabase
	) {
		// The stored pointer is only followed if it holds in both directions and the person can edit
		// the other database too; a relation can't be aimed at someone else's property to delete it.
		const other = await admin
			.getRow<Models.Row & PropertyRow>({
				databaseId: DATABASE_ID,
				tableId: PROPERTIES,
				rowId: paired,
			})
			.catch(() => null);
		if (
			other &&
			other.databaseId === targetDatabase &&
			other.type === "relation" &&
			parseJson(other.options).pairedPropertyId === propertyId
		) {
			await editAccess(targetDatabase);
			ids.push(paired);
		}
	}
	if (!(await deleteCellsOf(ids, Date.now() + DELETE_MS)))
		return { deleted: 0, done: false };
	for (const id of ids) {
		await admin
			.deleteRow({ databaseId: DATABASE_ID, tableId: PROPERTIES, rowId: id })
			.catch((err) => {
				if (errorCode(err) !== 404) throw err;
			});
	}
	return { deleted: ids.length, done: true };
}

// ---------- Views ----------

export async function createView(view: {
	databaseId: string;
	name: string;
	type: string;
	config: Record<string, unknown>;
	position: number;
}): Promise<RawView> {
	const access = await editAccess(view.databaseId);
	const id = ID.unique();
	await db(adminClient()).createRow({
		databaseId: DATABASE_ID,
		tableId: VIEWS,
		rowId: id,
		data: {
			workspaceId: access.page.workspaceId,
			databaseId: view.databaseId,
			name: view.name.slice(0, 128),
			type: view.type,
			config: JSON.stringify(view.config),
			position: view.position,
		},
		permissions: contentPermissions(access.page),
	});
	return { id, ...view, config: view.config as Record<string, Json> };
}

export async function updateView(
	databaseId: string,
	viewId: string,
	patch: {
		name?: string;
		type?: string;
		config?: Record<string, unknown>;
		position?: number;
	},
) {
	await editAccess(databaseId);
	await propertyIn<ViewRow>(VIEWS, databaseId, viewId);
	const data: Record<string, unknown> = {};
	if (patch.name !== undefined) data.name = patch.name.slice(0, 128);
	if (patch.type !== undefined) data.type = patch.type;
	if (patch.config !== undefined) data.config = JSON.stringify(patch.config);
	if (patch.position !== undefined) data.position = patch.position;
	await db(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: VIEWS,
		rowId: viewId,
		data,
	});
}

export async function deleteView(databaseId: string, viewId: string) {
	await editAccess(databaseId);
	await propertyIn<ViewRow>(VIEWS, databaseId, viewId);
	await db(adminClient()).deleteRow({
		databaseId: DATABASE_ID,
		tableId: VIEWS,
		rowId: viewId,
	});
}

// ---------- Sharing ----------
