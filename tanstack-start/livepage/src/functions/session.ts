import { createServerFn } from "@tanstack/react-start";
import type { AppState } from "#/lib/types";
import { errorCode, sessionClient } from "#/server/appwrite";
import { readSession, signOut, signUp, workspaceRole } from "#/server/auth";
import {
	isSetupComplete,
	readSettings,
	twoStepRequired,
} from "#/server/settings";
import { FIRST_WORKSPACE, schemaOutdated } from "#/server/setup";
import { listWorkspaces } from "#/server/workspaces";

// Runs before every app route. Sends people to /setup or /login when needed.
export const fetchAppState = createServerFn({ method: "GET" }).handler(
	async (): Promise<AppState> => {
		if (!(await isSetupComplete())) return { status: "setup" };
		const session = await readSession();
		if (session.status === "signed-out")
			return { status: "signed-out", setupComplete: true };
		if (session.status === "mfa") return { status: "mfa" };
		// Nothing else about the workspaces goes to the browser until two-step is done.
		if (!session.viewer.mfa && (await twoStepRequired()))
			return {
				status: "ok",
				viewer: session.viewer,
				workspaces: [],
				twoStepRequired: true,
			};
		const client = sessionClient(session.secret);
		return {
			status: "ok",
			viewer: session.viewer,
			workspaces: await listWorkspaces(client, session.viewer.userId),
			twoStepRequired: false,
			// Only the setup owner can run the update, so only they are told about it.
			schemaUpdate:
				(await schemaOutdated()) &&
				(await workspaceRole(
					client,
					session.viewer.userId,
					FIRST_WORKSPACE,
				)) === "owner",
		};
	},
);

export const submitSignUp = createServerFn({ method: "POST" })
	.validator((data: { name: string; email: string; password: string }) => data)
	.handler(async ({ data }) => {
		const settings = await readSettings();
		if (settings?.signup !== "open")
			throw new Error(
				"Sign-up is invite only here. Ask a workspace admin for an invite.",
			);
		const email = String(data.email || "")
			.trim()
			.toLowerCase();
		try {
			await signUp(
				String(data.name || "").trim(),
				email,
				String(data.password || ""),
			);
		} catch (err) {
			if (errorCode(err) === 409)
				throw new Error(
					"An account with this email already exists. Sign in instead.",
				);
			// Sign-ups from a Site all come from its one address, and Appwrite allows 10 an hour.
			if (errorCode(err) === 429)
				throw new Error(
					"Too many people signed up here in the last hour. Try again later.",
				);
			throw err;
		}
		return { ok: true };
	});

export const submitSignOut = createServerFn({ method: "POST" }).handler(
	async () => {
		await signOut();
		return { ok: true };
	},
);
