import { Account, type Client, Query, TablesDB, Teams } from "node-appwrite";
import type { MemberInfo, ScopeRow } from "#/lib/types";
import {
	adminClient,
	createSessionRequest,
	errorCode,
	guestClient,
	keyScopes,
	sessionClient,
	siteOrigin,
} from "./appwrite";
import { storeSession, type Viewer } from "./auth";
import {
	DATABASE_ID,
	DEFAULT_RETENTION_DAYS,
	isPlatformScope,
	PLATFORM_SCOPES,
	RETENTION_CHOICES,
	RUNTIME_SCOPES,
	SETTINGS,
	SETTINGS_ROW,
	SETUP_ONLY_SCOPES,
	TEAM_ID,
} from "./schema";

// ---------- members (the admin's own session; Appwrite checks the owner role) ----------

export async function listMembers(
	client: Client,
	viewer: Viewer,
): Promise<MemberInfo[]> {
	const { memberships } = await new Teams(client).listMemberships({
		teamId: TEAM_ID,
		queries: [Query.limit(100)],
	});
	return memberships.map((m) => ({
		membershipId: m.$id,
		userId: m.userId,
		name: m.userName,
		email: m.userEmail,
		role: m.roles.includes("owner") ? "admin" : "member",
		confirmed: m.confirm,
		joinedAt: m.joined || m.invited,
		you: m.userId === viewer.userId,
	}));
}

export async function inviteMember(
	client: Client,
	input: { email: string; name: string; role: "admin" | "member" },
) {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new Error("Enter a valid email address.");
	try {
		// Appwrite emails the invite. The link opens /accept on this site.
		await new Teams(client).createMembership({
			teamId: TEAM_ID,
			roles: input.role === "admin" ? ["owner"] : ["member"],
			email,
			name: input.name.trim() || undefined,
			url: `${siteOrigin()}/accept`,
		});
	} catch (err) {
		if (errorCode(err) === 409)
			throw new Error("That person is already a member or has an invite.");
		throw err;
	}
}

export async function setMemberRole(
	client: Client,
	membershipId: string,
	role: "admin" | "member",
) {
	await new Teams(client).updateMembership({
		teamId: TEAM_ID,
		membershipId,
		roles: role === "admin" ? ["owner"] : ["member"],
	});
}

export async function removeMember(
	client: Client,
	viewer: Viewer,
	membershipId: string,
) {
	if (membershipId === viewer.membershipId)
		throw new Error("You can't remove yourself. Ask another admin.");
	await new Teams(client).deleteMembership({ teamId: TEAM_ID, membershipId });
}

// ---------- accepting an invite and resetting a password (no key, Appwrite's own limits) ----------

export async function acceptInvite(input: {
	teamId: string;
	membershipId: string;
	userId: string;
	secret: string;
	name: string;
	password: string;
}) {
	if (input.teamId !== TEAM_ID)
		throw new Error("This invite is for a different team.");
	if (input.password.length < 8)
		throw new Error("Use a password of at least 8 characters.");
	const { secret } = await createSessionRequest(
		`/teams/${encodeURIComponent(input.teamId)}/memberships/${encodeURIComponent(input.membershipId)}/status`,
		"PATCH",
		{ userId: input.userId, secret: input.secret },
	);
	if (!secret)
		throw new Error(
			"Appwrite accepted the invite but didn't start a session. Sign in instead.",
		);
	storeSession(secret);
	const account = new Account(sessionClient(secret));
	await account.updatePassword({ password: input.password });
	if (input.name.trim())
		await account.updateName({ name: input.name.trim().slice(0, 128) });
}

export async function requestPasswordReset(email: string) {
	const clean = email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
		throw new Error("Enter a valid email address.");
	try {
		await new Account(guestClient()).createRecovery({
			email: clean,
			url: `${siteOrigin()}/reset`,
		});
	} catch (err) {
		// Say the same thing whether or not the account exists.
		if (errorCode(err) === 404) return;
		if (errorCode(err) === 429)
			throw new Error("Too many reset requests. Wait an hour and try again.");
		throw err;
	}
}

export async function completePasswordReset(input: {
	userId: string;
	secret: string;
	password: string;
}) {
	if (input.password.length < 8)
		throw new Error("Use a password of at least 8 characters.");
	await new Account(guestClient()).updateRecovery({
		userId: input.userId,
		secret: input.secret,
		password: input.password,
	});
}

// ---------- settings (the site's key: rows.*) ----------

export async function getRetention() {
	try {
		const row = await new TablesDB(adminClient()).getRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
		});
		return Number(row.retentionDays) || DEFAULT_RETENTION_DAYS;
	} catch {
		return DEFAULT_RETENTION_DAYS;
	}
}

export async function setRetention(days: number) {
	if (!RETENTION_CHOICES.includes(days))
		throw new Error("Pick one of the listed retention periods.");
	await new TablesDB(adminClient()).upsertRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { retentionDays: days },
	});
}

// Reads the scopes from this request's key, so the list always matches the Console.
export function permissionRows(): { rows: ScopeRow[]; known: boolean } {
	const have = keyScopes();
	if (have === null) {
		return {
			rows: RUNTIME_SCOPES.map((s) => ({ ...s, state: "kept" as const })),
			known: false,
		};
	}
	const rows: ScopeRow[] = [];
	for (const s of RUNTIME_SCOPES)
		rows.push({ ...s, state: have.includes(s.scope) ? "kept" : "missing" });
	for (const s of SETUP_ONLY_SCOPES)
		if (have.includes(s.scope)) rows.push({ ...s, state: "setup" });
	const known = new Set<string>(
		[...RUNTIME_SCOPES, ...SETUP_ONLY_SCOPES].map((s) => s.scope),
	);
	for (const scope of have) {
		if (isPlatformScope(scope)) {
			rows.push({ scope, why: PLATFORM_SCOPES[scope], state: "platform" });
		} else if (!known.has(scope))
			rows.push({
				scope,
				why: "Catchall doesn't use this. You can remove it.",
				state: "extra",
			});
	}
	return { rows, known: true };
}
