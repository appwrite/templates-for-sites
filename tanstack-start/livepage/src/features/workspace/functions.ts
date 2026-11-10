// Server functions for Home, Inbox, favorites, Share and templates.
import { createServerFn } from "@tanstack/react-start";
import { Query, Teams } from "node-appwrite";
import { isSetupFeatureOn } from "#/features/settings/server/features";
import type { Share, Visibility } from "#/lib/types";
import { adminClient } from "#/server/appwrite";
import { requireViewer, requireWorkspace } from "#/server/auth";
import { trustedOrigin } from "#/server/settings";
import {
	type AccessJob,
	advanceAccessJob,
	canManageSharing,
	changeShares,
	changeVisibility,
	decideAccessRequest,
	listAccessRequests,
	loadManagedPage,
	setPublished,
} from "./server/access";
import {
	listNotifications,
	loadExtras,
	loadHome,
	loadMapLinks,
	markAllRead,
	markRead,
	recordVisit,
	setFavorite,
} from "./server/activity";
import { createFromTemplate } from "./server/templates";

export const fetchExtras = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => loadExtras(data.workspaceId));

export const fetchHome = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => loadHome(data.workspaceId));

export const fetchNotifications = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(async ({ data }) => {
		const { client, viewer } = await requireWorkspace(data.workspaceId);
		return listNotifications(client, viewer.userId, 150, data.workspaceId);
	});

export const submitRead = createServerFn({ method: "POST" })
	.validator((d: { ids: string[] }) => d)
	.handler(({ data }) => markRead(data.ids));

export const submitAllRead = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => markAllRead(data.workspaceId));

export const submitVisit = createServerFn({ method: "POST" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => recordVisit(data.pageId));

export const submitFavorite = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; favorite: boolean }) => d)
	.handler(({ data }) => setFavorite(data.pageId, data.favorite));

export const fetchMapLinks = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => loadMapLinks(data.workspaceId));

// Member counts for the workspace switcher: "12 members, 4 here now".
export const fetchWorkspaceCounts = createServerFn({ method: "GET" }).handler(
	async () => {
		const { client } = await requireViewer();
		const { teams } = await new Teams(client).list({
			queries: [Query.limit(100)],
		});
		return Object.fromEntries(teams.map((t) => [t.$id, t.total]));
	},
);

// ---------- Share ----------

export const fetchShareState = createServerFn({ method: "GET" })
	.validator((d: { pageId: string }) => d)
	.handler(async ({ data }) => {
		const { client, page, viewer, role } = await loadManagedPage(data.pageId);
		// With the site key, so names and emails show whatever the project's privacy settings are.
		// Guests are only in for single pages and don't get the whole member list that way.
		const reader =
			role === "owner" || role === "admin" || role === "member"
				? adminClient()
				: client;
		const { memberships } = await new Teams(reader).listMemberships({
			teamId: page.workspaceId,
			queries: [Query.limit(1000)],
		});
		const canManage = canManageSharing(role, page, viewer.userId);
		return {
			page,
			role,
			viewerId: viewer.userId,
			canManage,
			publishEnabled: await isSetupFeatureOn("publish"),
			// Appwrite only lets a team's owner send invites from a session.
			canInviteGuests: role === "owner" && (await isSetupFeatureOn("guests")),
			members: memberships.map((m) => ({
				userId: m.userId,
				name: m.userName,
				email: m.userEmail,
				guest: !m.roles.includes("member"),
				confirmed: m.confirm,
			})),
			requests: canManage ? await listAccessRequests(page.id) : [],
		};
	});

export const submitAccessStep = createServerFn({ method: "POST" })
	.validator((d: { job: AccessJob }) => d)
	.handler(({ data }) => advanceAccessJob(data.job));

export const submitVisibility = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; visibility: Visibility }) => d)
	.handler(({ data }) => changeVisibility(data.pageId, data.visibility));

export const submitShares = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; shares: Share[] }) => d)
	.handler(({ data }) => changeShares(data.pageId, data.shares));

// Adds someone by email who isn't in the workspace yet: they become a guest, and the page is shared
// with them through the invite that Appwrite emails. The membership carries the user id right away.
export const submitInviteAndShare = createServerFn({ method: "POST" })
	.validator(
		(d: {
			pageId: string;
			email: string;
			level: Share["level"];
			acceptUrl: string;
		}) => d,
	)
	.handler(async ({ data }) => {
		const { client, page, viewer, role } = await loadManagedPage(data.pageId);
		if (!canManageSharing(role, page, viewer.userId))
			throw new Error("You can't change who has access to this page.");
		if (!(await isSetupFeatureOn("guests")))
			throw new Error("Guests are turned off. Turn them on in Settings.");
		const membership = await new Teams(client).createMembership({
			teamId: page.workspaceId,
			email: data.email.trim().toLowerCase(),
			roles: ["guest"],
			url: `${await trustedOrigin()}/accept`,
		});
		const shares = [
			...page.shares.filter((s) => s.userId !== membership.userId),
			{ userId: membership.userId, level: data.level },
		];
		return changeShares(page.id, shares);
	});

export const submitPublish = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; published: boolean; slug?: string }) => d)
	.handler(async ({ data }) => {
		if (data.published && !(await isSetupFeatureOn("publish")))
			throw new Error("Publishing is turned off. Turn it on in Settings.");
		return setPublished(data.pageId, data.published, data.slug);
	});

export const submitDecideRequest = createServerFn({ method: "POST" })
	.validator(
		(d: { requestId: string; approve: boolean; level: Share["level"] }) => d,
	)
	.handler(({ data }) =>
		decideAccessRequest(data.requestId, data.approve, data.level),
	);

// ---------- templates ----------

export const submitCreateFromTemplate = createServerFn({ method: "POST" })
	.validator(
		(d: {
			workspaceId: string;
			templateId: string;
			sectionId?: string | null;
			position?: number;
		}) => d,
	)
	.handler(({ data }) => createFromTemplate(data));

// The site's capabilities the shell needs to show or hide things.
