import { createServerFn } from "@tanstack/react-start";
import { Account } from "node-appwrite";
import { sessionClient } from "#/server/appwrite";
import { readSession, readSessionSecret } from "#/server/auth";
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
	recordConnection,
} from "#/server/oauth";
import { twoStepRequired } from "#/server/settings";
import { listWorkspaces } from "#/server/workspaces";

export type ConsentView =
	| {
			view: "sign-in";
			clientHint: string | null;
			factors: { app: boolean; recovery: boolean } | null;
	  }
	| {
			view: "no-workspace";
			email: string;
			grantId: string | null;
			client: ConsentClient | null;
	  }
	| { view: "redirect"; url: string; client: ConsentClient | null }
	| {
			view: "consent";
			grant: ConsentGrant;
			user: { id: string; name: string; email: string };
			workspaces: string[];
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

		const session = await readSession();
		if (session.status !== "ok")
			return {
				view: "sign-in",
				clientHint,
				factors:
					session.status === "mfa"
						? await secondFactors(new Account(sessionClient(session.secret)))
						: null,
			};

		const workspaces = await listWorkspaces(
			sessionClient(session.secret),
			session.viewer.userId,
		);
		let grantId = query.get("grant_id");
		try {
			if (!grantId) {
				const started = await beginAuthorization(session.secret, query);
				if (started.redirectUrl && workspaces.length)
					return { view: "redirect", url: started.redirectUrl, client: null };
				grantId = started.grantId;
			}
			if (!grantId) throw new Error("The OAuth server didn't return a grant.");
			const grant = await readGrant(session.secret, grantId);
			if (!workspaces.length)
				return {
					view: "no-workspace",
					email: session.viewer.email,
					grantId,
					client: grant.client,
				};
			return {
				view: "consent",
				grant,
				user: {
					id: session.viewer.userId,
					name: session.viewer.name,
					email: session.viewer.email,
				},
				workspaces: workspaces.map((w) => w.name),
				problems: grantProblems(grant, await mcpUrl()),
			};
		} catch (err) {
			if (!workspaces.length)
				return {
					view: "no-workspace",
					email: session.viewer.email,
					grantId: null,
					client: null,
				};
			return { view: "error", message: friendlyOAuthError(err) };
		}
	});

export const submitConsent = createServerFn({ method: "POST" })
	.validator((data: { grantId: string; approve: boolean }) => data)
	.handler(async ({ data }) => {
		const session = await readSession();
		const secret =
			session.status === "ok" ? session.secret : readSessionSecret();
		if (!secret) throw new Error("Sign in again to continue.");
		if (data.approve) {
			if (session.status !== "ok")
				throw new Error("Sign in again to continue.");
			if (!session.viewer.mfa && (await twoStepRequired()))
				throw new Error("Turn on two-step sign-in before connecting an agent.");
			const workspaces = await listWorkspaces(
				sessionClient(secret),
				session.viewer.userId,
			);
			if (!workspaces.length)
				throw new Error(
					"Join a workspace before connecting an agent. Ask an admin for an invite.",
				);
			const grant = await readGrant(secret, data.grantId);
			const problems = grantProblems(grant, await mcpUrl());
			if (problems.length) throw new Error(problems[0]);
		}
		try {
			const grant =
				data.approve && session.status === "ok"
					? await readGrant(secret, data.grantId)
					: null;
			const redirectUrl = await decideGrant(secret, data.grantId, data.approve);
			if (grant && session.status === "ok")
				await recordConnection(
					session.viewer.userId,
					session.viewer.name,
					grant.client.id,
					grant.client.name,
				).catch(() => undefined);
			return { redirectUrl };
		} catch (err) {
			throw new Error(friendlyOAuthError(err));
		}
	});
