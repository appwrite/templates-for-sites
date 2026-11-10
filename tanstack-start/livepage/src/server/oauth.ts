// AI agents sign in with the project's Appwrite OAuth 2.1 server. This file holds the resource
// server side (checking access tokens on /mcp) and the consent screen's calls to that server.
import {
	Apps,
	type Client,
	type Models,
	Oauth2,
	Query,
	TablesDB,
	Users,
} from "node-appwrite";
import { rowHash } from "#/lib/permissions";
import {
	bearerToken,
	decodeJwt,
	type Jwk,
	MCP_SCOPE,
	protectedResourceMetadata,
	TokenError,
	verifyAccessToken,
	wwwAuthenticate,
} from "./access-token";
import { json } from "./api";
import {
	adminClient,
	appwriteEnv,
	errorCode,
	errorType,
	sessionClient,
} from "./appwrite";
import { consentUrl } from "./consent";
import { DATABASE_ID, TOKENS } from "./schema";
import { trustedOrigin } from "./settings";

export { consentUrl, MCP_SCOPE };

// The MCP address, which is also the audience tokens must carry, so it comes from the Site's
// recorded origin and never from a request header.
export async function mcpUrl() {
	return `${await trustedOrigin()}/mcp`;
}

// Headers for /mcp and its metadata. Tokens travel in the Authorization header, never in
// cookies, so letting any origin call is safe and lets browser-based MCP clients connect.
export const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers":
		"authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
	"access-control-expose-headers": "www-authenticate, mcp-session-id",
	"access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
};

// ---------- the authorization server's metadata and keys ----------

type ServerMetadata = {
	issuer: string;
	jwks_uri: string;
	authorization_endpoint: string;
	token_endpoint: string;
};

const METADATA_TTL_MS = 10 * 60_000;
const KEYS_TTL_MS = 10 * 60_000;
// An unknown key ID triggers a refetch, at most this often.
const KEYS_MIN_REFRESH_MS = 60_000;

let metadataCache: { value: ServerMetadata; at: number } | null = null;
let keysCache: { keys: Jwk[]; at: number; uri: string } | null = null;

// The issuer comes from Appwrite's own metadata, so this never guesses the domain or region.
export async function authorizationServer(): Promise<ServerMetadata | null> {
	if (metadataCache && Date.now() - metadataCache.at < METADATA_TTL_MS)
		return metadataCache.value;
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(
		`${endpoint}/oauth2/${projectId}/.well-known/oauth-authorization-server`,
		{ headers: { accept: "application/json" } },
	);
	if (!res.ok) return null;
	const value = (await res.json()) as ServerMetadata;
	if (!value?.issuer || !value.jwks_uri) return null;
	metadataCache = { value, at: Date.now() };
	return value;
}

async function signingKeys(meta: ServerMetadata, kid?: string) {
	const cached = keysCache?.uri === meta.jwks_uri ? keysCache : null;
	const stale = !cached || Date.now() - cached.at > KEYS_TTL_MS;
	const unknownKid =
		Boolean(kid) &&
		Boolean(cached) &&
		!cached?.keys.some((k) => k.kid === kid) &&
		Date.now() - (cached?.at ?? 0) > KEYS_MIN_REFRESH_MS;
	if (cached && !stale && !unknownKid) return cached.keys;
	// The issuer names the public host, which this server may not reach; its own endpoint always works.
	const keysUrl = new URL(meta.jwks_uri);
	const { host, protocol } = new URL(appwriteEnv().endpoint);
	keysUrl.host = host;
	keysUrl.protocol = protocol;
	const res = await fetch(keysUrl, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		if (cached) return cached.keys;
		throw new Error(`Couldn't load the OAuth server's keys (${res.status}).`);
	}
	const body = (await res.json()) as { keys?: Jwk[] };
	keysCache = { keys: body.keys || [], at: Date.now(), uri: meta.jwks_uri };
	return keysCache.keys;
}

// ---------- connected agents ----------

// One row per person and agent, in the tokens table, keyed by a hash of the pair. `expiresAt` in the
// past means disconnected: the agent's tokens stop working here at once, and it has to ask again.
type ConnectionRow = Models.Row & {
	name: string | null;
	hash: string;
	createdBy: string;
	createdByName: string | null;
	expiresAt: string;
	lastUsedAt: string | null;
};

const CONNECTED_UNTIL = "2099-01-01T00:00:00.000+00:00";
const LAST_USED_EVERY_MS = 60_000;

export const connectionId = (userId: string, clientId: string) =>
	rowHash("agent", userId, clientId).slice(0, 32);

function isActive(row: ConnectionRow) {
	return Date.parse(row.expiresAt) > Date.now();
}

export async function recordConnection(
	userId: string,
	userName: string,
	clientId: string,
	clientName: string,
) {
	const id = connectionId(userId, clientId);
	await new TablesDB(adminClient()).upsertRow({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		rowId: id,
		data: {
			name: clientName.slice(0, 64),
			hash: id,
			createdBy: userId,
			createdByName: userName.slice(0, 128),
			expiresAt: CONNECTED_UNTIL,
		},
	});
}

export async function markUsed(connectionRow: ConnectionRow) {
	if (
		connectionRow.lastUsedAt &&
		Date.now() - Date.parse(connectionRow.lastUsedAt) < LAST_USED_EVERY_MS
	)
		return;
	await new TablesDB(adminClient())
		.updateRow({
			databaseId: DATABASE_ID,
			tableId: TOKENS,
			rowId: connectionRow.$id,
			data: { lastUsedAt: new Date().toISOString() },
		})
		.catch(() => undefined);
}

export type ConnectedAgent = {
	id: string;
	name: string;
	connectedBy: string;
	connectedByName: string;
	lastUsedAt: string | null;
	createdAt: string;
};

export async function listConnectedAgents(userIds: string[]) {
	if (!userIds.length) return [];
	const out: ConnectedAgent[] = [];
	const db = new TablesDB(adminClient());
	for (let i = 0; i < userIds.length; i += 100) {
		const { rows } = await db.listRows<ConnectionRow>({
			databaseId: DATABASE_ID,
			tableId: TOKENS,
			queries: [
				Query.equal("createdBy", userIds.slice(i, i + 100)),
				Query.orderDesc("$updatedAt"),
				Query.limit(200),
			],
		});
		for (const row of rows)
			if (isActive(row))
				out.push({
					id: row.$id,
					name: row.name || "An AI agent",
					connectedBy: row.createdBy,
					connectedByName: row.createdByName || "Someone",
					lastUsedAt: row.lastUsedAt || null,
					createdAt: row.$createdAt,
				});
	}
	return out;
}

// Stops a connection here at once. The person's own consent is removed too, so a reconnect asks again.
export async function disconnectAgent(
	connectionRowId: string,
	byUserId: string,
	byManager: boolean,
	session: Client,
	workspaceMembers: string[],
) {
	const db = new TablesDB(adminClient());
	const row = await db.getRow<ConnectionRow>({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		rowId: connectionRowId,
	});
	const manages = byManager && workspaceMembers.includes(row.createdBy);
	if (!manages && row.createdBy !== byUserId)
		throw new Error("Only the person who connected this agent can remove it.");
	await db.updateRow({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		rowId: connectionRowId,
		data: { expiresAt: new Date().toISOString() },
	});
	if (row.createdBy === byUserId) {
		const { Account } = await import("node-appwrite");
		const account = new Account(session);
		const { consents } = await account
			.listConsents({ queries: [Query.limit(100)] })
			.catch(() => ({ consents: [] as Models.Oauth2Consent[] }));
		await Promise.all(
			consents
				.filter((c) => connectionId(byUserId, c.appId || c.cimdUrl) === row.$id)
				.map((c) => account.deleteConsent({ consentId: c.$id })),
		).catch(() => undefined);
	}
}

// ---------- checking a request to /mcp ----------

export type McpCaller = {
	userId: string;
	clientId: string;
	name: string;
	jwt: string;
};

function unauthorized(resource: string, error?: TokenError) {
	return json(
		{
			error: error?.code ?? "invalid_token",
			error_description:
				error?.message ??
				"Sign in first. This server uses OAuth: your MCP client opens a browser to connect.",
		},
		error?.code === "insufficient_scope" ? 403 : 401,
		{
			...CORS_HEADERS,
			"www-authenticate": wwwAuthenticate(
				resource,
				error ? { code: error.code, description: error.message } : undefined,
			),
		},
	);
}

const JWT_SECONDS = 600;
const jwtCache = new Map<string, { jwt: string; expires: number }>();

// A short-lived JWT for the person who connected the agent. Every read and write the tools make
// runs with it, so Appwrite's own permissions decide what the agent can do.
async function userJwt(userId: string) {
	const cached = jwtCache.get(userId);
	if (cached && cached.expires - Date.now() > 60_000) return cached.jwt;
	const { jwt } = await new Users(adminClient()).createJWT({
		userId,
		duration: JWT_SECONDS,
	});
	if (jwtCache.size > 500) jwtCache.clear();
	jwtCache.set(userId, { jwt, expires: Date.now() + JWT_SECONDS * 1000 });
	return jwt;
}

export async function authenticateMcp(
	request: Request,
): Promise<{ caller: McpCaller } | { response: Response }> {
	const resource = await mcpUrl();
	const token = bearerToken(request.headers.get("authorization"));
	if (!token) return { response: unauthorized(resource) };

	const meta = await authorizationServer().catch(() => null);
	if (!meta)
		return {
			response: json(
				{
					error: "temporarily_unavailable",
					error_description:
						"Couldn't reach this project's OAuth server. Check that it's turned on in Auth settings.",
				},
				503,
				CORS_HEADERS,
			),
		};

	let claims: ReturnType<typeof verifyAccessToken>;
	try {
		const kid = decodeJwt(token).header.kid;
		const keys = await signingKeys(
			meta,
			typeof kid === "string" ? kid : undefined,
		);
		claims = verifyAccessToken(token, {
			keys,
			issuer: meta.issuer,
			resource,
			scope: MCP_SCOPE,
		});
	} catch (err) {
		if (err instanceof TokenError)
			return { response: unauthorized(resource, err) };
		throw err;
	}

	// The token says who. The connection row says whether they've since disconnected this agent.
	const db = new TablesDB(adminClient());
	const rowId = connectionId(claims.userId, claims.clientId);
	let connection: ConnectionRow;
	try {
		connection = await db.getRow<ConnectionRow>({
			databaseId: DATABASE_ID,
			tableId: TOKENS,
			rowId,
		});
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
		return {
			response: unauthorized(
				resource,
				new TokenError("This agent isn't connected.", "invalid_token"),
			),
		};
	}
	if (!isActive(connection))
		return {
			response: unauthorized(
				resource,
				new TokenError(
					"This agent was disconnected. Connect it again from your MCP client.",
					"invalid_token",
				),
			),
		};
	void markUsed(connection);

	let jwt: string;
	try {
		jwt = await userJwt(claims.userId);
	} catch (err) {
		if (errorCode(err) === 404)
			return {
				response: unauthorized(
					resource,
					new TokenError("This account no longer exists.", "invalid_token"),
				),
			};
		if (errorType(err) === "general_unauthorized_scope")
			return {
				response: json(
					{
						error: "server_error",
						error_description:
							"This site's key is missing the users.write scope. Add it to the site in the Appwrite Console.",
					},
					500,
					CORS_HEADERS,
				),
			};
		throw err;
	}
	return {
		caller: {
			userId: claims.userId,
			clientId: claims.clientId,
			name: connection.createdByName || "Someone",
			jwt,
		},
	};
}

// ---------- the consent screen ----------

export type ConsentClient = {
	id: string;
	name: string;
	// Set for clients whose ID is the URL of their metadata (CIMD): the name is only the host.
	metadataUrl: string | null;
	website: string | null;
};

export type ConsentGrant = {
	grantId: string;
	client: ConsentClient;
	scopes: string[];
	resources: string[];
	redirectUri: string;
	expire: string;
};

export function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

// Asks the OAuth server to authorize the request the agent started, as the signed-in person. It
// answers with a grant to show on the consent screen, or with a redirect when this person already
// approved the same client, scopes and resources.
export async function beginAuthorization(
	secret: string,
	query: URLSearchParams,
) {
	const get = (key: string) => query.get(key) ?? undefined;
	const maxAge = query.get("max_age");
	const resources = query.getAll("resource");
	const result = await new Oauth2(sessionClient(secret)).authorize({
		clientId: get("client_id"),
		redirectUri: get("redirect_uri"),
		responseType: get("response_type"),
		scope: get("scope"),
		state: get("state"),
		nonce: get("nonce"),
		codeChallenge: get("code_challenge"),
		codeChallengeMethod: get("code_challenge_method"),
		prompt: get("prompt"),
		maxAge: maxAge !== null && maxAge !== "" ? Number(maxAge) : undefined,
		authorizationDetails: get("authorization_details"),
		resource: resources.length ? resources : undefined,
		audience: get("audience"),
		requestUri: get("request_uri"),
	});
	return {
		grantId: result.grantId || null,
		redirectUrl: result.redirectUrl || null,
	};
}

export async function clientInfo(
	secret: string,
	appId: string,
): Promise<ConsentClient> {
	// A client ID that is a URL points at the client's own metadata document (CIMD).
	if (/^https?:\/\//i.test(appId))
		return {
			id: appId,
			name: hostOf(appId),
			metadataUrl: appId,
			website: null,
		};
	try {
		const app: Models.App = await new Apps(sessionClient(secret)).get({
			appId,
		});
		return {
			id: appId,
			name: app.name || appId,
			metadataUrl: null,
			website: app.clientUri || null,
		};
	} catch {
		return { id: appId, name: "An AI agent", metadataUrl: null, website: null };
	}
}

export async function readGrant(
	secret: string,
	grantId: string,
): Promise<ConsentGrant> {
	const grant = await new Oauth2(sessionClient(secret)).getGrant({ grantId });
	return {
		grantId,
		client: await clientInfo(secret, grant.appId),
		scopes: grant.scopes,
		resources: grant.resources,
		redirectUri: grant.redirectUri,
		expire: grant.expire,
	};
}

export async function decideGrant(
	secret: string,
	grantId: string,
	approve: boolean,
) {
	const oauth = new Oauth2(sessionClient(secret));
	const result = approve
		? await oauth.approve({ grantId })
		: await oauth.reject({ grantId });
	return result.redirectUrl;
}

// Reasons this site won't approve a grant, shown on the consent screen with only a Cancel button.
export function grantProblems(grant: ConsentGrant, resource: string) {
	const problems: string[] = [];
	if (!grant.resources.length)
		problems.push(
			"The agent didn't say which server it wants access to, so its token wouldn't work here. Update the MCP client and try again.",
		);
	const others = grant.resources.filter((r) => r !== resource);
	if (others.length)
		problems.push(
			`The agent asked for access to ${others.map(hostOf).join(", ")}, not this workspace at ${hostOf(resource)}. Connect it with ${resource}.`,
		);
	return problems;
}

export function friendlyOAuthError(err: unknown) {
	const code = errorCode(err);
	const type = errorType(err);
	if (type.includes("redirect_uri"))
		return "The agent sent a redirect address that its registration doesn't allow. Reconnect it from the MCP client.";
	if (type.includes("client"))
		return "This project's OAuth server doesn't know this agent. Reconnect it from the MCP client.";
	if (type.includes("scope"))
		return "The agent asked for a permission Livepage doesn't offer.";
	if (type.includes("grant") || code === 404)
		return "This sign-in request expired. Start again from the MCP client.";
	if (err instanceof Error && err.message) return err.message;
	return "Something went wrong with this sign-in request. Start again from the MCP client.";
}

// RFC 9728: tells MCP clients which authorization server issues tokens for /mcp.
export async function protectedResourceResponse() {
	const meta = await authorizationServer().catch(() => null);
	if (!meta)
		return json(
			{
				error: "temporarily_unavailable",
				error_description:
					"This project's OAuth server isn't reachable or isn't turned on.",
			},
			503,
			CORS_HEADERS,
		);
	return json(protectedResourceMetadata(await mcpUrl(), meta.issuer), 200, {
		...CORS_HEADERS,
		"cache-control": "public, max-age=300",
	});
}
