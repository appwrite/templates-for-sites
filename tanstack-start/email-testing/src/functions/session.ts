import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ViewerInfo } from "#/lib/types";
import { errorCode } from "#/server/appwrite";
import {
	AuthError,
	readViewer,
	requireMember,
	signIn,
	signOut,
} from "#/server/auth";
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
		};
	},
);

export const submitSignIn = createServerFn({ method: "POST" })
	.validator((data: { email: string; password: string }) => data)
	.handler(async ({ data }) => {
		const email = String(data.email || "")
			.trim()
			.toLowerCase();
		try {
			await signIn(email, String(data.password || ""));
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error("That email and password don't match.");
			if (errorCode(err) === 429)
				throw new Error(
					"Too many attempts for this email. Wait a while and try again.",
				);
			throw err;
		}
		return { setupComplete: await isSetupComplete() };
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
