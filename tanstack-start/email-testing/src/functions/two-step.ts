import { createServerFn } from "@tanstack/react-start";
import { Account } from "node-appwrite";
import { readAnyCode, readCode } from "#/lib/two-step";
import { requireMember } from "#/server/auth";
import {
	accountMfa,
	newRecoveryCodes,
	startSetup,
	TwoStepError,
	turnOff,
	turnOn,
} from "#/server/mfa";

// Settings → Security. Everything runs as the signed-in person with their own session.

async function member() {
	const { client, viewer } = await requireMember();
	return { api: accountMfa(new Account(client)), viewer };
}

// Server function errors reach the page as plain messages.
async function plainErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof TwoStepError) throw new Error(err.message);
		throw err;
	}
}

const TOTP_FORMAT = "Enter the 6-digit code from your authenticator app.";
const ANY_FORMAT =
	"Enter the 6-digit code from your authenticator app, or a 10-character recovery code.";

export const fetchTwoStep = createServerFn({ method: "GET" }).handler(
	async () => {
		const { api } = await member();
		const status = await api.status();
		return { enabled: status.mfa && status.totp };
	},
);

export const startTwoStep = createServerFn({ method: "POST" }).handler(
	async () => {
		const { api } = await member();
		return plainErrors(() => startSetup(api));
	},
);

export const confirmTwoStep = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const code = readCode(String(data.code || ""), "totp");
		if (!code) throw new Error(TOTP_FORMAT);
		const { api } = await member();
		return plainErrors(() => turnOn(api, code));
	});

export const disableTwoStep = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const parsed = readAnyCode(String(data.code || ""));
		if (!parsed) throw new Error(ANY_FORMAT);
		const { api } = await member();
		await plainErrors(() => turnOff(api, parsed.kind, parsed.code));
		return { ok: true };
	});

export const replaceRecoveryCodes = createServerFn({ method: "POST" })
	.validator((data: { code: string }) => data)
	.handler(async ({ data }) => {
		const parsed = readAnyCode(String(data.code || ""));
		if (!parsed) throw new Error(ANY_FORMAT);
		const { api } = await member();
		return {
			recoveryCodes: await plainErrors(() =>
				newRecoveryCodes(api, parsed.kind, parsed.code),
			),
		};
	});
