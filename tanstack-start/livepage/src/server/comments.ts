import { ID, type Models, Query, TablesDB, Teams } from "node-appwrite";
import { contentPermissions } from "#/lib/permissions";
import { adminClient } from "./appwrite";
import { AuthError, requireViewer, requireWorkspace } from "./auth";
import { pageAccess, userName } from "./body";
import { notifyUsers } from "./notifications";
import { COMMENTS, DATABASE_ID } from "./schema";

// `from` and `to` are Yjs relative positions, JSON-encoded.
export type CommentAnchor = { from: string; to: string; quote: string };

export type Comment = {
	id: string;
	workspaceId: string;
	pageId: string;
	threadId: string;
	body: string;
	anchor: CommentAnchor | null;
	resolvedAt: string | null;
	createdBy: string;
	authorName: string;
	createdAt: string;
	mentions: string[];
	editedAt: string | null;
	// A first comment that still has replies stays as a marker, with its text gone.
	deletedAt: string | null;
};

type CommentRow = Models.Row & {
	workspaceId: string;
	pageId: string;
	threadId: string;
	body: string;
	anchor: string | null;
	resolvedAt: string | null;
	createdBy: string;
	mentions: string[] | null;
	editedAt: string | null;
	deletedAt: string | null;
};

const db = () => new TablesDB(adminClient());

function parseAnchor(value: string | null): CommentAnchor | null {
	if (!value) return null;
	try {
		return JSON.parse(value) as CommentAnchor;
	} catch {
		return null;
	}
}

async function withNames(rows: CommentRow[]): Promise<Comment[]> {
	const ids = [...new Set(rows.map((r) => r.createdBy))];
	const names = new Map(
		await Promise.all(ids.map(async (id) => [id, await userName(id)] as const)),
	);
	return rows.map((r) => ({
		id: r.$id,
		workspaceId: r.workspaceId,
		pageId: r.pageId,
		threadId: r.threadId,
		body: r.deletedAt ? "" : r.body,
		anchor: parseAnchor(r.anchor),
		resolvedAt: r.resolvedAt || null,
		createdBy: r.createdBy,
		authorName: names.get(r.createdBy) ?? "Someone",
		createdAt: r.$createdAt,
		mentions: r.deletedAt ? [] : (r.mentions ?? []),
		editedAt: r.editedAt || null,
		deletedAt: r.deletedAt || null,
	}));
}

// All comments on a page the person can read, oldest first.
export async function listComments(pageId: string): Promise<Comment[]> {
	const { client } = await requireViewer();
	const rows: CommentRow[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await new TablesDB(client).listRows<CommentRow>({
			databaseId: DATABASE_ID,
			tableId: COMMENTS,
			queries: [
				Query.equal("pageId", [pageId]),
				Query.orderAsc("$createdAt"),
				Query.limit(200),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		rows.push(...page.rows);
		if (page.rows.length < 200) break;
		cursor = page.rows[page.rows.length - 1].$id;
	}
	return withNames(rows);
}

// Recent comments across a workspace, newest first. Used by the All comments page and the Inbox.
export async function listWorkspaceComments(
	workspaceId: string,
	limit = 100,
	cursor?: string,
): Promise<Comment[]> {
	const { client } = await requireWorkspace(workspaceId);
	const { rows } = await new TablesDB(client).listRows<CommentRow>({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		queries: [
			Query.equal("workspaceId", [workspaceId]),
			Query.orderDesc("$createdAt"),
			Query.limit(Math.min(limit, 200)),
			...(cursor ? [Query.cursorAfter(cursor)] : []),
		],
	});
	return withNames(rows);
}

async function memberIds(workspaceId: string, ids: string[]) {
	if (!ids.length) return [];
	const { memberships } = await new Teams(adminClient()).listMemberships({
		teamId: workspaceId,
		queries: [Query.equal("userId", ids), Query.limit(100)],
	});
	return memberships.filter((m) => m.confirm).map((m) => m.userId);
}

export async function createComment(input: {
	pageId: string;
	threadId?: string | null;
	body: string;
	anchor?: CommentAnchor | null;
	mentions?: string[];
}): Promise<Comment> {
	const access = await pageAccess(input.pageId);
	if (!access.canComment)
		throw new AuthError("You can only view this page.", "forbidden");
	const body = input.body.trim();
	if (!body) throw new Error("Write something first.");
	const rowId = ID.unique();
	const threadId = input.threadId || rowId;
	const admin = db();
	if (input.threadId) {
		const root = await admin.getRow<CommentRow>({
			databaseId: DATABASE_ID,
			tableId: COMMENTS,
			rowId: input.threadId,
		});
		if (root.pageId !== input.pageId)
			throw new Error("That thread belongs to another page.");
	}
	const mentions = await memberIds(
		access.page.workspaceId,
		[...new Set(input.mentions ?? [])].slice(0, 20),
	);
	const row = await admin.createRow<CommentRow>({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		rowId,
		data: {
			workspaceId: access.page.workspaceId,
			pageId: input.pageId,
			threadId,
			body: body.slice(0, 20_000),
			anchor: input.anchor ? JSON.stringify(input.anchor) : null,
			resolvedAt: null,
			editedAt: null,
			deletedAt: null,
			createdBy: access.viewerId,
			mentions,
		},
		permissions: contentPermissions(access.page),
	});
	const actorName = await userName(access.viewerId);
	const pageTitle = access.page.title || "Untitled";
	await notifyUsers(mentions, {
		workspaceId: access.page.workspaceId,
		pageId: input.pageId,
		kind: "mention",
		actorId: access.viewerId,
		actorName,
		title: `${actorName} mentioned you on ${pageTitle}`,
		body: body.slice(0, 500),
	});
	if (input.threadId) {
		const earlier = await admin.listRows<CommentRow>({
			databaseId: DATABASE_ID,
			tableId: COMMENTS,
			queries: [
				Query.equal("threadId", [threadId]),
				Query.limit(100),
				Query.select(["createdBy"]),
			],
		});
		const others = earlier.rows
			.map((r) => r.createdBy)
			.filter((id) => !mentions.includes(id));
		await notifyUsers(others, {
			workspaceId: access.page.workspaceId,
			pageId: input.pageId,
			kind: "comment",
			actorId: access.viewerId,
			actorName,
			title: `${actorName} replied on ${pageTitle}`,
			body: body.slice(0, 500),
		});
	}
	const [created] = await withNames([row]);
	return created;
}

export async function setThreadResolved(
	pageId: string,
	threadId: string,
	resolved: boolean,
) {
	const access = await pageAccess(pageId);
	if (!access.canComment)
		throw new AuthError("You can only view this page.", "forbidden");
	const admin = db();
	const root = await admin.getRow<CommentRow>({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		rowId: threadId,
	});
	if (root.pageId !== pageId)
		throw new Error("That thread belongs to another page.");
	await admin.updateRow({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		rowId: threadId,
		data: { resolvedAt: resolved ? new Date().toISOString() : null },
	});
}

function getComment(commentId: string) {
	return db().getRow<CommentRow>({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		rowId: commentId,
	});
}

// Only the author can change what a comment says. People newly mentioned are told; people already
// mentioned aren't told twice.
export async function updateComment(input: {
	commentId: string;
	body: string;
	mentions?: string[];
}): Promise<Comment> {
	const row = await getComment(input.commentId);
	if (row.deletedAt) throw new Error("That comment was deleted.");
	const access = await pageAccess(row.pageId);
	if (row.createdBy !== access.viewerId)
		throw new AuthError("You can only edit your own comments.", "forbidden");
	if (!access.canComment)
		throw new AuthError("You can only view this page.", "forbidden");
	const body = input.body.trim();
	if (!body) throw new Error("Write something first.");
	const mentions = await memberIds(
		row.workspaceId,
		[...new Set(input.mentions ?? [])].slice(0, 20),
	);
	const before = new Set(row.mentions ?? []);
	const updated = await db().updateRow<CommentRow>({
		databaseId: DATABASE_ID,
		tableId: COMMENTS,
		rowId: row.$id,
		data: {
			body: body.slice(0, 20_000),
			mentions,
			editedAt: new Date().toISOString(),
		},
	});
	const actorName = await userName(access.viewerId);
	await notifyUsers(
		mentions.filter((id) => !before.has(id)),
		{
			workspaceId: row.workspaceId,
			pageId: row.pageId,
			kind: "mention",
			actorId: access.viewerId,
			actorName,
			title: `${actorName} mentioned you on ${access.page.title || "Untitled"}`,
			body: body.slice(0, 500),
		},
	);
	const [mapped] = await withNames([updated]);
	return mapped;
}

// The author can delete their own comment; workspace owners and admins can delete anyone's. A first
// comment with replies keeps its place as a marker so the replies still have a thread; once the last
// reply goes, the marker goes with it.
export async function deleteComment(commentId: string) {
	const row = await getComment(commentId);
	const { role, viewer } = await requireWorkspace(row.workspaceId);
	if (role !== "owner" && role !== "admin") {
		if (row.createdBy !== viewer.userId)
			throw new AuthError(
				"You can only delete your own comments.",
				"forbidden",
			);
		const access = await pageAccess(row.pageId);
		if (!access.canComment)
			throw new AuthError("You can only view this page.", "forbidden");
	}
	const admin = db();
	const thread = (
		await admin.listRows<CommentRow>({
			databaseId: DATABASE_ID,
			tableId: COMMENTS,
			queries: [Query.equal("threadId", [row.threadId]), Query.limit(500)],
		})
	).rows;
	const replies = thread.filter(
		(r) => r.$id !== row.threadId && r.$id !== row.$id,
	);
	const remove = (rowId: string) =>
		admin.deleteRow({ databaseId: DATABASE_ID, tableId: COMMENTS, rowId });
	if (row.$id === row.threadId) {
		if (replies.length) {
			await admin.updateRow({
				databaseId: DATABASE_ID,
				tableId: COMMENTS,
				rowId: row.$id,
				data: { body: "", mentions: [], deletedAt: new Date().toISOString() },
			});
		} else await remove(row.$id);
		return;
	}
	await remove(row.$id);
	const root = thread.find((r) => r.$id === row.threadId);
	if (root?.deletedAt && !replies.length) await remove(root.$id);
}

// A block that gets replaced (turned into another type, moved) has new Yjs items, so its comments get
// new anchors at the same place in the text.
export async function moveCommentAnchors(
	pageId: string,
	moves: { commentId: string; anchor: CommentAnchor }[],
) {
	const access = await pageAccess(pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	const admin = db();
	await Promise.all(
		moves.slice(0, 100).map(async ({ commentId, anchor }) => {
			const row = await getComment(commentId);
			if (row.pageId !== pageId) return;
			await admin.updateRow({
				databaseId: DATABASE_ID,
				tableId: COMMENTS,
				rowId: commentId,
				data: {
					anchor: JSON.stringify({
						from: anchor.from,
						to: anchor.to,
						quote: anchor.quote.slice(0, 2000),
					}),
				},
			});
		}),
	);
}

export async function notifyMention(pageId: string, userId: string) {
	const access = await pageAccess(pageId);
	if (!access.canEdit) return;
	const [member] = await memberIds(access.page.workspaceId, [userId]);
	if (!member) return;
	const actorName = await userName(access.viewerId);
	await notifyUsers([member], {
		workspaceId: access.page.workspaceId,
		pageId,
		kind: "mention",
		actorId: access.viewerId,
		actorName,
		title: `${actorName} mentioned you on ${access.page.title || "Untitled"}`,
	});
}
