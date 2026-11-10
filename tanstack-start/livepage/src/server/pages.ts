import { type Client, ID, type Models, Query, TablesDB } from "node-appwrite";
import { contentPermissions, pagePermissions } from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page, PageDraft, PagePatch, Visibility } from "#/lib/types";
import { adminClient } from "./appwrite";
import { AuthError, requireViewer, requireWorkspace } from "./auth";
import { pageAccess } from "./body";
import { fileBelongsTo } from "./files";
import { BODIES, DATABASE_ID, PAGES } from "./schema";

type AppRow = Models.Row & PageRow;

function db(client: Client) {
	return new TablesDB(client);
}

// Every non-trashed page and database in the workspace the person can read (rows are excluded).
export async function listPages(workspaceId: string): Promise<Page[]> {
	const { client } = await requireWorkspace(workspaceId);
	const out: Page[] = [];
	let cursor: string | undefined;
	while (true) {
		const queries = [
			Query.equal("workspaceId", [workspaceId]),
			Query.notEqual("kind", "row"),
			Query.isNull("trashedAt"),
			Query.limit(500),
			...(cursor ? [Query.cursorAfter(cursor)] : []),
		];
		const page = await db(client).listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries,
		});
		out.push(...page.rows.map(toPage));
		if (page.rows.length < 500) break;
		cursor = page.rows[page.rows.length - 1].$id;
	}
	return out;
}

export async function createPage(draft: PageDraft): Promise<Page> {
	const { client, viewer, role } = await requireWorkspace(draft.workspaceId);
	if (role === "guest")
		throw new AuthError("Guests can't create pages.", "forbidden");
	// A row is only ever made by createRows, inside the database it belongs to.
	const kind = draft.kind === "database" ? "database" : "page";
	const visibility: Visibility =
		draft.visibility === "private" ? "private" : "workspace";
	const parentId = draft.parentId || null;
	if (parentId) await requireSameWorkspace(client, parentId, draft.workspaceId);
	const access = {
		workspaceId: draft.workspaceId,
		visibility,
		createdBy: viewer.userId,
		shares: [],
	};
	const id = ID.unique();
	const admin = db(adminClient());
	const row = await admin.createRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: id,
		data: {
			workspaceId: draft.workspaceId,
			parentId,
			sectionId: draft.sectionId ?? null,
			kind,
			title: (draft.title ?? "").slice(0, 512),
			icon: draft.icon ?? null,
			coverFileId: null,
			position: draft.position ?? Date.now() / 1000,
			databaseId: null,
			visibility,
			shares: null,
			publishedSlug: null,
			trashedAt: null,
			createdBy: viewer.userId,
			updatedBy: viewer.userId,
		},
		permissions: pagePermissions(access),
	});
	// The body row. Content is added by the editor.
	await admin.createRow({
		databaseId: DATABASE_ID,
		tableId: BODIES,
		rowId: id,
		data: {
			workspaceId: draft.workspaceId,
			pageId: id,
			snapshot: null,
			stateVector: null,
			snapshotAt: null,
			text: null,
		},
		permissions: contentPermissions(access),
	});
	return toPage(row);
}

async function requireSameWorkspace(
	client: Client,
	pageId: string,
	workspaceId: string,
) {
	const parent = await db(client).getRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: pageId,
	});
	if (parent.workspaceId !== workspaceId)
		throw new AuthError("That page is in another workspace.", "forbidden");
}

// Pages can only change here, with the site key, after the check below: their row permissions give
// a JWT read access and nothing else, so createdBy, shares, visibility and publishedSlug stay
// out of reach of direct writes. Only these fields can be set; everything else in `patch` is ignored.
export async function updatePage(
	pageId: string,
	patch: PagePatch,
): Promise<Page> {
	const access = await pageAccess(pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	const data: Record<string, unknown> = { updatedBy: access.viewerId };
	if (patch.title !== undefined) data.title = String(patch.title).slice(0, 512);
	if (patch.icon !== undefined) data.icon = patch.icon;
	if (patch.sectionId !== undefined) data.sectionId = patch.sectionId;
	if (patch.position !== undefined) data.position = Number(patch.position);
	if (patch.parentId !== undefined) {
		if (patch.parentId === pageId)
			throw new Error("A page can't be its own parent.");
		if (patch.parentId) {
			const { client } = await requireViewer();
			await requireSameWorkspace(
				client,
				patch.parentId,
				access.page.workspaceId,
			);
		}
		data.parentId = patch.parentId;
	}
	if (patch.coverFileId !== undefined) {
		if (
			patch.coverFileId &&
			!(await fileBelongsTo(patch.coverFileId, access.page))
		)
			throw new AuthError("You can't use that file here.", "forbidden");
		data.coverFileId = patch.coverFileId;
	}
	const row = await db(adminClient()).updateRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: pageId,
		data,
	});
	return toPage(row);
}

export async function trashPage(
	pageId: string,
	restore = false,
): Promise<Page> {
	const access = await pageAccess(pageId);
	if (access.level !== "edit")
		throw new AuthError("You can only view this page.", "forbidden");
	const row = await db(adminClient()).updateRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: pageId,
		data: {
			trashedAt: restore ? null : new Date().toISOString(),
			updatedBy: access.viewerId,
		},
	});
	return toPage(row);
}
