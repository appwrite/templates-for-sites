import { ID, type Models, Query, TablesDB } from "node-appwrite";
import { contentPermissions } from "#/lib/permissions";
import { adminClient } from "./appwrite";
import { AuthError, requireViewer } from "./auth";
import { pageAccess, userName } from "./body";
import { DATABASE_ID, VERSIONS } from "./schema";

export type VersionMeta = {
	id: string;
	title: string;
	createdAt: string;
	editors: string[];
	kind: "auto" | "manual" | "restored";
};

export type Version = VersionMeta & { snapshot: string };

type VersionRow = Models.Row & {
	pageId: string;
	snapshot?: string | null;
	title: string | null;
	summary: string | null;
	kind: VersionMeta["kind"];
};

function meta(row: VersionRow): VersionMeta {
	let editors: string[] = [];
	try {
		const parsed = JSON.parse(row.summary || "");
		if (Array.isArray(parsed.editors)) editors = parsed.editors;
	} catch {
		// An old or empty summary shows no names.
	}
	return {
		id: row.$id,
		title: row.title || "",
		createdAt: row.$createdAt,
		editors,
		kind: row.kind,
	};
}

export async function listVersions(pageId: string): Promise<VersionMeta[]> {
	const { client } = await requireViewer();
	const { rows } = await new TablesDB(client).listRows<VersionRow>({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		queries: [
			Query.equal("pageId", [pageId]),
			Query.orderDesc("$createdAt"),
			Query.select(["$id", "$createdAt", "pageId", "title", "summary", "kind"]),
			Query.limit(100),
		],
	});
	return rows.map(meta);
}

export async function getVersion(versionId: string): Promise<Version> {
	const { client } = await requireViewer();
	const row = await new TablesDB(client).getRow<VersionRow>({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		rowId: versionId,
	});
	return { ...meta(row), snapshot: row.snapshot || "" };
}

// Records that a restore happened. The restore itself is an ordinary edit made in the browser.
export async function recordRestored(input: {
	pageId: string;
	snapshot: string;
	title: string;
}) {
	const access = await pageAccess(input.pageId);
	if (!access.canEdit)
		throw new AuthError("You can only view this page.", "forbidden");
	const name = await userName(access.viewerId);
	await new TablesDB(adminClient()).createRow({
		databaseId: DATABASE_ID,
		tableId: VERSIONS,
		rowId: ID.unique(),
		data: {
			workspaceId: access.page.workspaceId,
			pageId: input.pageId,
			snapshot: input.snapshot,
			title: input.title.slice(0, 512),
			summary: JSON.stringify({ editors: [name], next: [] }),
			kind: "restored",
			createdBy: access.viewerId,
		},
		permissions: contentPermissions(access.page),
	});
}
