// Password reset, invite acceptance, email verification and the invite-request form.
// Runs without the site key where Appwrite's own per-email limits should apply.
import { Account, ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import {
	adminClient,
	createSessionRequest,
	errorCode,
	guestClient,
	sessionClient,
} from "./appwrite";
import { storeSession } from "./auth";
import { DATABASE_ID, NOTIFICATIONS, SETTINGS, SETTINGS_ROW } from "./schema";
import { trustedOrigin } from "./settings";

const MIN_PASSWORD = 8;

export function validEmail(email: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function requestPasswordReset(email: string) {
	const clean = email.trim().toLowerCase();
	if (!validEmail(clean)) throw new Error("Enter a valid email address.");
	try {
		await new Account(guestClient()).createRecovery({
			email: clean,
			url: `${await trustedOrigin()}/reset`,
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
	if (input.password.length < MIN_PASSWORD)
		throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
	await new Account(guestClient()).updateRecovery({
		userId: input.userId,
		secret: input.secret,
		password: input.password,
	});
}

export type InviteDetails = {
	workspaceName: string;
	inviterName: string | null;
	email: string;
	others: { name: string }[];
	othersCount: number;
	// Accounts made by the invite have no password yet, so they choose one here.
	needsPassword: boolean;
	alreadyMember: boolean;
};

// What the invite page shows. Reads with the site key so the page needs no session.
export async function readInvite(input: {
	teamId: string;
	membershipId: string;
	userId: string;
}): Promise<InviteDetails | null> {
	const client = adminClient();
	const teams = new Teams(client);
	try {
		const [team, membership, list, user] = await Promise.all([
			teams.get({ teamId: input.teamId }),
			teams.getMembership({
				teamId: input.teamId,
				membershipId: input.membershipId,
			}),
			teams.listMemberships({
				teamId: input.teamId,
				queries: [Query.equal("confirm", [true]), Query.limit(25)],
			}),
			new Users(client).get({ userId: input.userId }),
		]);
		if (membership.userId !== input.userId) return null;
		const owners = list.memberships.filter((m) => m.roles.includes("owner"));
		const inviter = owners[0] ?? list.memberships[0];
		const others = list.memberships.filter((m) => m.userId !== input.userId);
		const passwordUpdate = (user as { passwordUpdate?: string }).passwordUpdate;
		return {
			workspaceName: team.name,
			inviterName: inviter?.userName ? firstName(inviter.userName) : null,
			email: membership.userEmail,
			others: others.slice(0, 3).map((m) => ({ name: m.userName })),
			othersCount: Math.max(0, list.total - 3),
			needsPassword: !passwordUpdate,
			alreadyMember: membership.confirm,
		};
	} catch (err) {
		if ([401, 404].includes(errorCode(err))) return null;
		throw err;
	}
}

function firstName(name: string) {
	return name.trim().split(/\s+/)[0] || name;
}

export async function acceptInvite(input: {
	teamId: string;
	membershipId: string;
	userId: string;
	secret: string;
	name: string;
	password: string;
}) {
	if (input.password && input.password.length < MIN_PASSWORD)
		throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
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
	const name = input.name.trim();
	if (name) await account.updateName({ name }).catch(() => undefined);
	if (input.password)
		await account.updatePassword({ password: input.password });
}

export async function sendEmailVerification(secret: string) {
	await new Account(sessionClient(secret)).createEmailVerification({
		url: `${await trustedOrigin()}/verify`,
	});
}

export async function confirmEmailVerification(input: {
	userId: string;
	secret: string;
}) {
	await new Account(guestClient()).updateEmailVerification({
		userId: input.userId,
		secret: input.secret,
	});
}

async function settingsFeatures(): Promise<{ ownerId?: string }> {
	const row = await new TablesDB(adminClient()).getRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
	});
	try {
		return JSON.parse(String(row.features ?? "{}"));
	} catch {
		return {};
	}
}

// Board 82: someone without an invite asks the owner for one. It lands in the owner's inbox; the
// answer is the invite email itself.
export async function requestInvite(email: string, note: string) {
	const clean = email.trim().toLowerCase();
	if (!validEmail(clean)) throw new Error("Enter a valid email address.");
	const { ownerId } = await settingsFeatures();
	if (!ownerId) return;
	// One open request per email, so the form can't be used to fill the owner's inbox.
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(clean),
	);
	const rowId = `invite-${[...new Uint8Array(hash)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
	try {
		await new TablesDB(adminClient()).createRow({
			databaseId: DATABASE_ID,
			tableId: NOTIFICATIONS,
			rowId,
			data: {
				userId: ownerId,
				workspaceId: "main",
				pageId: null,
				kind: "invite-request",
				actorId: null,
				actorName: clean,
				title: `${clean} asked for an invite`,
				body: note.trim().slice(0, 500) || null,
				readAt: null,
			},
			permissions: [`read("user:${ownerId}")`, `update("user:${ownerId}")`],
		});
	} catch (err) {
		if (errorCode(err) !== 409) throw err;
	}
}

export { ID };
