import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Account } from "node-appwrite";
import { type CodeKind, readCode } from "#/lib/two-step";
import type { ViewerInfo } from "#/lib/types";
import { errorCode, sessionClient } from "#/server/appwrite";
import {
	AuthError,
	readSessionSecret,
	readViewer,
	requireMember,
	signIn,
	signOut,
} from "#/server/auth";
import {
	accountMfa,
	type Challenge,
	needsSecondFactor,
	passSecondFactor,
	secondFactors,
} from "#/server/mfa";
import { isSetupComplete } from "#/server/setup";
import {
	acceptInvite,
	completePasswordReset,
	requestPasswordReset,
} from "#/server/team";

// Runs before every app page: sends people to /setup or /login when needed.
export const fetchViewer = createServerFn({ method: "GET" }).handler(
	async (): Promise<ViewerInfo> => {
		if (!(await isSetupComplete())) throw redirect({ to: "/setup" });
		try {
			const { viewer } = await requireMember();
			return {
				userId: viewer.userId,
				name: viewer.name,
				email: viewer.email,
				role: viewer.role,
			};
		} catch (err) {
			if (err instanceof AuthError) throw redirect({ to: "/login" });
			throw err;
		}
	},
);

export const fetchLoginState = createServerFn({ method: "GET" }).handler(
	async () => {
		const state = await readViewer();
		const complete = await isSetupComplete();
		return {
			setupComplete: complete,
			status: state.status,
			email: state.status === "no-team" ? state.email : null,
			factors:
				state.status === "mfa"
					? await secondFactors(new Account(sessionClient(state.secret)))
					: null,
		};
	},
);

export const submitSignIn = createServerFn({ method: "POST" })
	.validator((data: { email: string; password: string }) => data)
	.handler(async ({ data }) => {
		const email = String(data.email || "")
			.trim()
			.toLowerCase();
		let secret: string;
		try {
			secret = await signIn(email, String(data.password || ""));
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error("That email and password don't match.");
			if (errorCode(err) === 429)
				throw new Error(
					"Too many attempts for this email. Wait a while and try again.",
				);
			throw err;
		}
		const account = new Account(sessionClient(secret));
		const needsCode = await needsSecondFactor(account);
		return {
			setupComplete: await isSetupComplete(),
			factors: needsCode ? await secondFactors(account) : null,
		};
	});

// The code step of signing in, for accounts with two-step sign-in on.
export const submitSecondFactor = createServerFn({ method: "POST" })
	.validator(
		(data: { code: string; kind: CodeKind; challenge: Challenge | null }) =>
			data,
	)
	.handler(async ({ data }) => {
		const kind: CodeKind = data.kind === "recovery" ? "recovery" : "totp";
		const code = readCode(String(data.code || ""), kind);
		if (!code)
			return {
				ok: false as const,
				message:
					kind === "totp"
						? "Enter the 6 digits from your authenticator app."
						: "A recovery code has 10 letters and numbers.",
				challenge: data.challenge,
			};
		const secret = readSessionSecret();
		if (!secret)
			throw new Error(
				"Your sign-in timed out. Start again with your password.",
			);
		const result = await passSecondFactor(
			accountMfa(new Account(sessionClient(secret))),
			kind,
			code,
			data.challenge,
		);
		if (!result.ok) return result;
		return { ok: true as const, setupComplete: await isSetupComplete() };
	});

export const submitSignOut = createServerFn({ method: "POST" }).handler(
	async () => {
		await signOut();
		return { ok: true };
	},
);

export const submitResetRequest = createServerFn({ method: "POST" })
	.validator((data: { email: string }) => data)
	.handler(async ({ data }) => {
		await requestPasswordReset(String(data.email || ""));
		return { ok: true };
	});

export const submitNewPassword = createServerFn({ method: "POST" })
	.validator(
		(data: { userId: string; secret: string; password: string }) => data,
	)
	.handler(async ({ data }) => {
		try {
			await completePasswordReset(data);
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error(
					"This reset link expired or was already used. Request a new one.",
				);
			throw err;
		}
		return { ok: true };
	});

export const submitAcceptInvite = createServerFn({ method: "POST" })
	.validator(
		(data: {
			teamId: string;
			membershipId: string;
			userId: string;
			secret: string;
			name: string;
			password: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		try {
			await acceptInvite(data);
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error(
					"This invite expired or was already used. Ask an admin for a new one.",
				);
			throw err;
		}
		return { ok: true };
	});
