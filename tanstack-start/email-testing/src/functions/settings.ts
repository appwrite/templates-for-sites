import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readAgentSetup } from "#/server/agents";
import { inboxDomain, siteOrigin } from "#/server/appwrite";
import { AuthError, requireAdmin, requireMember } from "#/server/auth";
import { emptyInbox } from "#/server/messages";
import { mcpUrl } from "#/server/oauth";
import {
	getRetention,
	inviteMember,
	listMembers,
	permissionRows,
	removeMember,
	setMemberRole,
	setRetention,
} from "#/server/team";
import { createToken, listTokens, revokeToken } from "#/server/tokens";

async function guard<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof AuthError && err.reason === "signed-out")
			throw redirect({ to: "/login" });
		throw err;
	}
}

export const fetchSettings = createServerFn({ method: "GET" }).handler(() =>
	guard(async () => {
		const { viewer, client } = await requireMember();
		const [members, retentionDays, agents] = await Promise.all([
			listMembers(client, viewer),
			getRetention(),
			readAgentSetup(client).catch(() => null),
		]);
		return {
			members,
			retentionDays,
			agents,
			mcpUrl: agents?.mcpUrl || mcpUrl(),
			permissions: permissionRows(),
			domain: inboxDomain(),
			role: viewer.role,
		};
	}),
);

export const saveRetention = createServerFn({ method: "POST" })
	.validator((data: { days: number }) => data)
	.handler(({ data }) =>
		guard(async () => {
			await requireAdmin();
			await setRetention(Number(data.days));
			return { ok: true };
		}),
	);

export const sendInvite = createServerFn({ method: "POST" })
	.validator(
		(data: { email: string; name: string; role: "admin" | "member" }) => data,
	)
	.handler(({ data }) =>
		guard(async () => {
			const { client } = await requireAdmin();
			await inviteMember(client, data);
			return { ok: true };
		}),
	);

export const changeRole = createServerFn({ method: "POST" })
	.validator((data: { membershipId: string; role: "admin" | "member" }) => data)
	.handler(({ data }) =>
		guard(async () => {
			const { client, viewer } = await requireAdmin();
			if (data.membershipId === viewer.membershipId)
				throw new Error("You can't change your own role.");
			await setMemberRole(client, data.membershipId, data.role);
			return { ok: true };
		}),
	);

export const dropMember = createServerFn({ method: "POST" })
	.validator((data: { membershipId: string }) => data)
	.handler(({ data }) =>
		guard(async () => {
			const { client, viewer } = await requireAdmin();
			await removeMember(client, viewer, data.membershipId);
			return { ok: true };
		}),
	);

export const clearInbox = createServerFn({ method: "POST" }).handler(() =>
	guard(async () => {
		await requireAdmin();
		return { removed: await emptyInbox() };
	}),
);

export const fetchTokens = createServerFn({ method: "GET" }).handler(() =>
	guard(async () => {
		const { viewer } = await requireMember();
		return {
			tokens: await listTokens(viewer),
			origin: siteOrigin(),
			domain: inboxDomain(),
			role: viewer.role,
		};
	}),
);

export const addToken = createServerFn({ method: "POST" })
	.validator((data: { name: string }) => data)
	.handler(({ data }) =>
		guard(async () => {
			const { viewer } = await requireMember();
			return createToken(viewer, String(data.name || ""));
		}),
	);

export const deleteToken = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(({ data }) =>
		guard(async () => {
			const { viewer } = await requireMember();
			await revokeToken(viewer, data.id);
			return { ok: true };
		}),
	);
