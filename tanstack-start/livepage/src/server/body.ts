// Page bodies: loading, guest edits, compaction, plain text and links.
import {
	type Client,
	ID,
	type Models,
	Query,
	TablesDB,
	Users,
} from "node-appwrite";
import * as Y from "yjs";
import {
	type AccessLevel,
	isTrusted,
	levelFor,
} from "#/features/editor/access";
import {
	BODY_FIELD,
	digest,
	docFromUpdates,
	fromBase64,
	MAX_STATE_CHARS,
	TITLE_FIELD,
	toBase64,
} from "#/features/editor/codec";
import {
	canWriteDirect,
	contentPermissions,
	linkRowId,
	pagePermissions,
	rowHash,
} from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page, Role } from "#/lib/types";
import { adminClient, errorCode } from "./appwrite";
import { AuthError, requireViewer, workspaceRole } from "./auth";
import { listMembers } from "./members";
import { notifyUsers } from "./notifications";
import {
	ACCESS_REQUESTS,
	BODIES,
	DATABASE_ID,
	LINKS,
	PAGES,
	UPDATES,
	VERSIONS,
} from "./schema";

export type PageAccess = {
	page: Page;
	viewerId: string;
	role: Role;
	level: AccessLevel;
	canEdit: boolean;
	canComment: boolean;
	canWriteDirect: boolean;
};

type AppRow = Models.Row & PageRow;
type UpdateRow = Models.Row & {
	workspaceId: string;
	pageId: string;
	data: string | null;
	clientId: string | null;
	cursor: string | null;
	createdBy: string | null;
};
type BodyRow = Models.Row & {
	workspaceId: string;
	pageId: string;
	snapshot: string | null;
	stateVector: string | null;
	snapshotAt: string | null;
	text: string | null;
};

const db = (client: Client) => new TablesDB(client);

export async function pageAccess(pageId: string): Promise<PageAccess> {
	const session = await requireViewer();
	const page = toPage(
		await db(session.client).getRow<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: pageId,
		}),
	);
	// Access starts from a real, confirmed membership of the page's workspace: a share or a
	// createdBy is only honoured for someone who is actually in the workspace.
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		page.workspaceId,
	);
	const level = role ? levelFor(page, session.viewer.userId, role) : null;
	if (!role || !level)
		throw new AuthError("You don't have access to this page.", "forbidden");
	return {
		page,
		viewerId: session.viewer.userId,
		role,
		level,
		canEdit: level === "edit" && !page.trashedAt,
		canComment: level !== "view" && !page.trashedAt,
		canWriteDirect: canWriteDirect(page, {
			userId: session.viewer.userId,
			role,
		}),
	};
}

export type PageResolution =
	| { status: "ok"; access: PageAccess }
	| {
			status: "forbidden";
			workspaceId: string;
			pageId: string;
			ownerName: string;
	  }
	| { status: "missing" };

// Tells apart "doesn't exist" and "you can't see it". The second is only told to people in that workspace.
export async function resolvePage(pageId: string): Promise<PageResolution> {
	const session = await requireViewer();
	try {
		return { status: "ok", access: await pageAccess(pageId) };
	} catch (err) {
		if (
			errorCode(err) !== 404 &&
			errorCode(err) !== 401 &&
			!(err instanceof AuthError)
		)
			throw err;
	}
	const admin = adminClient();
	let page: Page;
	try {
		page = toPage(
			await db(admin).getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: pageId,
			}),
		);
	} catch (err) {
		if (errorCode(err) === 404) return { status: "missing" };
		throw err;
	}
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		page.workspaceId,
	);
	// Only people who belong to the workspace may learn a page exists and who owns it. A guest was let
	// in to specific pages and isn't shown other members' names either, so to a guest and to anyone
	// outside, a page they can't read looks exactly like one that was never there.
	if (!role || role === "guest" || page.trashedAt) return { status: "missing" };
	return {
		status: "forbidden",
		workspaceId: page.workspaceId,
		pageId: page.id,
		ownerName: await userName(page.createdBy),
	};
}

export type Person = {
	userId: string;
	name: string;
	email: string;
	confirmed: boolean;
};

// People in a workspace, for mentions and bylines. Appwrite hides other members' names from a
// session by default, so this reads them with the site key after checking membership.
// Same access as the Members list: everyone in the workspace, except a guest, who only sees what
// Appwrite shows them. Anyone left without a name or email can't be mentioned, so they're dropped.
export async function listPeople(workspaceId: string): Promise<Person[]> {
	const members = await listMembers(workspaceId);
	return members
		.filter((m) => m.name || m.email)
		.map((m) => ({
			userId: m.userId,
			name: m.name,
			email: m.email,
			confirmed: m.confirmed,
		}));
}

export async function userName(userId: string) {
	try {
		const user = await new Users(adminClient()).get({ userId });
		return user.name || "Someone";
	} catch {
		return "Someone";
	}
}

// ---------- reading ----------

const UPDATE_PAGE = 500;

async function allUpdates(client: Client, pageId: string) {
	const rows: UpdateRow[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await db(client).listRows<UpdateRow>({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			queries: [
				Query.equal("pageId", [pageId]),
				Query.orderAsc("$createdAt"),
				Query.limit(UPDATE_PAGE),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		rows.push(...page.rows);
		if (page.rows.length < UPDATE_PAGE) break;
		cursor = page.rows[page.rows.length - 1].$id;
	}
	return rows.filter((r) => r.data);
}

export type BodyState = {
	snapshot: string | null;
	updates: { id: string; data: string }[];
};

// Updates are read first and the snapshot second. Compaction writes the snapshot and then deletes,
// so whichever way a read interleaves with it, every update is in one or the other.
export async function loadBody(pageId: string): Promise<BodyState> {
	const access = await pageAccess(pageId);
	const { client } = await requireViewer();
	const rows = (await allUpdates(client, pageId)).filter((r) =>
		isTrusted(r, access.page),
	);
	let snapshot: string | null = null;
	try {
		const body = await db(client).getRow<BodyRow>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			rowId: pageId,
		});
		snapshot = body.snapshot || null;
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
	}
	return {
		snapshot,
		updates: rows.map((r) => ({ id: r.$id, data: r.data as string })),
	};
}

// ---------- writing ----------

export async function saveUpdate(input: {
	pageId: string;
	rowId: string;
	data: string;
	clientId: string;
	cursor: string | null;
}) {
	const access = await pageAccess(input.pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	const permissions = contentPermissions(access.page);
	try {
		const row = await db(adminClient()).createRow<UpdateRow>({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			rowId: input.rowId,
			data: {
				workspaceId: access.page.workspaceId,
				pageId: input.pageId,
				data: input.data,
				clientId: input.clientId,
				cursor: input.cursor,
				createdBy: access.viewerId,
			},
			permissions,
		});
		return { id: row.$id };
	} catch (err) {
		if (errorCode(err) === 409) return { id: input.rowId };
		throw err;
	}
}

// ---------- compaction ----------

const LOCK_STALE_MS = 60_000;
const VERSION_EVERY_MS = 10 * 60_000;
const VERSIONS_KEPT = 100;

async function takeLock(pageId: string, workspaceId: string) {
	const admin = db(adminClient());
	const rowId = `lock_${rowHash("compact", pageId).slice(0, 30)}`;
	const create = () =>
		admin.createRow({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			rowId,
			data: { workspaceId, pageId, data: null },
			// No permissions: nobody but the Site key sees this row, and Realtime sends it to no one.
			permissions: [],
		});
	try {
		await create();
		return rowId;
	} catch (err) {
		if (errorCode(err) !== 409) throw err;
	}
	const held = await admin.getRow({
		databaseId: DATABASE_ID,
		tableId: UPDATES,
		rowId,
	});
	if (Date.now() - Date.parse(held.$createdAt) < LOCK_STALE_MS) return null;
	await admin.deleteRow({ databaseId: DATABASE_ID, tableId: UPDATES, rowId });
	try {
		await create();
		return rowId;
	} catch {
		return null;
	}
}

export type CompactResult =
	| { status: "busy" }
	| { status: "too_large"; bytes: number }
	| { status: "ok"; applied: number; bytes: number };

// Rows that can't be merged keep their data for this long, unreadable by anyone but the site key.
const QUARANTINE_MS = 30 * 24 * 60 * 60_000;

function decodes(row: UpdateRow) {
	try {
		Y.decodeUpdate(fromBase64(row.data as string));
		return true;
	} catch {
		return false;
	}
}

// A row compaction won't merge: written with roles that don't match the page (someone's tab hadn't
// heard about a permission change, or a person who no longer has access), or not a valid update.
// Its content may be someone's work, so it is never deleted here. Taking its permissions away stops
// it being read or sent to anyone, and after 30 days it's dropped.
async function quarantine(admin: TablesDB, rows: UpdateRow[]) {
	const now = Date.now();
	const hide = rows.filter((r) => r.$permissions.length).map((r) => r.$id);
	const expired = rows
		.filter(
			(r) =>
				!r.$permissions.length &&
				now - Date.parse(r.$updatedAt) > QUARANTINE_MS,
		)
		.map((r) => r.$id);
	for (let i = 0; i < hide.length; i += 100)
		await admin.updateRows({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			data: { $permissions: [] },
			queries: [Query.equal("$id", hide.slice(i, i + 100))],
		});
	for (let i = 0; i < expired.length; i += 100)
		await admin.deleteRows({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			queries: [Query.equal("$id", expired.slice(i, i + 100))],
		});
}

// The search text shares a request with the snapshot, so it can't take the whole limit.
const MAX_TEXT_BYTES = 1_000_000;

function searchText(text: string) {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= MAX_TEXT_BYTES) return text;
	return new TextDecoder().decode(bytes.subarray(0, MAX_TEXT_BYTES)).trimEnd();
}

// Folds a page's updates into its snapshot, with the Site key. One at a time per page (the lock), and
// only rows that were read here are deleted, so an update that lands during this keeps its row.
export async function compactPage(pageId: string): Promise<CompactResult> {
	const access = await pageAccess(pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	const lock = await takeLock(pageId, access.page.workspaceId);
	if (!lock) return { status: "busy" };
	const client = adminClient();
	const admin = db(client);
	try {
		let body: BodyRow | null = null;
		try {
			body = await admin.getRow<BodyRow>({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: pageId,
			});
		} catch (err) {
			if (errorCode(err) !== 404) throw err;
		}
		const rows = (await allUpdates(client, pageId)).filter(
			(r) => r.$id !== lock,
		);
		const trusted = rows.filter((r) => isTrusted(r, access.page) && decodes(r));
		const mergedIds = new Set(trusted.map((r) => r.$id));
		const pieces: Uint8Array[] = [];
		if (body?.snapshot) pieces.push(fromBase64(body.snapshot));
		for (const row of trusted) pieces.push(fromBase64(row.data as string));
		if (!pieces.length) {
			await quarantine(
				admin,
				rows.filter((r) => !mergedIds.has(r.$id)),
			);
			return { status: "ok", applied: 0, bytes: 0 };
		}
		const merged = Y.mergeUpdates(pieces);
		const doc = docFromUpdates([merged]);
		const facts = digest(doc.getXmlFragment(BODY_FIELD));
		const snapshot = toBase64(Y.encodeStateAsUpdate(doc));
		// Past what one request can carry: keep everything as it is and let the editors know.
		if (snapshot.length > MAX_STATE_CHARS) {
			doc.destroy();
			return { status: "too_large", bytes: snapshot.length };
		}
		const stateVector = toBase64(Y.encodeStateVector(doc));
		const snapshotAt = new Date().toISOString();
		await admin.upsertRow({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			rowId: pageId,
			data: {
				workspaceId: access.page.workspaceId,
				pageId,
				snapshot,
				stateVector,
				snapshotAt,
				text: searchText(facts.text),
			},
			permissions: contentPermissions(access.page),
		});
		// The snapshot is safely written. Only now remove exactly the rows it contains. Anything it
		// doesn't contain is kept out of the page but never destroyed.
		const ids = trusted.map((r) => r.$id);
		await quarantine(
			admin,
			rows.filter((r) => !mergedIds.has(r.$id)),
		);
		for (let i = 0; i < ids.length; i += 100)
			await admin.deleteRows({
				databaseId: DATABASE_ID,
				tableId: UPDATES,
				queries: [Query.equal("$id", ids.slice(i, i + 100))],
			});
		await syncLinks(access.page, facts.links);
		await captureVersion(access, doc, snapshot, trusted);
		doc.destroy();
		return {
			status: "ok",
			applied: trusted.length,
			bytes: snapshot.length,
		};
	} finally {
		await admin
			.deleteRow({ databaseId: DATABASE_ID, tableId: UPDATES, rowId: lock })
			.catch(() => undefined);
	}
}

async function syncLinks(page: Page, targets: string[]) {
	const admin = db(adminClient());
	const existing = await admin.listRows<Models.Row & { targetId: string }>({
		databaseId: DATABASE_ID,
		tableId: LINKS,
		queries: [Query.equal("sourceId", [page.id]), Query.limit(500)],
	});
	const have = new Set(existing.rows.map((r) => r.targetId));
	const want = new Set(targets.filter((t) => t !== page.id));
	await Promise.all([
		...[...want]
			.filter((t) => !have.has(t))
			.map((targetId) =>
				admin
					.upsertRow({
						databaseId: DATABASE_ID,
						tableId: LINKS,
						rowId: linkRowId(page.id, targetId),
						data: {
							workspaceId: page.workspaceId,
							sourceId: page.id,
							targetId,
						},
						permissions: pagePermissions(page),
					})
					.catch(() => undefined),
			),
		...existing.rows
			.filter((r) => !want.has(r.targetId))
			.map((r) =>
				admin
					.deleteRow({
						databaseId: DATABASE_ID,
						tableId: LINKS,
						rowId: r.$id,
					})
					.catch(() => undefined),
			),
	]);
}

type VersionRow = Models.Row & {
	workspaceId: string;
	pageId: string;
	snapshot: string | null;
	title: string | null;
	summary: string | null;
	kind: string;
	createdBy: string | null;
};

export type VersionSummary = { editors: string[]; next: string[] };

function parseSummary(value: string | null): VersionSummary {
	try {
		const parsed = JSON.parse(value || "");
		return {
			editors: Array.isArray(parsed.editors) ? parsed.editors : [],
			next: Array.isArray(parsed.next) ? parsed.next : [],
		};
	} catch {
		return { editors: [], next: [] };
	}
}

async function captureVersion(
	access: PageAccess,
	doc: Y.Doc,
	snapshot: string,
	trusted: UpdateRow[],
) {
	const admin = db(adminClient());
	const editorIds = [
		...new Set(trusted.map((r) => r.createdBy).filter(Boolean)),
	] as string[];
	const names = await Promise.all(
		editorIds.slice(0, 6).map((id) => userName(id)),
	);
	const { rows } = await admin.listRows<VersionRow>({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		queries: [
			Query.equal("pageId", [access.page.id]),
			Query.orderDesc("$createdAt"),
			Query.select(["$id", "$createdAt", "summary"]),
			Query.limit(1),
		],
	});
	const latest = rows[0];
	const merge = (a: string[], b: string[]) =>
		[...new Set([...a, ...b])].slice(0, 6);
	if (latest && Date.now() - Date.parse(latest.$createdAt) < VERSION_EVERY_MS) {
		if (!names.length) return;
		const summary = parseSummary(latest.summary);
		await admin.updateRow({
			databaseId: DATABASE_ID,
			tableId: VERSIONS,
			rowId: latest.$id,
			data: {
				summary: JSON.stringify({
					...summary,
					next: merge(summary.next, names),
				}),
			},
		});
		return;
	}
	if (latest && !names.length) return;
	const editors = merge(latest ? parseSummary(latest.summary).next : [], names);
	await admin.createRow({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		rowId: ID.unique(),
		data: {
			workspaceId: access.page.workspaceId,
			pageId: access.page.id,
			snapshot,
			title: titleOf(doc, access.page.title).slice(0, 512),
			summary: JSON.stringify({ editors, next: [] }),
			kind: "auto",
			createdBy: access.viewerId,
		},
		permissions: contentPermissions(access.page),
	});
	await pruneVersions(access.page.id);
}

async function pruneVersions(pageId: string) {
	const admin = db(adminClient());
	const { total, rows } = await admin.listRows<VersionRow>({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		queries: [
			Query.equal("pageId", [pageId]),
			Query.orderDesc("$createdAt"),
			Query.offset(VERSIONS_KEPT),
			Query.select(["$id"]),
			Query.limit(25),
		],
	});
	if (total <= VERSIONS_KEPT) return;
	await Promise.all(
		rows.map((r) =>
			admin
				.deleteRow({
					databaseId: DATABASE_ID,
					tableId: VERSIONS,
					rowId: r.$id,
				})
				.catch(() => undefined),
		),
	);
}

export function titleOf(doc: Y.Doc, fallback: string) {
	const fragment = doc.getXmlFragment(TITLE_FIELD);
	const text = digest(fragment).text.trim();
	return text || fallback;
}

// ---------- requests for access ----------

export async function createAccessRequest(pageId: string, note: string) {
	const session = await requireViewer();
	const admin = db(adminClient());
	// The same answer whether the page is missing or just out of reach, so this can't be used to
	// find out which page ids exist in someone else's workspace.
	const missing = () =>
		new AuthError("That page isn't available.", "forbidden");
	let page: Page;
	try {
		page = toPage(
			await admin.getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: pageId,
			}),
		);
	} catch (err) {
		if (errorCode(err) === 404) throw missing();
		throw err;
	}
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		page.workspaceId,
	);
	if (!role || role === "guest" || page.trashedAt) throw missing();
	const rowId = rowHash("access", pageId, session.viewer.userId);
	await admin.upsertRow({
		databaseId: DATABASE_ID,
		tableId: ACCESS_REQUESTS,
		rowId,
		data: {
			workspaceId: page.workspaceId,
			pageId,
			userId: session.viewer.userId,
			userName: session.viewer.name.slice(0, 128),
			note: note.slice(0, 4000) || null,
			status: "pending",
			decidedBy: null,
		},
		permissions: [
			`read("user:${session.viewer.userId}")`,
			`read("user:${page.createdBy}")`,
			`update("user:${page.createdBy}")`,
		],
	});
	await notifyUsers([page.createdBy], {
		workspaceId: page.workspaceId,
		pageId,
		kind: "access_request",
		actorId: session.viewer.userId,
		actorName: session.viewer.name,
		title: `${session.viewer.name} asked for access to ${page.title || "Untitled"}`,
		body: note.slice(0, 500),
	});
	return { requestId: rowId };
}

export async function ownAccessRequest(pageId: string) {
	const session = await requireViewer();
	const rowId = rowHash("access", pageId, session.viewer.userId);
	try {
		const row = await db(session.client).getRow<
			Models.Row & { status: string }
		>({ databaseId: DATABASE_ID, tableId: ACCESS_REQUESTS, rowId });
		return row.status;
	} catch (err) {
		if (errorCode(err) === 404) return null;
		throw err;
	}
}
