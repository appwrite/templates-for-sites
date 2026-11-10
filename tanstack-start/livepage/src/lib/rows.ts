// Maps raw Appwrite rows onto app types. Safe in the browser and on the server.
import type { Page, Share } from "./types";

export type PageRow = {
	$id: string;
	$createdAt: string;
	$updatedAt: string;
	workspaceId: string;
	parentId: string | null;
	sectionId: string | null;
	kind: Page["kind"];
	title: string | null;
	icon: string | null;
	coverFileId: string | null;
	position: number;
	databaseId: string | null;
	visibility: Page["visibility"];
	shares: string | null;
	publishedSlug: string | null;
	trashedAt: string | null;
	createdBy: string;
	updatedBy: string;
};

export function parseShares(raw: string | null): Share[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function toPage(row: PageRow): Page {
	return {
		id: row.$id,
		workspaceId: row.workspaceId,
		parentId: row.parentId || null,
		sectionId: row.sectionId || null,
		kind: row.kind,
		title: row.title || "",
		icon: row.icon || null,
		coverFileId: row.coverFileId || null,
		position: row.position,
		databaseId: row.databaseId || null,
		visibility: row.visibility,
		shares: parseShares(row.shares),
		publishedSlug: row.publishedSlug || null,
		trashedAt: row.trashedAt || null,
		createdBy: row.createdBy,
		updatedBy: row.updatedBy,
		createdAt: row.$createdAt,
		updatedAt: row.$updatedAt,
	};
}
