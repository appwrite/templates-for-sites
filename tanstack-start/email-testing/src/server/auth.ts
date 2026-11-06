import {
	deleteCookie,
	getCookie,
	setCookie,
} from "@tanstack/react-start/server";
import { Account, Query, Teams } from "node-appwrite";
import {
	createSessionRequest,
	errorCode,
	errorType,
	sessionClient,
	siteOrigin,
} from "./appwrite";
import { TEAM_ID } from "./schema";

const SESSION_COOKIE = "catchall_session";

export type Role = "admin" | "member";
export type Viewer = {
	userId: string;
	name: string;
	email: string;
	role: Role;
	membershipId: string;
};

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
	| { status: "no-team"; userId: string; name: string; email: string }
	| { status: "member"; viewer: Viewer; secret: string };

export async function readViewer(): Promise<SessionState> {
	const secret = readSessionSecret();
	if (!secret) return { status: "signed-out" };
	const client = sessionClient(secret);
	let user: Awaited<ReturnType<Account["get"]>>;
	try {
		user = await new Account(client).get();
	} catch (err) {
		if (errorCode(err) === 401) {
			if (errorType(err) === "user_more_factors_required")
				return { status: "mfa", secret };
			clearSession();
			return { status: "signed-out" };
		}
		throw err;
	}
	try {
		const { memberships } = await new Teams(client).listMemberships({
			teamId: TEAM_ID,
			queries: [Query.equal("userId", [user.$id]), Query.limit(1)],
		});
		const membership = memberships.find((m) => m.confirm);
		if (membership) {
			return {
				status: "member",
				secret,
				viewer: {
					userId: user.$id,
					name: user.name,
					email: user.email,
					role: membership.roles.includes("owner") ? "admin" : "member",
					membershipId: membership.$id,
				},
			};
		}
	} catch (err) {
		// 401 or 404: the person is not in the team, or the team does not exist yet.
		if (![401, 404].includes(errorCode(err))) throw err;
	}
	return {
		status: "no-team",
		userId: user.$id,
		name: user.name,
		email: user.email,
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

export async function requireMember() {
	const state = await readViewer();
	if (state.status !== "member")
		throw new AuthError("Sign in to continue.", "signed-out");
	return { viewer: state.viewer, client: sessionClient(state.secret) };
}

export async function requireAdmin() {
	const result = await requireMember();
	if (result.viewer.role !== "admin")
		throw new AuthError("Only admins can do this.", "forbidden");
	return result;
}
