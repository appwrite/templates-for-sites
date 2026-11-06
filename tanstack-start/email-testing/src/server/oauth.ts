// AI agents sign in with the project's Appwrite OAuth 2.1 server. This file holds the resource
// server side (checking access tokens on /mcp) and the consent screen's calls to that server.
import { Apps, type Models, Oauth2, Query, Teams } from "node-appwrite";
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
	siteOrigin,
} from "./appwrite";
import { TEAM_ID } from "./schema";

export function mcpUrl(origin = siteOrigin()) {
	return `${origin}/mcp`;
}

export function consentUrl(origin = siteOrigin()) {
	return `${origin}/consent`;
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
	const res = await fetch(meta.jwks_uri, {
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

// ---------- checking a request to /mcp ----------

export type McpCaller = { userId: string; clientId: string };

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

export async function authenticateMcp(
	request: Request,
): Promise<{ caller: McpCaller } | { response: Response }> {
	const resource = mcpUrl();
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

	// The token says who. The team says whether they still have access, checked on every request,
	// so removing someone from the team cuts their agents off at once.
	try {
		const { memberships } = await new Teams(adminClient()).listMemberships({
			teamId: TEAM_ID,
			queries: [Query.equal("userId", [claims.userId]), Query.limit(1)],
		});
		if (!memberships.some((m) => m.confirm))
			return {
				response: json(
					{
						error: "access_denied",
						error_description:
							"This account isn't a member of the Catchall team. Ask an admin for an invite.",
					},
					403,
					CORS_HEADERS,
				),
			};
	} catch (err) {
		if (errorType(err) === "general_unauthorized_scope")
			return {
				response: json(
					{
						error: "server_error",
						error_description:
							"This site's key is missing the teams.read scope. Add it to the site in the Appwrite Console.",
					},
					500,
					CORS_HEADERS,
				),
			};
		throw err;
	}
	return { caller: { userId: claims.userId, clientId: claims.clientId } };
}

// ---------- the consent screen ----------

export type ConsentClient = {
	id: string;
	name: string;
	// Set for clients whose ID is the URL of their metadata (CIMD): the name is only the host.
	metadataUrl: string | null;
	website: string | null;
	logo: string | null;
};

export type ConsentGrant = {
	grantId: string;
	client: ConsentClient;
	scopes: string[];
	resources: string[];
	redirectUri: string;
	expire: string;
};

function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

// Asks the OAuth server to authorize the request the agent started, as the signed-in person.
// It answers with a grant to show on the consent screen, or with a redirect when this person
// already approved the same client, scopes and resources.
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

async function clientInfo(
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
			logo: null,
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
			logo: app.logoUri || null,
		};
	} catch {
		return {
			id: appId,
			name: "An AI agent",
			metadataUrl: null,
			website: null,
			logo: null,
		};
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

// Reasons this site won't approve a grant, shown on the consent screen with only a Deny button.
export function grantProblems(grant: ConsentGrant, resource: string) {
	const problems: string[] = [];
	if (!grant.resources.length)
		problems.push(
			"The agent didn't say which server it wants access to, so its token wouldn't work here. Update the MCP client and try again.",
		);
	const others = grant.resources.filter((r) => r !== resource);
	if (others.length)
		problems.push(
			`The agent asked for access to ${others.map(hostOf).join(", ")}, not this inbox at ${hostOf(resource)}. Connect it with ${resource}.`,
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
		return "The agent asked for a permission this inbox doesn't offer.";
	if (type.includes("grant") || code === 404)
		return "This sign-in request expired. Start again from the MCP client.";
	if (err instanceof Error && err.message) return err.message;
	return "Something went wrong with this sign-in request. Start again from the MCP client.";
}

export { hostOf };

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
	return json(protectedResourceMetadata(mcpUrl(), meta.issuer), 200, {
		...CORS_HEADERS,
		"cache-control": "public, max-age=300",
	});
}
