import {
	deleteCookie,
	getCookie,
	setCookie,
} from "@tanstack/react-start/server";
import { Account, type Client, ID, Query, Teams } from "node-appwrite";
import type { Role, Viewer, Workspace } from "#/lib/types";
import {
	createSessionRequest,
	errorCode,
	errorType,
	guestClient,
	sessionClient,
	siteOrigin,
} from "./appwrite";
import { twoStepRequired } from "./settings";

const SESSION_COOKIE = "livepage_session";

export function readSessionSecret() {
	return getCookie(SESSION_COOKIE) || null;
}

export function storeSession(secret: string, expire?: string) {
	setCookie(SESSION_COOKIE, secret, {
		httpOnly: true,
		secure: siteOrigin().startsWith("https:"),
		sameSite: "lax",
		path: "/",
		expires: expire
			? new Date(expire)
			: new Date(Date.now() + 365 * 86_400_000),
	});
}

export function clearSession() {
	deleteCookie(SESSION_COOKIE, { path: "/" });
}

// Signs in without the site key, so Appwrite's own per-email sign-in limit applies.
export async function signIn(email: string, password: string) {
	const { json, secret } = await createSessionRequest(
		"/account/sessions/email",
		"POST",
		{ email, password },
	);
	if (!secret) throw new Error("Appwrite did not return a session.");
	storeSession(secret, String(json.expire || ""));
	return secret;
}

export async function signUp(name: string, email: string, password: string) {
	await new Account(guestClient()).create({
		userId: ID.unique(),
		email,
		password,
		name,
	});
	return signIn(email, password);
}

export async function signOut() {
	const secret = readSessionSecret();
	if (secret) {
		await new Account(sessionClient(secret))
			.deleteSession({ sessionId: "current" })
			.catch(() => undefined);
	}
	clearSession();
}

export type SessionState =
	| { status: "signed-out" }
	// Signed in with a password, but two-step sign-in still needs a code.
	| { status: "mfa"; secret: string }
	| { status: "ok"; viewer: Viewer; secret: string };

export async function readSession(): Promise<SessionState> {
	const secret = readSessionSecret();
	if (!secret) return { status: "signed-out" };
	let user: Awaited<ReturnType<Account["get"]>>;
	try {
		user = await new Account(sessionClient(secret)).get();
	} catch (err) {
		if (errorCode(err) === 401) {
			if (errorType(err) === "user_more_factors_required")
				return { status: "mfa", secret };
			clearSession();
			return { status: "signed-out" };
		}
		throw err;
	}
	return {
		status: "ok",
		secret,
		viewer: {
			userId: user.$id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerification,
			mfa: user.mfa,
		},
	};
}

export class AuthError extends Error {
	constructor(
		message: string,
		readonly reason: "signed-out" | "forbidden",
	) {
		super(message);
	}
}

// The session is real, but two-step isn't checked. Only for the screens that turn two-step on.
export async function requireSession() {
	const state = await readSession();
	if (state.status !== "ok")
		throw new AuthError("Sign in to continue.", "signed-out");
	return {
		viewer: state.viewer,
		secret: state.secret,
		client: sessionClient(state.secret),
	};
}

// A signed-in person who can use the app. On a site that requires two-step sign-in, an account
// without it gets no further than /two-step, whatever the browser does.
export async function requireViewer() {
	const session = await requireSession();
	if (!session.viewer.mfa && (await twoStepRequired()))
		throw new AuthError("Turn on two-step sign-in to continue.", "forbidden");
	return session;
}

function roleFrom(roles: string[]): Role {
	if (roles.includes("owner")) return "owner";
	if (roles.includes("admin")) return "admin";
	if (roles.includes("member")) return "member";
	return "guest";
}

// The roles a membership holds in Appwrite. Owners and admins also carry `member`,
// because rows are shared with team:<id>/member.
export function membershipRoles(role: Role): string[] {
	return role === "guest"
		? ["guest"]
		: role === "member"
			? ["member"]
			: [role, "member"];
}

// The person's role in a workspace, or null if they aren't in it.
export async function workspaceRole(
	client: Client,
	userId: string,
	workspaceId: string,
): Promise<Role | null> {
	try {
		const { memberships } = await new Teams(client).listMemberships({
			teamId: workspaceId,
			queries: [Query.equal("userId", [userId]), Query.limit(1)],
		});
		const membership = memberships.find((m) => m.confirm);
		return membership ? roleFrom(membership.roles) : null;
	} catch (err) {
		if ([401, 404].includes(errorCode(err))) return null;
		throw err;
	}
}

// Requires workspace membership. Pass minRole "admin" for owner-or-admin only actions.
export async function requireWorkspace(
	workspaceId: string,
	minRole: "member" | "admin" = "member",
) {
	const session = await requireViewer();
	const role = await workspaceRole(
		session.client,
		session.viewer.userId,
		workspaceId,
	);
	if (!role)
		throw new AuthError(
			"You don't have access to this workspace.",
			"forbidden",
		);
	if (minRole === "admin" && role !== "owner" && role !== "admin")
		throw new AuthError("Only workspace admins can do this.", "forbidden");
	return { ...session, role };
}

export { roleFrom };
export type { Workspace };
