// Home, Inbox, favorites and recents: all read with the person's own client.
import { type Client, type Models, Query, TablesDB } from "node-appwrite";
import { favoriteRowId, visitRowId } from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import { adminClient, errorCode } from "#/server/appwrite";
import {
	AuthError,
	requireViewer,
	requireWorkspace,
	workspaceRole,
} from "#/server/auth";
import { listMembers } from "#/server/members";
import {
	DATABASE_ID,
	FAVORITES,
	NOTIFICATIONS,
	PAGES,
	VISITS,
} from "#/server/schema";

type AppRow = Models.Row & PageRow;
type VisitRow = Models.Row & { pageId: string; visitedAt: string };
type FavoriteRow = Models.Row & { pageId: string; position: number };

export type Notification = {
	id: string;
	workspaceId: string;
	pageId: string | null;
	kind: string;
	actorId: string | null;
	actorName: string;
	title: string;
	body: string;
	readAt: string | null;
	createdAt: string;
};

type NotificationRow = Models.Row & {
	workspaceId: string;
	pageId: string | null;
	kind: string;
	actorId: string | null;
	actorName: string | null;
	title: string | null;
	body: string | null;
	readAt: string | null;
};

export function toNotification(r: NotificationRow): Notification {
	return {
		id: r.$id,
		workspaceId: r.workspaceId,
		pageId: r.pageId || null,
		kind: r.kind,
		actorId: r.actorId || null,
		actorName: r.actorName || "Someone",
		title: r.title || "",
		body: r.body || "",
		readAt: r.readAt || null,
		createdAt: r.$createdAt,
	};
}

const db = (client: Client) => new TablesDB(client);

export async function pagesByIds(client: Client, ids: string[]) {
	const out = new Map<string, Page>();
	const unique = [...new Set(ids)].filter(Boolean);
	for (let i = 0; i < unique.length; i += 100) {
		const { rows } = await db(client).listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [Query.equal("$id", unique.slice(i, i + 100)), Query.limit(100)],
		});
		for (const row of rows) out.set(row.$id, toPage(row));
	}
	return out;
}

export async function listNotifications(
	client: Client,
	userId: string,
	limit = 100,
	workspaceId?: string,
) {
	const { rows } = await db(client).listRows<NotificationRow>({
		databaseId: DATABASE_ID,
		tableId: NOTIFICATIONS,
		queries: [
			Query.equal("userId", [userId]),
			...(workspaceId ? [Query.equal("workspaceId", [workspaceId])] : []),
			Query.orderDesc("$createdAt"),
			Query.limit(limit),
		],
	});
	return rows.map(toNotification);
}

// Favorites, recents and unread counts, for the sidebar and the workspace switcher.
export async function loadExtras(workspaceId: string) {
	const { client, viewer } = await requireWorkspace(workspaceId);
	const [favorites, visits, unreadRows] = await Promise.all([
		db(client).listRows<FavoriteRow>({
			databaseId: DATABASE_ID,
			tableId: FAVORITES,
			queries: [
				Query.equal("userId", [viewer.userId]),
				Query.equal("workspaceId", [workspaceId]),
				Query.orderAsc("position"),
				Query.limit(100),
			],
		}),
		db(client).listRows<VisitRow>({
			databaseId: DATABASE_ID,
			tableId: VISITS,
			queries: [
				Query.equal("userId", [viewer.userId]),
				Query.equal("workspaceId", [workspaceId]),
				Query.orderDesc("visitedAt"),
				Query.limit(30),
			],
		}),
		db(client).listRows<NotificationRow>({
			databaseId: DATABASE_ID,
			tableId: NOTIFICATIONS,
			queries: [
				Query.equal("userId", [viewer.userId]),
				Query.isNull("readAt"),
				Query.select(["$id", "workspaceId"]),
				Query.limit(500),
			],
		}),
	]);
	const unreadByWorkspace: Record<string, number> = {};
	for (const row of unreadRows.rows)
		unreadByWorkspace[row.workspaceId] =
			(unreadByWorkspace[row.workspaceId] ?? 0) + 1;
	return {
		favorites: favorites.rows.map((r) => r.pageId),
		recents: visits.rows.map((r) => ({
			pageId: r.pageId,
			visitedAt: r.visitedAt,
		})),
		unread: unreadByWorkspace,
	};
}

// Marks a person's notifications read. Their row has update for that user, written by the site.
export async function markRead(ids: string[]) {
	const { client, viewer } = await requireViewer();
	const when = new Date().toISOString();
	await Promise.all(
		ids.slice(0, 100).map((rowId) =>
			db(client)
				.updateRow({
					databaseId: DATABASE_ID,
					tableId: NOTIFICATIONS,
					rowId,
					data: { readAt: when },
				})
				.catch((err) => {
					if (errorCode(err) !== 404 && errorCode(err) !== 401) throw err;
				}),
		),
	);
	return { ok: true, userId: viewer.userId };
}

export async function markAllRead(workspaceId: string) {
	const { client, viewer } = await requireWorkspace(workspaceId);
	const { rows } = await db(client).listRows<NotificationRow>({
		databaseId: DATABASE_ID,
		tableId: NOTIFICATIONS,
		queries: [
			Query.equal("userId", [viewer.userId]),
			Query.equal("workspaceId", [workspaceId]),
			Query.isNull("readAt"),
			Query.select(["$id"]),
			Query.limit(500),
		],
	});
	return markRead(rows.map((r) => r.$id));
}

export type HomeData = {
	recents: { page: Page; visitedAt: string }[];
	waiting: Notification[];
	members: Record<string, string>;
};

export async function loadHome(workspaceId: string): Promise<HomeData> {
	const { client, viewer } = await requireWorkspace(workspaceId);
	const [{ rows: visits }, notifications, people] = await Promise.all([
		db(client).listRows<VisitRow>({
			databaseId: DATABASE_ID,
			tableId: VISITS,
			queries: [
				Query.equal("userId", [viewer.userId]),
				Query.equal("workspaceId", [workspaceId]),
				Query.orderDesc("visitedAt"),
				Query.limit(12),
			],
		}),
		listNotifications(client, viewer.userId, 30, workspaceId),
		listMembers(workspaceId),
	]);
	const pages = await pagesByIds(
		client,
		visits.map((v) => v.pageId),
	);
	return {
		recents: visits
			.map((v) => ({ page: pages.get(v.pageId), visitedAt: v.visitedAt }))
			.filter((r): r is { page: Page; visitedAt: string } =>
				Boolean(r.page && !r.page.trashedAt),
			)
			.slice(0, 6),
		waiting: notifications
			.filter((n) => !n.readAt && ASKS.has(n.kind))
			.slice(0, 5),
		members: Object.fromEntries(people.map((m) => [m.userId, m.name])),
	};
}

const ASKS = new Set(["mention", "reply", "assign", "access_request"]);

export async function loadMapLinks(workspaceId: string) {
	const { client } = await requireWorkspace(workspaceId);
	const out: { sourceId: string; targetId: string }[] = [];
	let cursor: string | undefined;
	for (;;) {
		const { rows } = await db(client).listRows<
			Models.Row & { sourceId: string; targetId: string }
		>({
			databaseId: DATABASE_ID,
			tableId: "links",
			queries: [
				Query.equal("workspaceId", [workspaceId]),
				Query.select(["$id", "sourceId", "targetId"]),
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		out.push(
			...rows.map((r) => ({ sourceId: r.sourceId, targetId: r.targetId })),
		);
		if (rows.length < 500) break;
		cursor = rows[rows.length - 1].$id;
	}
	return out;
}

// ---------- favorites and visits ----------
//
// These rows only ever belong to the signed-in person, and they're written by the site so nobody
// can plant one in someone else's Recents or Favorites. The page must exist in this workspace and
// be readable by the person.

async function requireOwnPage(pageId: string) {
	const session = await requireViewer();
	const page = await new TablesDB(session.client).getRow<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		rowId: pageId,
	});
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		page.workspaceId,
	);
	if (!role)
		throw new AuthError("You don't have access to this page.", "forbidden");
	return { ...session, page };
}

const ownRow = (userId: string) => [`read("user:${userId}")`];

export async function recordVisit(pageId: string) {
	const { viewer, page } = await requireOwnPage(pageId);
	await db(adminClient()).upsertRow({
		databaseId: DATABASE_ID,
		tableId: VISITS,
		rowId: visitRowId(viewer.userId, pageId),
		data: {
			userId: viewer.userId,
			workspaceId: page.workspaceId,
			pageId,
			visitedAt: new Date().toISOString(),
		},
		permissions: ownRow(viewer.userId),
	});
}

export async function setFavorite(pageId: string, favorite: boolean) {
	const { viewer, page } = await requireOwnPage(pageId);
	const admin = db(adminClient());
	const rowId = favoriteRowId(viewer.userId, pageId);
	if (!favorite) {
		await admin
			.deleteRow({ databaseId: DATABASE_ID, tableId: FAVORITES, rowId })
			.catch((err) => {
				if (errorCode(err) !== 404) throw err;
			});
		return;
	}
	await admin.upsertRow({
		databaseId: DATABASE_ID,
		tableId: FAVORITES,
		rowId,
		data: {
			userId: viewer.userId,
			workspaceId: page.workspaceId,
			pageId,
			position: Date.now() / 1000,
		},
		permissions: ownRow(viewer.userId),
	});
}

export { adminClient };
