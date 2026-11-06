// Checks OAuth 2.1 access tokens from the project's Appwrite OAuth server (RFC 9068 JWTs).
// No Appwrite or framework imports, so the checks are unit tested on their own.
import { createPublicKey, type JsonWebKey, verify } from "node:crypto";

// The one scope the MCP server asks for. A custom scope, so an access token that holds it
// grants nothing on Appwrite's own API.
export const MCP_SCOPE = "catchall.read";

export type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };

export type AccessClaims = {
	userId: string;
	clientId: string;
	scopes: string[];
	expiresAt: number; // seconds
};

export class TokenError extends Error {
	constructor(
		message: string,
		// invalid_token -> 401, insufficient_scope -> 403 (RFC 6750 section 3.1).
		readonly code: "invalid_token" | "insufficient_scope",
	) {
		super(message);
	}
}

// Pulls a JWT out of the Authorization header. On Appwrite Sites the runtime appends its own
// credentials, so the header can arrive as "Bearer <jwt>, Basic <...>".
export function bearerToken(header: string | null): string | null {
	if (!header) return null;
	const match = header.match(
		/(?:^|,)\s*Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i,
	);
	return match ? match[1] : null;
}

function decodePart(part: string) {
	return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function decodeJwt(token: string) {
	const parts = token.split(".");
	if (parts.length !== 3)
		throw new TokenError("Malformed token.", "invalid_token");
	try {
		return {
			header: decodePart(parts[0]) as Record<string, unknown>,
			payload: decodePart(parts[1]) as Record<string, unknown>,
			signingInput: `${parts[0]}.${parts[1]}`,
			signature: Buffer.from(parts[2], "base64url"),
		};
	} catch {
		throw new TokenError("Malformed token.", "invalid_token");
	}
}

// Leeway for clocks that disagree a little.
const SKEW_SECONDS = 60;

export function verifyAccessToken(
	token: string,
	options: {
		keys: Jwk[];
		issuer: string;
		// This server's resource identifier (the MCP URL). The token's `aud` must include it, so a
		// token minted for another resource can't be replayed here.
		resource: string;
		scope?: string;
		now?: number; // seconds
	},
): AccessClaims {
	const { header, payload, signingInput, signature } = decodeJwt(token);
	// Appwrite signs access tokens with RS256. Anything else, `none` included, is refused.
	if (header.alg !== "RS256")
		throw new TokenError("Unsupported signing algorithm.", "invalid_token");
	const typ = String(header.typ || "").toLowerCase();
	if (typ !== "at+jwt" && typ !== "application/at+jwt")
		throw new TokenError("Not an access token.", "invalid_token");

	const candidates = options.keys.filter(
		(key) =>
			key.kty === "RSA" &&
			(!key.use || key.use === "sig") &&
			(!header.kid || key.kid === header.kid),
	);
	const valid = candidates.some((jwk) => {
		try {
			const key = createPublicKey({ key: jwk, format: "jwk" });
			return verify("RSA-SHA256", Buffer.from(signingInput), key, signature);
		} catch {
			return false;
		}
	});
	if (!valid) throw new TokenError("Bad signature.", "invalid_token");

	const now = options.now ?? Math.floor(Date.now() / 1000);
	if (payload.iss !== options.issuer)
		throw new TokenError("Wrong issuer.", "invalid_token");
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audiences.includes(options.resource))
		throw new TokenError(
			"This token was not issued for this server.",
			"invalid_token",
		);
	const exp = Number(payload.exp);
	if (!Number.isFinite(exp) || exp + SKEW_SECONDS <= now)
		throw new TokenError("The token has expired.", "invalid_token");
	if (payload.nbf !== undefined && Number(payload.nbf) - SKEW_SECONDS > now)
		throw new TokenError("The token is not valid yet.", "invalid_token");
	const userId = typeof payload.sub === "string" ? payload.sub : "";
	if (!userId)
		throw new TokenError("The token has no subject.", "invalid_token");

	const scopes = String(payload.scope || "")
		.split(" ")
		.filter(Boolean);
	const required = options.scope ?? MCP_SCOPE;
	if (!scopes.includes(required))
		throw new TokenError(
			`The token needs the ${required} scope.`,
			"insufficient_scope",
		);

	return {
		userId,
		clientId: String(payload.client_id || ""),
		scopes,
		expiresAt: exp,
	};
}

// RFC 9728 protected resource metadata for the MCP endpoint.
export function protectedResourceMetadata(resource: string, issuer: string) {
	return {
		resource,
		authorization_servers: [issuer],
		scopes_supported: [MCP_SCOPE],
		bearer_methods_supported: ["header"],
		resource_name: "Catchall",
	};
}

// Where the metadata lives for a resource URL: /.well-known/oauth-protected-resource + its path.
export function metadataUrl(resource: string) {
	const url = new URL(resource);
	const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
	return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

// The WWW-Authenticate header for a 401 or 403 from the MCP endpoint (RFC 6750, RFC 9728).
export function wwwAuthenticate(
	resource: string,
	error?: { code: TokenError["code"]; description: string },
) {
	const parts = [
		`resource_metadata="${metadataUrl(resource)}"`,
		`scope="${MCP_SCOPE}"`,
	];
	if (error) {
		parts.unshift(`error="${error.code}"`);
		parts.push(`error_description="${error.description.replace(/"/g, "'")}"`);
	}
	return `Bearer ${parts.join(", ")}`;
}
