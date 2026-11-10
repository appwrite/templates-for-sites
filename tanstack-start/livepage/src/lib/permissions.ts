// How page access turns into Appwrite row permissions. Used by the server and by direct browser writes.
//
// Row permissions only ever grant reading, except on the two tables the browser writes while
// editing: `updates` (append-only) and `cells` (see cellPermissions). Everything that decides access
// (createdBy, shares, visibility, publishedSlug, workspaceId) lives in rows nobody but the Site can
// write, so a JWT can never change it. A person can only write permissions for roles they hold
// themselves, which is why `canWriteDirect` exists.

import type { Page, Role, Share, Visibility } from "./types";

type PageAccess = {
	workspaceId: string;
	visibility: Visibility;
	createdBy: string;
	shares?: Share[];
};

const member = (workspaceId: string) => `team:${workspaceId}/member`;
const fmt = (action: string, role: string) => `${action}("${role}")`;

export function shareReaders(shares: Share[] = []) {
	return shares.map((s) => fmt("read", `user:${s.userId}`));
}

function ownerRole({ workspaceId, visibility, createdBy }: PageAccess) {
	return visibility === "workspace" ? member(workspaceId) : `user:${createdBy}`;
}

// Permissions for a `pages` row, and every row that belongs to a page and that only the Site writes
// (bodies, history, properties, views, comments, links): read only, for whoever can open the page.
export function pagePermissions(page: PageAccess): string[] {
	return [fmt("read", ownerRole(page)), ...shareReaders(page.shares)];
}

export const contentPermissions = pagePermissions;

// `cells` rows change in place, so unlike every other table their writers also hold update.
export function cellPermissions(page: PageAccess): string[] {
	const shares = page.shares ?? [];
	return [
		...pagePermissions(page),
		fmt("update", ownerRole(page)),
		...shares
			.filter((s) => s.level === "edit")
			.map((s) => fmt("update", `user:${s.userId}`)),
	];
}

// Whether the browser may write this page's child rows directly with its JWT.
// Every permission on the row must be one this person holds.
export function canWriteDirect(
	page: PageAccess,
	viewer: { userId: string; role: Role },
) {
	if (viewer.role === "guest") return false;
	if (page.shares?.length) return false;
	if (page.visibility === "workspace") return true;
	return page.createdBy === viewer.userId;
}

// Deterministic row ids, so upserts from two people land on the same row.
function cyrb53(input: string, seed: number) {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (
		(h2 >>> 0).toString(16).padStart(8, "0") +
		(h1 >>> 0).toString(16).padStart(8, "0")
	);
}

export function rowHash(...parts: string[]) {
	const value = parts.join("\u0000");
	return `${cyrb53(value, 1)}${cyrb53(value, 2)}`.slice(0, 32);
}

export const cellRowId = (pageId: string, propertyId: string) =>
	rowHash("cell", pageId, propertyId);
export const linkRowId = (sourceId: string, targetId: string) =>
	rowHash("link", sourceId, targetId);
export const favoriteRowId = (userId: string, pageId: string) =>
	rowHash("fav", userId, pageId);
export const visitRowId = (userId: string, pageId: string) =>
	rowHash("visit", userId, pageId);

export function displayName(page: Page | { title: string }) {
	return page.title.trim() || "Untitled";
}
