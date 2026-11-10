// Optional parts of Livepage: what's on, what this project could turn on, and what it would take.
import { type Models, Project, Query, TablesDB } from "node-appwrite";
import type { VectorSpec } from "#/lib/setup-types";
import { MCP_SCOPE } from "#/server/access-token";
import {
	adminClient,
	appwriteEnv,
	consoleUrl,
	isCloudEndpoint,
	keyScopes,
	siteKey,
} from "#/server/appwrite";
import { requireViewer, requireWorkspace, workspaceRole } from "#/server/auth";
import {
	decideAgents,
	probeVectors,
	type RawProject,
} from "#/server/capabilities";
import { consentUrl } from "#/server/consent";
import {
	DATABASE_ID,
	SETTINGS,
	SETTINGS_ROW,
	VECTOR_SCOPE_NAMES,
	WORKSPACES,
} from "#/server/schema";
import {
	forgetVectorsHealth,
	readSettings,
	type SettingsRow,
	vectorsHealth,
} from "#/server/settings";

export type FeatureFlags = {
	publish: boolean;
	guests: boolean;
	requireTwoStep: boolean;
};

const DEFAULT_FLAGS: FeatureFlags = {
	publish: true,
	guests: false,
	requireTwoStep: false,
};

export function parseFlags(settings: SettingsRow | null): FeatureFlags {
	if (!settings?.features) return DEFAULT_FLAGS;
	try {
		return { ...DEFAULT_FLAGS, ...JSON.parse(settings.features) };
	} catch {
		return DEFAULT_FLAGS;
	}
}

export async function isSetupFeatureOn(name: keyof FeatureFlags) {
	return parseFlags(await readSettings())[name];
}

// Features and sign-up are for the whole site, so only the owner of the first workspace changes them.
export async function isInstanceOwner(userId: string) {
	const { rows } = await new TablesDB(adminClient()).listRows<
		Models.Row & { name: string }
	>({
		databaseId: DATABASE_ID,
		tableId: WORKSPACES,
		queries: [Query.orderAsc("$createdAt"), Query.limit(1)],
	});
	if (!rows.length) return false;
	const { client } = await requireViewer();
	const role = await workspaceRole(client, userId, rows[0].$id);
	return role === "owner";
}

async function requireInstanceOwner() {
	const { viewer } = await requireViewer();
	if (!(await isInstanceOwner(viewer.userId)))
		throw new Error(
			"Only the owner of this site's first workspace can change this.",
		);
	return viewer;
}

export type VectorsState =
	| {
			kind: "on";
			spec: VectorSpec | null;
			status: "ready" | "starting" | "failed";
	  }
	| { kind: "off"; specs: VectorSpec[] }
	| { kind: "free-plan" }
	| { kind: "self-off" }
	| { kind: "self-on" }
	| { kind: "unknown"; message: string }
	| { kind: "needs-scopes"; scopes: string[]; siteSettings: string | null };

export type AgentsState =
	| { kind: "on"; mcpUrl: string }
	| {
			kind: "off";
			canEnable: boolean;
			scopes: string[];
			siteSettings: string | null;
	  }
	| { kind: "self-hosted" }
	| { kind: "in-use"; host: string };

const AGENT_SCOPES = ["project.read", "project.write"];

function missing(scopes: string[]) {
	const held = keyScopes();
	if (held === null) return [];
	return scopes.filter((s) => !held.includes(s));
}

function siteSettingsLink() {
	const { siteId, endpoint } = appwriteEnv();
	return siteId && isCloudEndpoint(endpoint) ? consoleUrl("/settings") : null;
}

async function vectorsState(
	settings: SettingsRow | null,
): Promise<VectorsState> {
	const health = await vectorsHealth(settings);
	if (health !== "off") return { kind: "on", spec: null, status: health };
	const needs = missing([
		"vectorsdb.read",
		"vectorsdb.write",
		...VECTOR_SCOPE_NAMES,
	]);
	if (needs.length)
		return {
			kind: "needs-scopes",
			scopes: [...new Set(needs)],
			siteSettings: siteSettingsLink(),
		};
	const capability = await probeVectors();
	if (capability.kind === "paid")
		return { kind: "off", specs: capability.specs };
	if (capability.kind === "self-on") return { kind: "self-on" };
	if (capability.kind === "free-plan") return { kind: "free-plan" };
	if (capability.kind === "self-off") return { kind: "self-off" };
	return { kind: "unknown", message: capability.message };
}

// Whether this project's OAuth server can serve agents, and whether this site is the one using it.
export async function agentsState(
	settings: SettingsRow | null,
): Promise<AgentsState> {
	const { mcpUrl } = await import("#/server/oauth");
	if (settings?.agents) return { kind: "on", mcpUrl: await mcpUrl() };
	const needs = missing(AGENT_SCOPES);
	const { endpoint, projectId } = appwriteEnv();
	const meta = await fetch(
		`${endpoint}/oauth2/${projectId}/.well-known/oauth-authorization-server`,
		{
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(8000),
		},
	).catch(() => null);
	if (!meta || !meta.ok) return { kind: "self-hosted" };
	if (needs.length)
		return {
			kind: "off",
			canEnable: false,
			scopes: needs,
			siteSettings: siteSettingsLink(),
		};
	const project = await new Project(adminClient()).get().catch(() => null);
	if (!project)
		return {
			kind: "off",
			canEnable: false,
			scopes: AGENT_SCOPES,
			siteSettings: siteSettingsLink(),
		};
	const decided = decideAgents(project as RawProject, consentUrl());
	if (decided.kind === "in-use") return { kind: "in-use", host: decided.host };
	if (decided.kind === "self-hosted") return { kind: "self-hosted" };
	return {
		kind: "off",
		canEnable: true,
		scopes: [],
		siteSettings: siteSettingsLink(),
	};
}

export async function loadFeatures(workspaceId: string) {
	const { viewer } = await requireWorkspace(workspaceId);
	const settings = await readSettings();
	const [vectors, agents, canChange] = await Promise.all([
		vectorsState(settings),
		agentsState(settings),
		isInstanceOwner(viewer.userId),
	]);
	return {
		flags: parseFlags(settings),
		vectors,
		agents,
		canChange,
		signup: settings?.signup ?? "invite",
	};
}

export async function updateFlag(name: keyof FeatureFlags, value: boolean) {
	await requireInstanceOwner();
	const settings = await readSettings();
	const flags = { ...parseFlags(settings), [name]: value };
	await new TablesDB(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { features: JSON.stringify(flags) },
	});
	return flags;
}

export async function updateSignup(signup: "invite" | "open") {
	await requireInstanceOwner();
	await new TablesDB(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { signup },
	});
	return signup;
}

async function vectorsCall(method: "POST" | "DELETE", body?: unknown) {
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(
		`${endpoint}/vectorsdb${method === "DELETE" ? "/vectors" : ""}`,
		{
			method,
			headers: {
				"x-appwrite-project": projectId,
				"x-appwrite-key": siteKey() ?? "",
				"content-type": "application/json",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(25_000),
		},
	);
	if (
		res.ok ||
		res.status === 409 ||
		(method === "DELETE" && res.status === 404)
	)
		return;
	const json = (await res.json().catch(() => ({}))) as {
		message?: string;
		type?: string;
	};
	if (json.type === "billing_payment_method_not_found")
		throw new Error(
			"This Appwrite organization has no payment method. Add one in the Appwrite Console and try again.",
		);
	throw new Error(json.message || `Appwrite answered ${res.status}.`);
}

// The database id lives next to the flag: searching and indexing read it from there.
async function saveVectorsSetting(on: boolean, specification: string | null) {
	const settings = await readSettings();
	await new TablesDB(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: {
			vectors: on,
			vectorsSpecification: specification,
			features: JSON.stringify({
				...parseFlags(settings),
				vectorsDatabase: on ? "vectors" : null,
			}),
		},
	});
	forgetVectorsHealth();
}

export async function enableVectors(specification: string | null) {
	await requireInstanceOwner();
	await vectorsCall("POST", {
		databaseId: "vectors",
		name: "Livepage search",
		...(specification ? { specification } : {}),
	});
	await saveVectorsSetting(true, specification);
}

export async function disableVectors() {
	await requireInstanceOwner();
	await vectorsCall("DELETE");
	await saveVectorsSetting(false, null);
}

const BUILT_IN_SCOPES = ["openid", "profile", "email", "phone"];

export async function enableAgents() {
	await requireInstanceOwner();
	const project = new Project(adminClient());
	const current = await project.get();
	const ours = consentUrl();
	const theirs = current.oAuth2ServerAuthorizationUrl || "";
	if (current.oAuth2ServerEnabled && theirs && theirs !== ours)
		throw new Error(
			`The OAuth server in this project is already used by ${new URL(theirs).host}.`,
		);
	const scopes = (current.oAuth2ServerScopes ?? []).filter(
		(s) => !BUILT_IN_SCOPES.includes(s),
	);
	await project.updateOAuth2Server({
		enabled: true,
		authorizationUrl: ours,
		scopes: [...new Set([...scopes, MCP_SCOPE])],
		authorizationDetailsTypes:
			current.oAuth2ServerAuthorizationDetailsTypes ?? [],
		accessTokenDuration: current.oAuth2ServerAccessTokenDuration ?? null,
		refreshTokenDuration: current.oAuth2ServerRefreshTokenDuration ?? null,
		publicAccessTokenDuration:
			current.oAuth2ServerPublicAccessTokenDuration ?? null,
		publicRefreshTokenDuration:
			current.oAuth2ServerPublicRefreshTokenDuration ?? null,
		installationAccessTokenDuration:
			current.oAuth2ServerInstallationAccessTokenDuration ?? null,
		confidentialPkce: current.oAuth2ServerConfidentialPkce ?? null,
		verificationUrl: current.oAuth2ServerVerificationUrl || undefined,
		userCodeLength: current.oAuth2ServerUserCodeLength ?? null,
		userCodeFormat: current.oAuth2ServerUserCodeFormat || undefined,
		deviceCodeDuration: current.oAuth2ServerDeviceCodeDuration ?? null,
		defaultScopes: current.oAuth2ServerDefaultScopes ?? [],
		installationScopes: current.oAuth2ServerInstallationScopes ?? [],
	});
	await new TablesDB(adminClient()).updateRow({
		databaseId: DATABASE_ID,
		tableId: SETTINGS,
		rowId: SETTINGS_ROW,
		data: { agents: true },
	});
}
