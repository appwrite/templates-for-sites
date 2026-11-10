import {
	type Account,
	AuthenticationFactor,
	AuthenticatorType,
} from "node-appwrite";
import type { CodeKind } from "#/lib/two-step";
import { errorCode, errorType } from "./appwrite";

// Two-step sign-in with an authenticator app, on Appwrite's account MFA API. Every call runs with
// the person's own session, never the site key.
//
// What Appwrite enforces, and why the steps below run in this order:
// - A TOTP code is only accepted during its own 30 seconds, with no leeway.
// - Deleting the authenticator and replacing recovery codes need a challenge passed in the last
//   30 minutes on this session.
// - With MFA on, an account with a verified email still needs a second factor even without an
//   authenticator, so turning off sets mfa=false before the authenticator goes.
// - Creating challenges is limited to 10 an hour per person, and each challenge takes 10 tries.

export type Challenge = { id: string; expire: string; kind: CodeKind };

export interface MfaApi {
	status(): Promise<{ mfa: boolean; totp: boolean; recoveryCode: boolean }>;
	createAuthenticator(): Promise<{ secret: string; uri: string }>;
	verifyAuthenticator(otp: string): Promise<void>;
	deleteAuthenticator(): Promise<void>;
	setMfa(on: boolean): Promise<void>;
	createRecoveryCodes(): Promise<string[]>;
	replaceRecoveryCodes(): Promise<string[]>;
	createChallenge(kind: CodeKind): Promise<Challenge>;
	finishChallenge(id: string, otp: string): Promise<void>;
}

export function accountMfa(account: Account): MfaApi {
	return {
		async status() {
			const [user, factors] = await Promise.all([
				account.get(),
				account.listMFAFactors(),
			]);
			return {
				mfa: user.mfa,
				totp: factors.totp,
				recoveryCode: factors.recoveryCode,
			};
		},
		async createAuthenticator() {
			const { secret, uri } = await account.createMFAAuthenticator({
				type: AuthenticatorType.Totp,
			});
			return { secret, uri };
		},
		async verifyAuthenticator(otp) {
			await account.updateMFAAuthenticator({
				type: AuthenticatorType.Totp,
				otp,
			});
		},
		async deleteAuthenticator() {
			await account.deleteMFAAuthenticator({ type: AuthenticatorType.Totp });
		},
		async setMfa(on) {
			await account.updateMFA({ mfa: on });
		},
		async createRecoveryCodes() {
			return (await account.createMFARecoveryCodes()).recoveryCodes;
		},
		async replaceRecoveryCodes() {
			return (await account.updateMFARecoveryCodes()).recoveryCodes;
		},
		async createChallenge(kind) {
			const challenge = await account.createMFAChallenge({
				factor:
					kind === "totp"
						? AuthenticationFactor.Totp
						: // The SDK's enum sends "recoverycode". Appwrite accepts that when the challenge is
							// created but then compares it with "recoveryCode", so every code would be rejected.
							("recoveryCode" as AuthenticationFactor),
			});
			return { id: challenge.$id, expire: challenge.expire, kind };
		},
		async finishChallenge(id, otp) {
			await account.updateMFAChallenge({ challengeId: id, otp });
		},
	};
}

export class TwoStepError extends Error {
	constructor(
		readonly reason: "bad-code" | "too-many" | "not-linked",
		message: string,
	) {
		super(message);
	}
}

const BAD_CODE: Record<CodeKind, string> = {
	totp: "That code didn't work. Codes change every 30 seconds, so enter the one showing now.",
	recovery:
		"That recovery code didn't work. Each one works once. Check for typos or try another.",
};
const TOO_MANY = "Too many tries. Wait a few minutes, then try again.";

// Appwrite's errors for a wrong code and for too many tries, in words for the person.
function explain(err: unknown, kind: CodeKind): never {
	if (errorType(err) === "user_invalid_token")
		throw new TwoStepError("bad-code", BAD_CODE[kind]);
	if (errorCode(err) === 429) throw new TwoStepError("too-many", TOO_MANY);
	throw err;
}

// Proves the person holds a current code, which also counts as a fresh challenge for the next
// 30 minutes.
export async function passChallenge(api: MfaApi, kind: CodeKind, code: string) {
	let challenge: Challenge;
	try {
		challenge = await api.createChallenge(kind);
	} catch (err) {
		explain(err, kind);
	}
	try {
		await api.finishChallenge(challenge.id, code);
	} catch (err) {
		explain(err, kind);
	}
}

export type SetupStart =
	| { linked: false; secret: string; uri: string }
	// An authenticator was verified earlier but two-step sign-in never got turned on, for example
	// when the last attempt stopped halfway. A code from that app finishes the job.
	| { linked: true };

export async function startSetup(api: MfaApi): Promise<SetupStart> {
	try {
		const { secret, uri } = await api.createAuthenticator();
		return { linked: false, secret, uri };
	} catch (err) {
		if (errorType(err) === "user_authenticator_already_verified")
			return { linked: true };
		throw err;
	}
}

// Checks the first code from the app, turns two-step sign-in on and makes recovery codes. Returns
// null for the codes only when older ones exist and can't be replaced right now; they still work.
export async function turnOn(
	api: MfaApi,
	code: string,
): Promise<{ recoveryCodes: string[] | null }> {
	const { totp: linked } = await api.status();
	let fresh = false;
	if (linked) {
		await passChallenge(api, "totp", code);
		fresh = true;
	} else {
		try {
			await api.verifyAuthenticator(code);
		} catch (err) {
			if (errorType(err) === "user_authenticator_not_found")
				throw new TwoStepError(
					"not-linked",
					"Setup timed out. Start again to get a new QR code.",
				);
			explain(err, "totp");
		}
	}
	await api.setMfa(true);

	try {
		return { recoveryCodes: await api.createRecoveryCodes() };
	} catch (err) {
		if (errorType(err) !== "user_recovery_codes_already_exists") throw err;
	}
	// Codes from an earlier time two-step sign-in was on. Replacing them needs a fresh challenge;
	// the code just entered is still the current one unless its 30 seconds ran out.
	try {
		if (!fresh) await passChallenge(api, "totp", code);
		return { recoveryCodes: await api.replaceRecoveryCodes() };
	} catch {
		return { recoveryCodes: null };
	}
}

export async function turnOff(api: MfaApi, kind: CodeKind, code: string) {
	await passChallenge(api, kind, code);
	await api.setMfa(false);
	try {
		await api.deleteAuthenticator();
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
	}
}

export async function newRecoveryCodes(
	api: MfaApi,
	kind: CodeKind,
	code: string,
) {
	await passChallenge(api, kind, code);
	try {
		return await api.replaceRecoveryCodes();
	} catch (err) {
		if (errorCode(err) === 404) return api.createRecoveryCodes();
		throw err;
	}
}

export type SecondFactorResult =
	| { ok: true }
	| { ok: false; message: string; challenge: Challenge | null };

// The code step of signing in. A challenge takes 10 tries and creating them is rate limited, so a
// mistyped code reuses the same challenge instead of making a new one.
export async function passSecondFactor(
	api: MfaApi,
	kind: CodeKind,
	code: string,
	previous: Challenge | null,
	now = Date.now(),
): Promise<SecondFactorResult> {
	const reusable =
		previous &&
		previous.kind === kind &&
		Date.parse(previous.expire) - now > 60_000
			? previous
			: null;
	let challenge: Challenge;
	try {
		challenge = reusable ?? (await api.createChallenge(kind));
	} catch (err) {
		if (errorCode(err) === 429)
			return { ok: false, message: TOO_MANY, challenge: null };
		throw err;
	}
	try {
		await api.finishChallenge(challenge.id, code);
		return { ok: true };
	} catch (err) {
		if (errorType(err) === "user_invalid_token")
			return { ok: false, message: BAD_CODE[kind], challenge };
		// This challenge used up its tries. Start a fresh one with the same code.
		if (errorCode(err) === 429 && reusable)
			return passSecondFactor(api, kind, code, null, now);
		if (errorCode(err) === 429)
			return { ok: false, message: TOO_MANY, challenge: null };
		throw err;
	}
}

// Which codes the code step can take. Works before the second factor is in.
export async function secondFactors(account: Account) {
	const factors = await account.listMFAFactors();
	return { app: factors.totp, recovery: factors.recoveryCode };
}

// After a password sign-in: does this account still need a code?
export async function needsSecondFactor(account: Account) {
	try {
		await account.get();
		return false;
	} catch (err) {
		if (errorType(err) === "user_more_factors_required") return true;
		throw err;
	}
}
