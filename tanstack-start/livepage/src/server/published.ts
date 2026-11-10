import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { type Models, Query, TablesDB } from "node-appwrite";
import * as Y from "yjs";
import { isTrusted } from "#/features/editor/access";
import {
	BODY_FIELD,
	digest,
	docFromUpdates,
	fromBase64,
} from "#/features/editor/codec";
import type { PmNode } from "#/features/editor/render";
import { isSetupFeatureOn } from "#/features/settings/server/features";
import { type PageRow, toPage } from "#/lib/rows";
import { adminClient, errorCode } from "./appwrite";
import { readSession } from "./auth";
import { userName } from "./body";
import { fileBelongsTo } from "./files";
import { BODIES, DATABASE_ID, PAGES, UPDATES, WORKSPACES } from "./schema";

type AppRow = Models.Row & PageRow;

export type PublishedPage = {
	status: "ok";
	slug: string;
	title: string;
	icon: string | null;
	coverFileId: string | null;
	author: string;
	updatedAt: string;
	workspaceName: string;
	content: PmNode[];
	excerpt: string;
	signedIn: boolean;
};

// Published pages are public. Only this read path runs for people who aren't signed in, and it
// returns the page's display fields and rendered blocks, never the Yjs state or anything about who has access.
export async function getPublished(
	slug: string,
): Promise<PublishedPage | { status: "missing"; signedIn: boolean }> {
	// A public page must still open if the session lookup hiccups.
	const signedIn = await readSession().then(
		(session) => session.status === "ok",
		() => false,
	);
	// Turning publishing off takes down what's already out there, not just new links.
	if (!(await isSetupFeatureOn("publish")))
		return { status: "missing", signedIn };
	const db = new TablesDB(adminClient());
	const { rows } = await db.listRows<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [Query.equal("publishedSlug", [slug]), Query.limit(1)],
	});
	const row = rows[0];
	if (!row || row.trashedAt) return { status: "missing", signedIn };
	const page = toPage(row);

	const pieces: Uint8Array[] = [];
	let updatedAt = page.updatedAt;
	try {
		const body = await db.getRow<
			Models.Row & { snapshot: string | null; snapshotAt: string | null }
		>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			rowId: page.id,
		});
		if (body.snapshot) pieces.push(fromBase64(body.snapshot));
		if (body.snapshotAt && Date.parse(body.snapshotAt) > Date.parse(updatedAt))
			updatedAt = body.snapshotAt;
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
	}
	let cursor: string | undefined;
	for (;;) {
		const batch = await db.listRows<Models.Row & { data: string | null }>({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			queries: [
				Query.equal("pageId", [page.id]),
				Query.orderAsc("$createdAt"),
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		// Anyone signed in can add a row for this page, so only rows a page member wrote count.
		for (const r of batch.rows)
			if (r.data && isTrusted(r, page)) pieces.push(fromBase64(r.data));
		if (batch.rows.length < 500) break;
		cursor = batch.rows[batch.rows.length - 1].$id;
	}
	const doc = pieces.length ? docFromUpdates(pieces) : new Y.Doc();
	const fragment = doc.getXmlFragment(BODY_FIELD);
	const content =
		(yXmlFragmentToProsemirrorJSON(fragment) as { content?: PmNode[] })
			.content ?? [];
	const excerpt = digest(fragment)
		.text.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
	doc.destroy();

	let workspaceName = "";
	try {
		const ws = await db.getRow<Models.Row & { name: string }>({
			databaseId: DATABASE_ID,
			tableId: WORKSPACES,
			rowId: page.workspaceId,
		});
		workspaceName = ws.name;
	} catch {
		// The page still renders without the workspace name.
	}

	return {
		status: "ok",
		signedIn,
		slug,
		title: page.title || "Untitled",
		icon: page.icon,
		coverFileId: page.coverFileId,
		author: await userName(page.createdBy),
		updatedAt,
		workspaceName,
		content,
		excerpt,
	};
}

// Whether a published page references this file, so /api/files can serve it without a session.
// The page naming a file isn't enough: the file must also belong to this page's workspace or its
// creator, otherwise anyone could publish a page pointing at someone else's file.
export async function publishedPageUses(slug: string, fileId: string) {
	const page = await getPublished(slug);
	if (page.status !== "ok") return false;
	if (page.coverFileId !== fileId && !nodeUsesFile(page.content, fileId))
		return false;
	const { rows } = await new TablesDB(adminClient()).listRows<AppRow>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [
			Query.equal("publishedSlug", [slug]),
			Query.select(["workspaceId", "createdBy"]),
			Query.limit(1),
		],
	});
	return rows[0] ? fileBelongsTo(fileId, rows[0]) : false;
}

function nodeUsesFile(nodes: PmNode[], fileId: string): boolean {
	return nodes.some(
		(node) =>
			((node.type === "image" || node.type === "attachment") &&
				node.attrs?.fileId === fileId) ||
			(node.content ? nodeUsesFile(node.content, fileId) : false),
	);
}
