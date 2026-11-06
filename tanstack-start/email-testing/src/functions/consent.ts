import { createServerFn } from "@tanstack/react-start";
import { Account } from "node-appwrite";
import { sessionClient } from "#/server/appwrite";
import { readSessionSecret, readViewer } from "#/server/auth";
import { secondFactors } from "#/server/mfa";
import {
	beginAuthorization,
	type ConsentClient,
	type ConsentGrant,
	decideGrant,
	friendlyOAuthError,
	grantProblems,
	hostOf,
	mcpUrl,
	readGrant,
} from "#/server/oauth";

export type ConsentView =
	| {
			view: "sign-in";
			clientHint: string | null;
			// Set when the person signed in with a password and still needs to enter a code.
			factors: { app: boolean; recovery: boolean } | null;
	  }
	| {
			view: "no-team";
			email: string;
			grantId: string | null;
			client: ConsentClient | null;
	  }
	| { view: "redirect"; url: string; client: ConsentClient | null }
	| {
			view: "consent";
			grant: ConsentGrant;
			user: { name: string; email: string };
			problems: string[];
	  }
	| { view: "error"; message: string };

// What the consent screen shows for the request in its query string. The OAuth server sent the
// browser here with the agent's original authorization request; this replays it with the
// person's session to get a grant, then reads the grant to show what the agent asks for.
export const fetchConsent = createServerFn({ method: "GET" })
	.validator((data: { query: string }) => data)
	.handler(async ({ data }): Promise<ConsentView> => {
		const query = new URLSearchParams(data.query);
		if (
			!query.get("client_id") &&
			!query.get("request_uri") &&
			!query.get("grant_id")
		)
			return {
				view: "error",
				message:
					"This page is where AI agents ask for access. Start from your MCP client and it opens here on its own.",
			};
		const clientId = query.get("client_id");
		const clientHint =
			clientId && /^https?:\/\//i.test(clientId) ? hostOf(clientId) : null;

		const state = await readViewer();
		if (state.status === "signed-out" || state.status === "mfa")
			return {
				view: "sign-in",
				clientHint,
				factors:
					state.status === "mfa"
						? await secondFactors(new Account(sessionClient(state.secret)))
						: null,
			};

		const secret = state.status === "no-team" ? null : state.secret;
		// Someone not on the team still gets a grant, so Deny can send them back to the agent.
		let grantId = query.get("grant_id");
		try {
			if (!grantId) {
				const started = await beginAuthorization(
					secret ?? (await noTeamSecret()),
					query,
				);
				if (started.redirectUrl && state.status === "member")
					return { view: "redirect", url: started.redirectUrl, client: null };
				grantId = started.grantId;
			}
			if (!grantId) throw new Error("The OAuth server didn't return a grant.");
			const grant = await readGrant(secret ?? (await noTeamSecret()), grantId);
			if (state.status === "no-team")
				return {
					view: "no-team",
					email: state.email,
					grantId,
					client: grant.client,
				};
			return {
				view: "consent",
				grant,
				user: { name: state.viewer.name, email: state.viewer.email },
				problems: grantProblems(grant, mcpUrl()),
			};
		} catch (err) {
			if (state.status === "no-team")
				return {
					view: "no-team",
					email: state.email,
					grantId: null,
					client: null,
				};
			return { view: "error", message: friendlyOAuthError(err) };
		}
	});

// readViewer only hands out the secret for team members. Someone outside the team is signed in
// too, and their own session is what the OAuth server needs to make (and reject) their grant.
async function noTeamSecret() {
	const secret = readSessionSecret();
	if (!secret) throw new Error("Sign in again.");
	return secret;
}

export const submitConsent = createServerFn({ method: "POST" })
	.validator((data: { grantId: string; approve: boolean }) => data)
	.handler(async ({ data }) => {
		const state = await readViewer();
		if (state.status === "signed-out" || state.status === "mfa")
			throw new Error("Sign in again to continue.");
		// Only team members can approve. Anyone signed in can say no.
		if (data.approve && state.status !== "member")
			throw new Error(
				"Only members of this inbox's team can connect an agent.",
			);
		const secret =
			state.status === "member" ? state.secret : await noTeamSecret();
		if (data.approve && state.status === "member") {
			const grant = await readGrant(secret, data.grantId);
			const problems = grantProblems(grant, mcpUrl());
			if (problems.length) throw new Error(problems[0]);
		}
		try {
			return {
				redirectUrl: await decideGrant(secret, data.grantId, data.approve),
			};
		} catch (err) {
			throw new Error(friendlyOAuthError(err));
		}
	});
