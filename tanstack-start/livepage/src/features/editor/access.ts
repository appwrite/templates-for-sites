// Who may do what on a page, and which update rows compaction may trust. Pure, so it can be unit-tested.
import type { Page, Role, Share } from "#/lib/types";

export type AccessLevel = "edit" | "comment" | "view";

export function levelFor(
	page: Pick<Page, "visibility" | "createdBy" | "shares">,
	userId: string,
	role: Role | null,
): AccessLevel | null {
	// Nobody outside the workspace has access, whatever the page row says.
	if (!role) return null;
	if (page.createdBy === userId) return "edit";
	if (page.visibility === "workspace" && role !== "guest") return "edit";
	const share = page.shares.find((s: Share) => s.userId === userId);
	return share ? share.level : null;
}

// A row that only a holder of the page's roles could have written. Without this, anyone signed in
// could add a row for this page (the table allows create for all users), give it permissions they
// hold, and have compaction fold it into the page.
export function isTrusted(
	row: { $permissions: string[] },
	page: Pick<Page, "visibility" | "workspaceId" | "createdBy">,
) {
	const owner = `read("user:${page.createdBy}")`;
	if (page.visibility === "workspace")
		return (
			row.$permissions.includes(`read("team:${page.workspaceId}/member")`) ||
			row.$permissions.includes(owner)
		);
	return row.$permissions.includes(owner);
}
