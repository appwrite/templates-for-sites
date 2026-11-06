import { AppwriteException } from "node-appwrite";
import { describe, expect, it } from "vitest";
import type { CodeKind } from "#/lib/two-step";
import {
	type Challenge,
	type MfaApi,
	newRecoveryCodes,
	passSecondFactor,
	startSetup,
	TwoStepError,
	turnOff,
	turnOn,
} from "./mfa";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const CODES = [
	"0a1b2c3d4e",
	"5f6a7b8c9d",
	"a0b1c2d3e4",
	"f5a6b7c8d9",
	"1a2b3c4d5e",
	"6f7a8b9c0d",
];

const fail = (code: number, type: string) =>
	new AppwriteException(type, code, type);
const invalid = () => fail(401, "user_invalid_token");

type Overrides = Partial<{
	[K in keyof MfaApi]: (...args: Parameters<MfaApi[K]>) => unknown;
}>;

// A stand-in for Appwrite's account MFA API that records every call in order.
function fakeApi(
	over: Overrides = {},
	state = { mfa: false, totp: false, recoveryCode: false },
) {
	const calls: string[] = [];
	let next = 0;
	const base: MfaApi = {
		status: async () => state,
		createAuthenticator: async () => ({
			secret: "JBSWY3DPEHPK3PXP",
			uri: "otpauth://totp/x",
		}),
		verifyAuthenticator: async () => undefined,
		deleteAuthenticator: async () => undefined,
		setMfa: async () => undefined,
		createRecoveryCodes: async () => CODES,
		replaceRecoveryCodes: async () =>
			CODES.map((c) => c.split("").reverse().join("")),
		createChallenge: async (kind: CodeKind) => ({
			id: `ch_${++next}`,
			expire: new Date(NOW + 3600_000).toISOString(),
			kind,
		}),
		finishChallenge: async () => undefined,
	};
	const api = {} as MfaApi;
	for (const key of Object.keys(base) as (keyof MfaApi)[]) {
		const impl = (over[key] ?? base[key]) as (
			...args: unknown[]
		) => Promise<unknown>;
		(api as unknown as Record<string, unknown>)[key] = async (
			...args: unknown[]
		) => {
			calls.push(args.length ? `${key}(${args.join(", ")})` : key);
			return impl(...args);
		};
	}
	return { api, calls };
}

async function rejects(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	throw new Error("expected a rejection");
}

describe("turnOn", () => {
	it("checks the first code, turns MFA on, then makes recovery codes", async () => {
		const { api, calls } = fakeApi();
		expect(await turnOn(api, "123456")).toEqual({ recoveryCodes: CODES });
		expect(calls).toEqual([
			"status",
			"verifyAuthenticator(123456)",
			"setMfa(true)",
			"createRecoveryCodes",
		]);
	});

	it("leaves MFA off when the code is wrong", async () => {
		const { api, calls } = fakeApi({
			verifyAuthenticator: async () => {
				throw invalid();
			},
		});
		const err = await rejects(turnOn(api, "000000"));
		expect(err).toBeInstanceOf(TwoStepError);
		expect((err as TwoStepError).reason).toBe("bad-code");
		expect((err as Error).message).toMatch(/30 seconds/);
		expect(calls).not.toContain("setMfa(true)");
	});

	it("replaces recovery codes left from an earlier time, with a fresh challenge", async () => {
		const { api, calls } = fakeApi({
			createRecoveryCodes: async () => {
				throw fail(409, "user_recovery_codes_already_exists");
			},
		});
		const { recoveryCodes } = await turnOn(api, "123456");
		expect(recoveryCodes).toHaveLength(6);
		expect(calls.slice(-4)).toEqual([
			"createRecoveryCodes",
			"createChallenge(totp)",
			"finishChallenge(ch_1, 123456)",
			"replaceRecoveryCodes",
		]);
	});

	it("keeps MFA on with the old codes when they can't be replaced in time", async () => {
		const { api, calls } = fakeApi({
			createRecoveryCodes: async () => {
				throw fail(409, "user_recovery_codes_already_exists");
			},
			finishChallenge: async () => {
				throw invalid();
			},
		});
		expect(await turnOn(api, "123456")).toEqual({ recoveryCodes: null });
		expect(calls).toContain("setMfa(true)");
		expect(calls).not.toContain("replaceRecoveryCodes");
	});

	it("finishes an earlier setup that linked the app but stopped before MFA was on", async () => {
		const { api, calls } = fakeApi(
			{},
			{ mfa: false, totp: true, recoveryCode: false },
		);
		await turnOn(api, "123456");
		expect(calls).toEqual([
			"status",
			"createChallenge(totp)",
			"finishChallenge(ch_1, 123456)",
			"setMfa(true)",
			"createRecoveryCodes",
		]);
	});

	it("asks for a new QR code when the unverified app is gone", async () => {
		const { api } = fakeApi({
			verifyAuthenticator: async () => {
				throw fail(404, "user_authenticator_not_found");
			},
		});
		expect(
			((await rejects(turnOn(api, "123456"))) as TwoStepError).reason,
		).toBe("not-linked");
	});
});

describe("turnOff", () => {
	it("checks a code, turns MFA off, then removes the app", async () => {
		const { api, calls } = fakeApi();
		await turnOff(api, "totp", "123456");
		expect(calls).toEqual([
			"createChallenge(totp)",
			"finishChallenge(ch_1, 123456)",
			"setMfa(false)",
			"deleteAuthenticator",
		]);
	});

	it("takes a recovery code too", async () => {
		const { api, calls } = fakeApi();
		await turnOff(api, "recovery", "0a1b2c3d4e");
		expect(calls[0]).toBe("createChallenge(recovery)");
	});

	it("changes nothing when the code is wrong", async () => {
		const { api, calls } = fakeApi({
			finishChallenge: async () => {
				throw invalid();
			},
		});
		expect(await rejects(turnOff(api, "totp", "000000"))).toBeInstanceOf(
			TwoStepError,
		);
		expect(calls).toEqual([
			"createChallenge(totp)",
			"finishChallenge(ch_1, 000000)",
		]);
	});

	it("is fine when the app was already removed", async () => {
		const { api } = fakeApi({
			deleteAuthenticator: async () => {
				throw fail(404, "user_authenticator_not_found");
			},
		});
		await expect(turnOff(api, "totp", "123456")).resolves.toBeUndefined();
	});

	it("explains rate limits", async () => {
		const { api } = fakeApi({
			createChallenge: async () => {
				throw fail(429, "general_rate_limit_exceeded");
			},
		});
		const err = (await rejects(turnOff(api, "totp", "123456"))) as TwoStepError;
		expect(err.reason).toBe("too-many");
	});
});

describe("newRecoveryCodes", () => {
	it("needs a code, then replaces the codes", async () => {
		const { api, calls } = fakeApi();
		expect(await newRecoveryCodes(api, "totp", "123456")).toHaveLength(6);
		expect(calls.at(-1)).toBe("replaceRecoveryCodes");
	});

	it("creates codes when there were none", async () => {
		const { api, calls } = fakeApi({
			replaceRecoveryCodes: async () => {
				throw fail(404, "user_recovery_codes_not_found");
			},
		});
		expect(await newRecoveryCodes(api, "totp", "123456")).toEqual(CODES);
		expect(calls.at(-1)).toBe("createRecoveryCodes");
	});
});

describe("startSetup", () => {
	it("returns the secret and URI for the QR code", async () => {
		const { api } = fakeApi();
		expect(await startSetup(api)).toEqual({
			linked: false,
			secret: "JBSWY3DPEHPK3PXP",
			uri: "otpauth://totp/x",
		});
	});

	it("notices an app that's already linked", async () => {
		const { api } = fakeApi({
			createAuthenticator: async () => {
				throw fail(409, "user_authenticator_already_verified");
			},
		});
		expect(await startSetup(api)).toEqual({ linked: true });
	});
});

describe("passSecondFactor", () => {
	const later = (minutes: number, kind: CodeKind = "totp"): Challenge => ({
		id: "ch_old",
		expire: new Date(NOW + minutes * 60_000).toISOString(),
		kind,
	});

	it("passes with the right code", async () => {
		const { api, calls } = fakeApi();
		expect(await passSecondFactor(api, "totp", "123456", null, NOW)).toEqual({
			ok: true,
		});
		expect(calls).toEqual([
			"createChallenge(totp)",
			"finishChallenge(ch_1, 123456)",
		]);
	});

	it("hands back the challenge after a wrong code, and reuses it next time", async () => {
		const { api, calls } = fakeApi({
			finishChallenge: async (_id: string, otp: string) => {
				if (otp !== "654321") throw invalid();
			},
		});
		const first = await passSecondFactor(api, "totp", "000000", null, NOW);
		expect(first).toMatchObject({ ok: false, challenge: { id: "ch_1" } });
		if (first.ok) throw new Error("unreachable");
		expect(
			await passSecondFactor(api, "totp", "654321", first.challenge, NOW),
		).toEqual({ ok: true });
		expect(calls.filter((c) => c.startsWith("createChallenge"))).toHaveLength(
			1,
		);
	});

	it("makes a new challenge when the old one is about to expire or is for the other kind", async () => {
		const { api, calls } = fakeApi();
		await passSecondFactor(api, "totp", "123456", later(0.5), NOW);
		await passSecondFactor(
			api,
			"recovery",
			"0a1b2c3d4e",
			later(30, "totp"),
			NOW,
		);
		expect(calls.filter((c) => c.startsWith("createChallenge"))).toEqual([
			"createChallenge(totp)",
			"createChallenge(recovery)",
		]);
	});

	it("starts a fresh challenge once one has used up its tries", async () => {
		let tries = 0;
		const { api, calls } = fakeApi({
			finishChallenge: async (id: string) => {
				tries++;
				if (id === "ch_old") throw fail(429, "general_rate_limit_exceeded");
			},
		});
		expect(
			await passSecondFactor(api, "totp", "123456", later(30), NOW),
		).toEqual({ ok: true });
		expect(tries).toBe(2);
		expect(calls).toContain("finishChallenge(ch_1, 123456)");
	});

	it("says to wait when no more challenges can be made", async () => {
		const { api } = fakeApi({
			createChallenge: async () => {
				throw fail(429, "general_rate_limit_exceeded");
			},
		});
		const result = await passSecondFactor(api, "totp", "123456", null, NOW);
		expect(result).toMatchObject({ ok: false, challenge: null });
		if (result.ok) throw new Error("unreachable");
		expect(result.message).toMatch(/Wait a few minutes/);
	});

	it("explains a wrong recovery code differently", async () => {
		const { api } = fakeApi({
			finishChallenge: async () => {
				throw invalid();
			},
		});
		const result = await passSecondFactor(
			api,
			"recovery",
			"0a1b2c3d4e",
			null,
			NOW,
		);
		if (result.ok) throw new Error("unreachable");
		expect(result.message).toMatch(/works once/);
	});
});
