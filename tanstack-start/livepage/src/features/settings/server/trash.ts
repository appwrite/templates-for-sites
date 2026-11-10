// Trash: pages keep their rows while trashed. Deleting for good removes the page, its sub-pages
// and database rows, and everything that belongs to them, in batches through the site key.
import {
	type Client,
	type Models,
	Query,
	Storage,
	TablesDB,
} from "node-appwrite";
import * as Y from "yjs";
import { fromBase64 } from "#/features/editor/codec";
import { docFileIds } from "#/lib/blocks";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import { adminClient, errorCode } from "#/server/appwrite";
import { AuthError, requireViewer, requireWorkspace } from "#/server/auth";
import { pageAccess } from "#/server/body";
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
} from "#/server/schema";

type AppRow = Models.Row & PageRow;

export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

export type TrashedPage = Page & { path: string };

async function allPages(client: Client, queries: string[]) {
	const out: Page[] = [];
	let cursor: string | undefined;
	for (;;) {
		const { rows } = await new TablesDB(client).listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				...queries,
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		out.push(...rows.map(toPage));
		if (rows.length < 500) break;
		cursor = rows[rows.length - 1].$id;
	}
	return out;
}

export async function loadTrash(workspaceId: string) {
	const { client, role } = await requireWorkspace(workspaceId);
	const trashed = await allPages(client, [
		Query.equal("workspaceId", [workspaceId]),
		Query.isNotNull("trashedAt"),
		Query.orderDesc("trashedAt"),
	]);
	// Pages past their 30 days go now. There's no background job on a Site, so opening Trash does it.
	const now = Date.now();
	const expired = trashed.filter(
		(p) => now - Date.parse(p.trashedAt as string) > TRASH_DAYS * DAY_MS,
	);
	// Whatever doesn't finish in this request is still expired the next time Trash is opened.
	const deadline = Date.now() + PURGE_MS;
	for (const page of expired) {
		if (Date.now() > deadline) break;
		await purgeSteps(page, deadline);
	}
	const live = trashed.filter((p) => !expired.includes(p));
	const parents = await parentPaths(client, live);
	return {
		role,
		pages: live.map((p) => ({ ...p, path: parents.get(p.id) ?? "" })),
	};
}

async function parentPaths(client: Client, pages: Page[]) {
	const out = new Map<string, string>();
	const ids = [
		...new Set(pages.map((p) => p.parentId).filter(Boolean)),
	] as string[];
	if (!ids.length) return out;
	const parents = await allPages(client, [Query.equal("$id", ids)]);
	const names = new Map(parents.map((p) => [p.id, p.title || "Untitled"]));
	for (const page of pages)
		if (page.parentId) out.set(page.id, names.get(page.parentId) ?? "");
	return out;
}

export async function restorePage(pageId: string) {
	const { client } = await requireViewer();
	const access = await pageAccess(pageId);
	if (access.level !== "edit")
		throw new AuthError("You can only view this page.", "forbidden");
	const db = new TablesDB(client);
	const row = access.page;
	const patch: Record<string, unknown> = {
		trashedAt: null,
		updatedBy: access.viewerId,
	};
	// Its parent may be gone for good; then it comes back at the top level.
	if (row.parentId) {
		try {
			const parent = await db.getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: row.parentId,
			});
			if (parent.trashedAt) patch.parentId = null;
		} catch (err) {
			if (errorCode(err) === 404) patch.parentId = null;
			else throw err;
		}
	}
	return toPage(
		await new TablesDB(adminClient()).updateRow<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: pageId,
			data: patch,
		}),
	);
}

// Anyone who can edit a page can delete it, the same as moving it to Trash. Large trees don't fit in
// one request, so the browser calls this again with `state` until `done`: nothing in the tree is
// removed before its own children, and the page row goes last, so an unfinished delete can be run again.
export async function deletePageForever(pageId: string, state?: PurgeState) {
	const access = await pageAccess(pageId);
	if (access.level !== "edit")
		throw new AuthError("You can only view this page.", "forbidden");
	if (!access.page.trashedAt) throw new Error("Move the page to Trash first.");
	return purgeSteps(access.page, Date.now() + PURGE_MS, state);
}

const clearBy = (
	db: TablesDB,
	tableId: string,
	attribute: string,
	values: string[],
) => deleteAll(db, tableId, [Query.equal(attribute, values)]);

export async function deleteAll(
	db: TablesDB,
	tableId: string,
	queries: string[],
) {
	// Bulk deletes take up to the batch limit in one call; repeat until nothing is left.
	for (;;) {
		const { total } = await db.deleteRows({
			databaseId: DATABASE_ID,
			tableId,
			queries: [...queries, Query.limit(1000)],
		});
		if (total < 1000) return;
	}
}

async function collectFiles(admin: TablesDB, pageIds: string[]) {
	const files = new Set<string>();
	for (let i = 0; i < pageIds.length; i += 50) {
		const part = pageIds.slice(i, i + 50);
		const { rows } = await admin.listRows<
			Models.Row & { snapshot: string | null }
		>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			queries: [
				Query.equal("pageId", part),
				Query.select(["snapshot"]),
				Query.limit(part.length),
			],
		});
		for (const row of rows) {
			if (!row.snapshot) continue;
			try {
				const doc = new Y.Doc();
				Y.applyUpdate(doc, fromBase64(row.snapshot));
				for (const id of docFileIds(doc)) files.add(id);
				doc.destroy();
			} catch {
				// A broken snapshot has no files to find.
			}
		}
	}
	return files;
}

export type PurgeState = { stack: string[]; done: number; total: number };

// How long one request works on a delete before handing back to the browser.
const PURGE_MS = 12_000;

async function loadPageRow(db: TablesDB, rowId: string) {
	try {
		return toPage(
			await db.getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId,
			}),
		);
	} catch (err) {
		if (errorCode(err) === 404) return null;
		throw err;
	}
}

// A page's rows and everything keyed by them. The pages themselves go last.
async function removeLeaves(admin: TablesDB, leaves: Page[]) {
	const ids = leaves.map((p) => p.id);
	const covers = leaves.map((p) => p.coverFileId).filter(Boolean) as string[];
	const files = await collectFiles(admin, ids);
	for (const cover of covers) files.add(cover);
	const databaseIds = leaves
		.filter((p) => p.kind === "database")
		.map((p) => p.id);
	if (databaseIds.length) {
		await clearBy(admin, CELLS, "databaseId", databaseIds);
		await clearBy(admin, PROPERTIES, "databaseId", databaseIds);
		await clearBy(admin, VIEWS, "databaseId", databaseIds);
	}
	await Promise.all([
		clearBy(admin, BODIES, "pageId", ids),
		clearBy(admin, UPDATES, "pageId", ids),
		clearBy(admin, VERSIONS, "pageId", ids),
		clearBy(admin, CELLS, "pageId", ids),
		clearBy(admin, COMMENTS, "pageId", ids),
		clearBy(admin, NOTIFICATIONS, "pageId", ids),
		clearBy(admin, FAVORITES, "pageId", ids),
		clearBy(admin, VISITS, "pageId", ids),
		clearBy(admin, ACCESS_REQUESTS, "pageId", ids),
		clearBy(admin, LINKS, "sourceId", ids),
		clearBy(admin, LINKS, "targetId", ids),
	]);
	await admin.deleteRows({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [Query.equal("$id", ids), Query.limit(1000)],
	});
	// A file id in a page body is user input, so only files this page's owners made go with it.
	const storage = new Storage(adminClient());
	await Promise.all(
		[...files].map(async (fileId) => {
			try {
				const file = await storage.getFile({ bucketId: BUCKET_ID, fileId });
				if (leaves.some((page) => fileOwnedBy(file, page)))
					await storage.deleteFile({ bucketId: BUCKET_ID, fileId });
			} catch (err) {
				if (errorCode(err) !== 404) throw err;
			}
		}),
	);
}

async function childrenOf(admin: TablesDB, page: Page) {
	const { rows } = await admin.listRows<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [
			page.kind === "database"
				? Query.or([
						Query.equal("parentId", [page.id]),
						Query.equal("databaseId", [page.id]),
					])
				: Query.equal("parentId", [page.id]),
			Query.limit(100),
		],
	});
	return rows.map(toPage);
}

// Which of these pages have nothing under them, and can go straight away.
async function leavesOf(admin: TablesDB, pages: Page[]) {
	const { rows } = await admin.listRows<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [
			Query.equal(
				"parentId",
				pages.map((p) => p.id),
			),
			Query.select(["parentId"]),
			Query.limit(1000),
		],
	});
	const parents = new Set(rows.map((r) => r.parentId));
	return pages.filter((p) => p.kind !== "database" && !parents.has(p.id));
}

// Deletes depth first until the deadline. Everything needed to continue is in the returned state.
export async function purgeSteps(
	root: Page,
	deadline: number,
	state: PurgeState = { stack: [root.id], done: 0, total: 0 },
) {
	const admin = new TablesDB(adminClient());
	if (state.stack[0] !== root.id)
		throw new Error("That delete doesn't match this page.");
	if (!state.total) state.total = await countUnder(admin, root);
	while (state.stack.length && Date.now() < deadline) {
		const top = await loadPageRow(admin, state.stack[state.stack.length - 1]);
		if (!top) {
			state.stack.pop();
			continue;
		}
		// Every id in the stack must be a child of the one before it, since the browser holds this list.
		if (state.stack.length > 1) {
			const parentId = state.stack[state.stack.length - 2];
			if (top.parentId !== parentId && top.databaseId !== parentId)
				throw new Error("That delete doesn't match this page.");
		}
		const children = await childrenOf(admin, top);
		if (!children.length) {
			await removeLeaves(admin, [top]);
			state.done++;
			state.stack.pop();
			continue;
		}
		const leaves = await leavesOf(admin, children);
		const nested = children.filter((c) => !leaves.includes(c));
		if (leaves.length) {
			await removeLeaves(admin, leaves);
			state.done += leaves.length;
		} else if (nested.length) state.stack.push(nested[0].id);
	}
	return { state, done: state.stack.length === 0 };
}

async function countUnder(admin: TablesDB, root: Page) {
	const count = async (attribute: string) =>
		(
			await admin.listRows({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				queries: [
					Query.equal(attribute, [root.id]),
					Query.select(["$id"]),
					Query.limit(1),
				],
			})
		).total;
	const under =
		(await count("parentId")) +
		(root.kind === "database" ? await count("databaseId") : 0);
	return under + 1;
}
