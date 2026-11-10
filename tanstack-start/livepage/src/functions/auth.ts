import { createServerFn } from "@tanstack/react-start";
import { Account, Teams } from "node-appwrite";
import type { CodeKind } from "#/lib/two-step";
import { readAnyCode, readCode } from "#/lib/two-step";
import {
	acceptInvite,
	completePasswordReset,
	confirmEmailVerification,
	readInvite,
	requestInvite,
	requestPasswordReset,
	sendEmailVerification,
} from "#/server/accounts";
import {
	adminClient,
	errorCode,
	errorType,
	sessionClient,
} from "#/server/appwrite";
import {
	readSession,
	readSessionSecret,
	requireSession,
	signIn,
} from "#/server/auth";
import {
	accountMfa,
	type Challenge,
	needsSecondFactor,
	newRecoveryCodes,
	passSecondFactor,
	secondFactors,
	startSetup,
	TwoStepError,
	turnOff,
	turnOn,
} from "#/server/mfa";
import { readSettings } from "#/server/settings";

const TOO_MANY = "Too many attempts. Wait a little while and try again.";

function plainError(err: unknown): never {
	if (err instanceof TwoStepError) throw new Error(err.message);
	if (errorCode(err) === 429) throw new Error(TOO_MANY);
	throw err;
}

// ---------- sign-in state, shared by /login and the consent screen ----------

async function firstWorkspaceName() {
	try {
		const team = await new Teams(adminClient()).get({ teamId: "main" });
		return team.name || null;
	} catch {
		return null;
	}
}

export type LoginState = {
	signup: "invite" | "open";
	status: "signed-out" | "mfa" | "ok";
	factors: { app: boolean; recovery: boolean } | null;
	workspaceName: string | null;
};

export const fetchLoginState = createServerFn({ method: "GET" }).handler(
	async (): Promise<LoginState> => {
		const session = await readSession();
		const settings = await readSettings().catch(() => null);
		return {
			signup: settings?.signup === "open" ? "open" : "invite",
			status: session.status,
			factors:
				session.status === "mfa"
					? await secondFactors(new Account(sessionClient(session.secret)))
					: null,
			workspaceName: await firstWorkspaceName(),
		};
	},
);

export const submitPassword = createServerFn({ method: "POST" })
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
		return { factors: needsCode ? await secondFactors(account) : null };
	});

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
		return result.ok ? { ok: true as const } : result;
	});

// ---------- password reset ----------

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
			if (errorCode(err) === 429) throw new Error(TOO_MANY);
			throw err;
		}
		return { ok: true };
	});

// ---------- sign-up ----------

export const submitInviteRequest = createServerFn({ method: "POST" })
	.validator((data: { email: string; note: string }) => data)
	.handler(async ({ data }) => {
		await requestInvite(String(data.email || ""), String(data.note || ""));
		return { ok: true };
	});

// Sends the verification email after signing up. Failing to send must not block the account.
export const submitSendVerification = createServerFn({
	method: "POST",
}).handler(async () => {
	const { secret } = await requireSession();
	await sendEmailVerification(secret).catch(() => undefined);
	return { ok: true };
});

export const submitVerifyEmail = createServerFn({ method: "POST" })
	.validator((data: { userId: string; secret: string }) => data)
	.handler(async ({ data }) => {
		try {
			await confirmEmailVerification(data);
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error(
					"This link expired or was already used. Sign in and send a new one.",
				);
			if (errorCode(err) === 429) throw new Error(TOO_MANY);
			throw err;
		}
		return { ok: true };
	});

// ---------- invites ----------

type InviteParams = {
	teamId: string;
	membershipId: string;
	userId: string;
	secret: string;
};

export const fetchInvite = createServerFn({ method: "GET" })
	.validator((data: Omit<InviteParams, "secret">) => data)
	.handler(async ({ data }) => readInvite(data));

export const submitAcceptInvite = createServerFn({ method: "POST" })
	.validator((data: InviteParams & { name: string; password: string }) => data)
	.handler(async ({ data }) => {
		try {
			await acceptInvite(data);
		} catch (err) {
			if (errorCode(err) === 401)
				throw new Error(
					"This invite expired or was already used. Ask an admin for a new one.",
				);
			if (errorCode(err) === 429) throw new Error(TOO_MANY);
			if (errorType(err) === "team_invite_mismatch")
				throw new Error("This invite is for a different account.");
			throw err;
		}
		return { ok: true };
	});

// ---------- two-step settings ----------

// requireSession, not requireViewer: these are the calls that turn two-step on.
async function mfaApi() {
	const { client, viewer } = await requireSession();
	return { api: accountMfa(new Account(client)), viewer };
}

export const fetchTwoStep = createServerFn({ method: "GET" }).handler(
	async () => {
		const { api, viewer } = await mfaApi();
		const status = await api.status();
		return { enabled: status.mfa && status.totp, email: viewer.email };
	},
);

export const startTwoStep = createServerFn({ method: "POST" }).handler(
	async () => {
		const { api } = await mfaApi();
		try {
			return await startSetup(api);
		} catch (err) {
			plainError(err);
		}
	},
);

export const confirmTwoStep = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const code = readCode(String(data.code || ""), "totp");
		if (!code)
			throw new Error("Enter the 6-digit code from your authenticator app.");
		const { api } = await mfaApi();
		try {
			return await turnOn(api, code);
		} catch (err) {
			plainError(err);
		}
	});

const ANY_CODE =
	"Enter the 6-digit code from your authenticator app, or a 10-character recovery code.";

export const disableTwoStep = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const parsed = readAnyCode(String(data.code || ""));
		if (!parsed) throw new Error(ANY_CODE);
		const { api } = await mfaApi();
		try {
			await turnOff(api, parsed.kind, parsed.code);
		} catch (err) {
			plainError(err);
		}
		return { ok: true };
	});

export const replaceRecoveryCodes = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const parsed = readAnyCode(String(data.code || ""));
		if (!parsed) throw new Error(ANY_CODE);
		const { api } = await mfaApi();
		try {
			return {
				recoveryCodes: await newRecoveryCodes(api, parsed.kind, parsed.code),
			};
		} catch (err) {
			plainError(err);
		}
	});
