// Server functions for every Settings panel.
import { createServerFn } from "@tanstack/react-start";
import { type Models, Query, Teams, Users } from "node-appwrite";
import {
	deleteAccount,
	listDevices,
	loadProfile,
	removeAvatar,
	removeIconFile,
	saveAvatar,
	saveEmail,
	saveName,
	savePassword,
	saveWorkspaceIcon,
	signOutDevice,
	signOutEverywhereElse,
	workspaceAvatars,
	workspaceIconFileId,
} from "#/features/settings/server/account";
import type { FeatureFlags } from "#/features/settings/server/features";
import {
	agentsState,
	disableVectors,
	enableAgents,
	enableVectors,
	loadFeatures,
	updateFlag,
	updateSignup,
} from "#/features/settings/server/features";
import {
	deleteWorkspaceStep,
	exportBatch,
	exportDatabase,
	type ImportItem,
	importBatch,
} from "#/features/settings/server/transfer";
import {
	deletePageForever,
	loadTrash,
	type PurgeState,
	restorePage,
} from "#/features/settings/server/trash";
import type { Member, Role, Section } from "#/lib/types";
import { adminClient } from "#/server/appwrite";
import { requireWorkspace } from "#/server/auth";
import {
	inviteMember,
	leaveWorkspace,
	listMembers,
	removeMember,
	resendInvite,
	transferOwnership,
	updateMemberRole,
} from "#/server/members";
import { disconnectAgent, listConnectedAgents, mcpUrl } from "#/server/oauth";
import { readSettings } from "#/server/settings";
import { updateWorkspace } from "#/server/workspaces";

export type { ConnectedAgent } from "#/server/oauth";

// ---------- general ----------

export const submitGeneral = createServerFn({ method: "POST" })
	.validator(
		(d: {
			workspaceId: string;
			name?: string;
			icon?: string | null;
			sections?: Section[];
		}) => d,
	)
	.handler(async ({ data: { workspaceId, ...patch } }) => {
		const previous =
			patch.icon === null ? await workspaceIconFileId(workspaceId) : null;
		const updated = await updateWorkspace(workspaceId, patch);
		if (previous) await removeIconFile(workspaceId, previous);
		return updated;
	});

export const submitWorkspaceIcon = createServerFn({ method: "POST" })
	.validator((d: FormData) => d)
	.handler(async ({ data }) => {
		const file = data.get("file");
		const workspaceId = data.get("workspaceId");
		if (!(file instanceof File) || typeof workspaceId !== "string")
			throw new Error("There's no file to upload.");
		const icon = await saveWorkspaceIcon(workspaceId, file);
		return updateWorkspace(workspaceId, { icon });
	});

export const submitDeleteWorkspaceStep = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; cursor?: string }) => d)
	.handler(({ data }) => deleteWorkspaceStep(data.workspaceId, data.cursor));

// ---------- members ----------

export type MemberRow = Member & { accessedAt: string | null };

export const fetchMembers = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(async ({ data }): Promise<MemberRow[]> => {
		const members = await listMembers(data.workspaceId);
		const users = new Users(adminClient());
		const accessed = new Map<string, string>();
		const ids = members.map((m) => m.userId);
		for (let i = 0; i < ids.length; i += 100) {
			const { users: batch } = await users
				.list({
					queries: [
						Query.equal("$id", ids.slice(i, i + 100)),
						Query.limit(100),
					],
				})
				.catch(() => ({ users: [] as Models.User<Models.Preferences>[] }));
			for (const user of batch) accessed.set(user.$id, user.accessedAt);
		}
		return members.map((m) => ({
			...m,
			accessedAt: accessed.get(m.userId) || null,
		}));
	});

export const submitInvite = createServerFn({ method: "POST" })
	.validator(
		(d: {
			workspaceId: string;
			email: string;
			role: Role;
			acceptUrl: string;
		}) => d,
	)
	.handler(({ data }) => inviteMember(data.workspaceId, data.email, data.role));

export const submitResendInvite = createServerFn({ method: "POST" })
	.validator(
		(d: { workspaceId: string; membershipId: string; acceptUrl: string }) => d,
	)
	.handler(({ data }) => resendInvite(data.workspaceId, data.membershipId));

export const submitMemberRole = createServerFn({ method: "POST" })
	.validator(
		(d: { workspaceId: string; membershipId: string; role: Role }) => d,
	)
	.handler(({ data }) =>
		updateMemberRole(data.workspaceId, data.membershipId, data.role),
	);

export const submitRemoveMember = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; membershipId: string }) => d)
	.handler(({ data }) => removeMember(data.workspaceId, data.membershipId));

export const submitTransferOwnership = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; membershipId: string }) => d)
	.handler(({ data }) =>
		transferOwnership(data.workspaceId, data.membershipId),
	);

export const submitLeaveWorkspace = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => leaveWorkspace(data.workspaceId));

export const fetchAvatars = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => workspaceAvatars(data.workspaceId));

// ---------- features ----------

export const fetchFeatures = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => loadFeatures(data.workspaceId));

export const submitFlag = createServerFn({ method: "POST" })
	.validator((d: { name: keyof FeatureFlags; value: boolean }) => d)
	.handler(({ data }) => updateFlag(data.name, data.value));

export const submitSignup = createServerFn({ method: "POST" })
	.validator((d: { signup: "invite" | "open" }) => d)
	.handler(({ data }) => updateSignup(data.signup));

export const submitEnableVectors = createServerFn({ method: "POST" })
	.validator((d: { specification: string | null }) => d)
	.handler(({ data }) => enableVectors(data.specification));

export const submitDisableVectors = createServerFn({ method: "POST" }).handler(
	() => disableVectors(),
);

export const submitEnableAgents = createServerFn({ method: "POST" }).handler(
	() => enableAgents(),
);

// ---------- agents ----------

export const fetchAgents = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(async ({ data }) => {
		const { client, viewer, role } = await requireWorkspace(data.workspaceId);
		const state = await agentsState(await readSettings());
		const { memberships } = await new Teams(client).listMemberships({
			teamId: data.workspaceId,
			queries: [Query.limit(1000)],
		});
		const manager = role === "owner" || role === "admin";
		// Only people who accepted their invite: an unconfirmed email is just an address.
		const members = memberships.filter((m) => m.confirm).map((m) => m.userId);
		const agents = await listConnectedAgents(
			manager ? members : [viewer.userId],
		);
		return {
			state,
			agents,
			mcpUrl: await mcpUrl(),
			manager,
			viewerId: viewer.userId,
		};
	});

export const submitDisconnectAgent = createServerFn({ method: "POST" })
	.validator((d: { workspaceId: string; id: string }) => d)
	.handler(async ({ data }) => {
		const { client, viewer, role } = await requireWorkspace(data.workspaceId);
		const { memberships } = await new Teams(client).listMemberships({
			teamId: data.workspaceId,
			queries: [Query.limit(1000)],
		});
		await disconnectAgent(
			data.id,
			viewer.userId,
			role === "owner" || role === "admin",
			client,
			memberships.filter((m) => m.confirm).map((m) => m.userId),
		);
	});

// ---------- trash ----------

export const fetchTrash = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string }) => d)
	.handler(({ data }) => loadTrash(data.workspaceId));

export const submitRestore = createServerFn({ method: "POST" })
	.validator((d: { pageId: string }) => d)
	.handler(({ data }) => restorePage(data.pageId));

export const submitDeleteForever = createServerFn({ method: "POST" })
	.validator((d: { pageId: string; state?: PurgeState }) => d)
	.handler(({ data }) => deletePageForever(data.pageId, data.state));

// ---------- profile ----------

export const fetchProfile = createServerFn({ method: "GET" }).handler(() =>
	loadProfile(),
);
export const submitName = createServerFn({ method: "POST" })
	.validator((d: { name: string }) => d)
	.handler(({ data }) => saveName(data.name));
export const submitEmail = createServerFn({ method: "POST" })
	.validator((d: { email: string; password: string }) => d)
	.handler(({ data }) => saveEmail(data.email, data.password));
export const submitPassword = createServerFn({ method: "POST" })
	.validator((d: { password: string; oldPassword: string }) => d)
	.handler(({ data }) => savePassword(data.password, data.oldPassword));
export const submitAvatar = createServerFn({ method: "POST" })
	.validator((d: FormData) => d)
	.handler(async ({ data }) => {
		const file = data.get("file");
		if (!(file instanceof File)) throw new Error("There's no file to upload.");
		return saveAvatar(file);
	});
export const submitRemoveAvatar = createServerFn({ method: "POST" }).handler(
	() => removeAvatar(),
);
export const submitDeleteAccount = createServerFn({ method: "POST" })
	.validator((d: { confirmation: string }) => d)
	.handler(({ data }) => deleteAccount(data.confirmation));

export const fetchDevices = createServerFn({ method: "GET" }).handler(() =>
	listDevices(),
);
export const submitSignOutDevice = createServerFn({ method: "POST" })
	.validator((d: { sessionId: string }) => d)
	.handler(({ data }) => signOutDevice(data.sessionId));
export const submitSignOutOthers = createServerFn({ method: "POST" }).handler(
	() => signOutEverywhereElse(),
);

// ---------- import and export ----------

export const submitImport = createServerFn({ method: "POST" })
	.validator(
		(d: {
			workspaceId: string;
			importId: string;
			sectionId: string | null;
			items: ImportItem[];
		}) => d,
	)
	.handler(({ data }) => importBatch(data));

export const fetchExportBatch = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string; cursor?: string }) => d)
	.handler(({ data }) => exportBatch(data.workspaceId, data.cursor));

export const fetchExportDatabase = createServerFn({ method: "GET" })
	.validator(
		(d: { workspaceId: string; databaseId: string; cursor?: string }) => d,
	)
	.handler(({ data }) =>
		exportDatabase(data.workspaceId, data.databaseId, data.cursor),
	);
