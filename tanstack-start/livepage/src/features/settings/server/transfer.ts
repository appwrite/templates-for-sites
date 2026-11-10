// Moving data in and out, and deleting a whole workspace. All in batches small enough for a Site
// request: the browser keeps calling until the job says it's done.
import { type Models, Query, Storage, TablesDB, Teams } from "node-appwrite";
import * as Y from "yjs";
import { isTrusted } from "#/features/editor/access";
import { fromBase64 } from "#/features/editor/codec";
import { docFileIds, markdownToBlocks, snapshotFromBlocks } from "#/lib/blocks";
import { fitCell } from "#/lib/cells";
import {
	cellPermissions,
	cellRowId,
	contentPermissions,
	pagePermissions,
	rowHash,
} from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import { adminClient, errorCode } from "#/server/appwrite";
import { AuthError, requireWorkspace } from "#/server/auth";
import { fileOwnedBy } from "#/server/files";
import {
	ACCESS_REQUESTS,
	BODIES,
	BUCKET_ID,
	CELLS,
	COMMENTS,
	DATABASE_ID,
	FAVORITES,
	LINKS,
	NOTIFICATIONS,
	PAGES,
	PROPERTIES,
	UPDATES,
	VERSIONS,
	VIEWS,
	VISITS,
	WORKSPACES,
} from "#/server/schema";
import { deleteWorkspaceIconFile } from "./account";

type AppRow = Models.Row & PageRow;
type PropRow = Models.Row & {
	name: string;
	type: string;
	options: string | null;
	position: number;
};
type CellRow = Models.Row & {
	pageId: string;
	propertyId: string;
	value: string | null;
};

// ---------- import ----------

export type ImportItem = {
	key: string;
	parentKey: string | null;
	kind: "page" | "database";
	title: string;
	markdown?: string;
	columns?: string[];
	rows?: string[][];
	// Where this batch's rows sit in the whole file. A database is sent in several batches.
	rowOffset?: number;
	rowBodies?: Record<string, string>;
};

// A cell the import cut short or had to leave out.
export type ImportTooLong = { row: string; column: string; saved: boolean };

const CHOICE_COLORS = ["gray", "green", "amber", "blue", "violet", "coral"];

function access(workspaceId: string, createdBy: string) {
	return {
		workspaceId,
		visibility: "workspace" as const,
		createdBy,
		shares: [],
	};
}

// Each item's row id comes from the import id and its key, so a retried batch overwrites itself.
export async function importBatch(input: {
	workspaceId: string;
	importId: string;
	sectionId: string | null;
	items: ImportItem[];
}) {
	const { viewer, role } = await requireWorkspace(input.workspaceId);
	if (role === "guest") throw new Error("Guests can't import pages.");
	const db = new TablesDB(adminClient());
	const pageId = (key: string) =>
		rowHash("import", input.workspaceId, input.importId, key).slice(0, 32);
	const acc = access(input.workspaceId, viewer.userId);
	const perms = pagePermissions(acc);
	const content = contentPermissions(acc);
	let created = 0;
	const tooLong: ImportTooLong[] = [];

	const position = Date.now() / 1000;
	for (const [index, item] of input.items.entries()) {
		const id = pageId(item.key);
		const parentId = item.parentKey ? pageId(item.parentKey) : null;
		await db.upsertRow({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: id,
			data: {
				workspaceId: input.workspaceId,
				parentId,
				sectionId: parentId ? null : input.sectionId,
				kind: item.kind,
				title: item.title.slice(0, 512),
				position: position + index / 1000,
				databaseId: null,
				visibility: "workspace",
				createdBy: viewer.userId,
				updatedBy: viewer.userId,
			},
			permissions: perms,
		});
		if (item.kind === "page") {
			const { snapshot, stateVector, text } = snapshotFromBlocks(
				id,
				item.title,
				markdownToBlocks(item.markdown ?? ""),
			);
			await db.upsertRow({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: id,
				data: {
					workspaceId: input.workspaceId,
					pageId: id,
					snapshot,
					stateVector,
					snapshotAt: new Date().toISOString(),
					text,
				},
				permissions: content,
			});
		} else {
			await db.upsertRow({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: id,
				data: { workspaceId: input.workspaceId, pageId: id },
				permissions: content,
			});
			await importDatabase(
				db,
				id,
				item,
				input.workspaceId,
				viewer.userId,
				content,
				cellPermissions(acc),
				perms,
				tooLong,
			);
		}
		created++;
	}
	return { created, tooLong };
}

async function importDatabase(
	db: TablesDB,
	databaseId: string,
	item: ImportItem,
	workspaceId: string,
	userId: string,
	content: string[],
	cells: string[],
	perms: string[],
	tooLong: ImportTooLong[],
) {
	const columns = item.columns ?? [];
	const rows = item.rows ?? [];
	const offset = item.rowOffset ?? 0;
	const propertyIds = columns.map((_, i) =>
		rowHash("prop", databaseId, String(i)).slice(0, 32),
	);
	// The first column is the row title; the rest come in as text.
	await db.upsertRows({
		databaseId: DATABASE_ID,
		tableId: PROPERTIES,
		rows: columns.map((name, i) => ({
			$id: propertyIds[i],
			$permissions: content,
			workspaceId,
			databaseId,
			name: name.slice(0, 128),
			type: i === 0 ? "title" : "text",
			options: "{}",
			position: i,
		})),
	});
	await db.upsertRow({
		databaseId: DATABASE_ID,
		tableId: VIEWS,
		rowId: rowHash("view", databaseId),
		data: {
			workspaceId,
			databaseId,
			name: "Table",
			type: "table",
			config: "{}",
			position: 0,
		},
		permissions: content,
	});
	for (let i = 0; i < rows.length; i += 100) {
		const part = rows.slice(i, i + 100);
		const ids = part.map((_, n) =>
			rowHash("row", databaseId, String(offset + i + n)).slice(0, 32),
		);
		await db.upsertRows({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rows: part.map((row, n) => ({
				$id: ids[n],
				$permissions: perms,
				workspaceId,
				kind: "row",
				databaseId,
				title: (row[0] ?? "").slice(0, 512),
				position: offset + i + n,
				visibility: "workspace",
				createdBy: userId,
				updatedBy: userId,
			})),
		});
		await db.upsertRows({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			rows: part.map((row, n) => {
				const md = item.rowBodies?.[row[0] ?? ""];
				const facts = md
					? snapshotFromBlocks(ids[n], row[0] ?? "", markdownToBlocks(md))
					: null;
				return {
					$id: ids[n],
					$permissions: content,
					workspaceId,
					pageId: ids[n],
					...(facts
						? {
								snapshot: facts.snapshot,
								stateVector: facts.stateVector,
								snapshotAt: new Date().toISOString(),
								text: facts.text,
							}
						: {}),
				};
			}),
		});
		const cellRows = part.flatMap((row, n) =>
			columns.slice(1).flatMap((column, c) => {
				const fit = fitCell(row[c + 1] ?? null);
				if (!fit.fits || fit.clipped)
					tooLong.push({ row: row[0] ?? "", column, saved: fit.fits });
				if (!fit.fits) return [];
				return [
					{
						$id: cellRowId(ids[n], propertyIds[c + 1]),
						$permissions: cells,
						workspaceId,
						databaseId,
						pageId: ids[n],
						propertyId: propertyIds[c + 1],
						value: fit.json,
						updatedBy: userId,
					},
				];
			}),
		);
		for (let c = 0; c < cellRows.length; c += 100)
			await db.upsertRows({
				databaseId: DATABASE_ID,
				tableId: CELLS,
				rows: cellRows.slice(c, c + 100),
			});
	}
}

// ---------- export ----------

export type ExportPage = {
	id: string;
	parentId: string | null;
	kind: Page["kind"];
	title: string;
	snapshot: string | null;
	updates: string[];
};

// The next pages for the browser to turn into Markdown, read with the person's own client and cut off
// by size or time so one response stays well inside what a Site request can carry.
const EXPORT_CHARS = 3_000_000;
const EXPORT_MS = 12_000;

export async function exportBatch(workspaceId: string, cursor?: string) {
	const { client } = await requireWorkspace(workspaceId);
	const db = new TablesDB(client);
	const { rows } = await db.listRows<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [
			Query.equal("workspaceId", [workspaceId]),
			Query.notEqual("kind", "row"),
			Query.isNull("trashedAt"),
			Query.limit(50),
			...(cursor ? [Query.cursorAfter(cursor)] : []),
		],
	});
	const deadline = Date.now() + EXPORT_MS;
	const out: ExportPage[] = [];
	let chars = 0;
	let last: string | null = null;
	for (const row of rows) {
		const page = toPage(row);
		const body = await db
			.getRow<Models.Row & { snapshot: string | null }>({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: page.id,
			})
			.catch(() => null);
		const updates: string[] = [];
		let after: string | undefined;
		for (;;) {
			const part = await db.listRows<Models.Row & { data: string | null }>({
				databaseId: DATABASE_ID,
				tableId: UPDATES,
				queries: [
					Query.equal("pageId", [page.id]),
					Query.orderAsc("$createdAt"),
					Query.limit(500),
					...(after ? [Query.cursorAfter(after)] : []),
				],
			});
			for (const u of part.rows) if (u.data) updates.push(u.data);
			if (part.rows.length < 500) break;
			after = part.rows[part.rows.length - 1].$id;
		}
		out.push({
			id: page.id,
			parentId: page.parentId,
			kind: page.kind,
			title: page.title,
			snapshot: body?.snapshot ?? null,
			updates,
		});
		chars +=
			(body?.snapshot?.length ?? 0) + updates.reduce((n, u) => n + u.length, 0);
		last = page.id;
		if (chars > EXPORT_CHARS || Date.now() > deadline) break;
	}
	const more = last !== rows[rows.length - 1]?.$id || rows.length === 50;
	return { pages: out, cursor: more ? last : null };
}

function cellText(
	value: unknown,
	prop: { options: string | null; type: string },
) {
	if (value === null || value === undefined) return "";
	let options: { choices?: { id: string; name: string }[] } = {};
	try {
		options = JSON.parse(prop.options || "{}");
	} catch {
		// Plain values have no options to read.
	}
	const name = (v: unknown) =>
		options.choices?.find((c) => c.id === v)?.name ?? String(v);
	if (Array.isArray(value)) return value.map(name).join(", ");
	if (typeof value === "object") {
		const obj = value as { start?: string; end?: string; name?: string };
		if (obj.start) return obj.end ? `${obj.start} to ${obj.end}` : obj.start;
		if (obj.name) return obj.name;
		return JSON.stringify(value);
	}
	return name(value);
}

// A database as rows of text, for the spreadsheet in the export. One slice per call: the browser
// keeps asking with the cursor until there's none left.
export async function exportDatabase(
	workspaceId: string,
	databaseId: string,
	start?: string,
) {
	const { client } = await requireWorkspace(workspaceId);
	const db = new TablesDB(client);
	const databasePage = await db.getRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: databaseId,
	});
	if (
		databasePage.workspaceId !== workspaceId ||
		databasePage.kind !== "database"
	)
		throw new AuthError("That database isn't in this workspace.", "forbidden");
	const databaseAccess = toPage(databasePage);
	const { rows: props } = await db.listRows<PropRow>({
		databaseId: DATABASE_ID,
		tableId: PROPERTIES,
		queries: [
			Query.equal("databaseId", [databaseId]),
			Query.orderAsc("position"),
			Query.limit(100),
		],
	});
	const properties = props.filter(
		(p) => !["formula", "rollup"].includes(p.type),
	);
	const headers = [
		"Name",
		...properties.filter((p) => p.type !== "title").map((p) => p.name),
	];
	const out: string[][] = [];
	let cursor: string | undefined = start;
	const deadline = Date.now() + EXPORT_MS;
	for (;;) {
		const { rows } = await db.listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				Query.equal("databaseId", [databaseId]),
				Query.isNull("trashedAt"),
				Query.orderAsc("position"),
				Query.limit(100),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		if (rows.length) {
			const { rows: cells } = await db.listRows<CellRow>({
				databaseId: DATABASE_ID,
				tableId: CELLS,
				queries: [
					Query.equal(
						"pageId",
						rows.map((r) => r.$id),
					),
					Query.limit(5000),
				],
			});
			// Anyone signed in can add a cell row naming a page; only members' rows count.
			const trusted = cells.filter((c) => isTrusted(c, databaseAccess));
			for (const row of rows) {
				const cellFor = (propertyId: string) =>
					trusted.find(
						(c) => c.pageId === row.$id && c.propertyId === propertyId,
					);
				const parse = (c?: CellRow) => {
					if (!c?.value) return null;
					try {
						return JSON.parse(c.value);
					} catch {
						return c.value;
					}
				};
				out.push([
					row.title ?? "",
					...properties
						.filter((p) => p.type !== "title")
						.map((p) => cellText(parse(cellFor(p.$id)), p)),
				]);
			}
		}
		if (rows.length < 100) return { headers, rows: out, cursor: null };
		cursor = rows[rows.length - 1].$id;
		if (Date.now() > deadline || out.length >= 2000)
			return { headers, rows: out, cursor };
	}
}

// ---------- deleting a workspace ----------

const WORKSPACE_TABLES = [
	UPDATES,
	VERSIONS,
	CELLS,
	COMMENTS,
	PROPERTIES,
	VIEWS,
	LINKS,
	FAVORITES,
	VISITS,
	NOTIFICATIONS,
	ACCESS_REQUESTS,
];

const WORKSPACE_STEP_MS = 12_000;
const TABLES_STAGE = "tables";

// One slice per call, so it stays inside a Site request; deletes everything under the workspace,
// and the team itself only at the very end.
export async function deleteWorkspaceStep(
	workspaceId: string,
	cursor?: string,
) {
	const { role } = await requireWorkspace(workspaceId);
	if (role !== "owner")
		throw new Error("Only the owner can delete the workspace.");
	const client = adminClient();
	const admin = new TablesDB(client);
	const storage = new Storage(client);
	const deadline = Date.now() + WORKSPACE_STEP_MS;
	const byWorkspace = [Query.equal("workspaceId", [workspaceId])];

	if (cursor !== TABLES_STAGE) {
		// Files first, while the bodies that reference them still exist.
		const { rows } = await admin.listRows<
			Models.Row & { snapshot: string | null }
		>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			queries: [
				...byWorkspace,
				Query.select(["$id", "snapshot"]),
				Query.limit(100),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		for (const row of rows) {
			if (!row.snapshot) continue;
			let files: string[] = [];
			try {
				const doc = new Y.Doc();
				Y.applyUpdate(doc, fromBase64(row.snapshot));
				files = docFileIds(doc);
				doc.destroy();
			} catch {
				// A broken snapshot has no files to find.
			}
			// A file id in a body is just text someone could type, so only files that really belong
			// to this workspace (or the page's creator) are deleted with the site key.
			const page = await admin
				.getRow<AppRow>({
					databaseId: DATABASE_ID,
					tableId: PAGES,
					rowId: row.$id,
				})
				.catch(() => null);
			const owner = { workspaceId, createdBy: page?.createdBy ?? "" };
			await Promise.all(
				files.map(async (fileId) => {
					const file = await storage
						.getFile({ bucketId: BUCKET_ID, fileId })
						.catch(() => null);
					if (!file || !fileOwnedBy(file, owner)) return;
					await storage
						.deleteFile({ bucketId: BUCKET_ID, fileId })
						.catch((err) => {
							if (errorCode(err) !== 404) throw err;
						});
				}),
			);
		}
		if (rows.length === 100)
			return { done: false as const, cursor: rows[rows.length - 1].$id };
		await deleteWorkspaceIconFile(workspaceId);
		return { done: false as const, cursor: TABLES_STAGE };
	}

	for (const tableId of [...WORKSPACE_TABLES, BODIES, PAGES]) {
		if (!(await deleteUntil(admin, tableId, byWorkspace, deadline)))
			return { done: false as const, cursor: TABLES_STAGE };
	}
	await admin
		.deleteRow({
			databaseId: DATABASE_ID,
			tableId: WORKSPACES,
			rowId: workspaceId,
		})
		.catch((err) => {
			if (errorCode(err) !== 404) throw err;
		});
	await new Teams(adminClient())
		.delete({ teamId: workspaceId })
		.catch((err) => {
			if (errorCode(err) !== 404) throw err;
		});
	return { done: true as const, cursor: null };
}

// True once the table has nothing left for these queries. False when the deadline came first.
async function deleteUntil(
	db: TablesDB,
	tableId: string,
	queries: string[],
	deadline: number,
) {
	for (;;) {
		const { total } = await db.deleteRows({
			databaseId: DATABASE_ID,
			tableId,
			queries: [...queries, Query.limit(1000)],
		});
		if (total < 1000) return true;
		if (Date.now() > deadline) return false;
	}
}

export { CHOICE_COLORS };
