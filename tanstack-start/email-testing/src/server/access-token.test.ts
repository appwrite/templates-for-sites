import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	bearerToken,
	type Jwk,
	metadataUrl,
	protectedResourceMetadata,
	TokenError,
	verifyAccessToken,
	wwwAuthenticate,
} from "./access-token";

const ISSUER = "https://cloud.appwrite.io/v1/oauth2/demo";
const RESOURCE = "https://inbox.example.dev/mcp";
const NOW = 1_793_700_000;

function keyPair(kid: string) {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const jwk = {
		...(publicKey.export({ format: "jwk" }) as Jwk),
		kid,
		use: "sig",
		alg: "RS256",
	};
	return { jwk, privateKey };
}

const main = keyPair("k1");
const other = keyPair("k2");

const b64 = (value: object) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
	payload: Record<string, unknown> = {},
	header: Record<string, unknown> = {},
	key = main.privateKey,
) {
	const h = b64({ alg: "RS256", typ: "at+jwt", kid: "k1", ...header });
	const p = b64({
		iss: ISSUER,
		sub: "u_admin",
		aud: ["https://cloud.appwrite.io/v1/demo", RESOURCE],
		client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
		scope: "openid catchall.read",
		iat: NOW - 10,
		exp: NOW + 3600,
		jti: "abc",
		...payload,
	});
	const signature = sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString(
		"base64url",
	);
	return `${h}.${p}.${signature}`;
}

const options = {
	keys: [main.jwk, other.jwk],
	issuer: ISSUER,
	resource: RESOURCE,
	now: NOW,
};

function rejects(t: string, code: TokenError["code"], opts = options) {
	try {
		verifyAccessToken(t, opts);
	} catch (err) {
		expect(err).toBeInstanceOf(TokenError);
		expect((err as TokenError).code).toBe(code);
		return (err as TokenError).message;
	}
	throw new Error("expected the token to be rejected");
}

describe("verifyAccessToken", () => {
	it("accepts a token from the issuer for this resource", () => {
		expect(verifyAccessToken(token(), options)).toEqual({
			userId: "u_admin",
			clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
			scopes: ["openid", "catchall.read"],
			expiresAt: NOW + 3600,
		});
	});

	it("accepts the long form of the access token type", () => {
		expect(
			verifyAccessToken(token({}, { typ: "application/at+jwt" }), options)
				.userId,
		).toBe("u_admin");
	});

	it("rejects a token for another resource", () => {
		expect(
			rejects(
				token({ aud: ["https://cloud.appwrite.io/v1/demo"] }),
				"invalid_token",
			),
		).toMatch(/not issued for this server/);
		rejects(token({ aud: "https://evil.example/mcp" }), "invalid_token");
	});

	it("rejects a token from another issuer", () => {
		rejects(
			token({ iss: "https://cloud.appwrite.io/v1/oauth2/other" }),
			"invalid_token",
		);
	});

	it("rejects an expired token, with a minute of leeway", () => {
		expect(verifyAccessToken(token({ exp: NOW - 30 }), options).userId).toBe(
			"u_admin",
		);
		expect(rejects(token({ exp: NOW - 61 }), "invalid_token")).toMatch(
			/expired/,
		);
	});

	it("rejects a token that isn't valid yet", () => {
		rejects(token({ nbf: NOW + 600 }), "invalid_token");
	});

	it("rejects a bad signature or an unknown key", () => {
		rejects(token({}, {}, other.privateKey), "invalid_token");
		rejects(token({}, { kid: "nope" }), "invalid_token");
		const t = token();
		const tampered = `${t.split(".")[0]}.${b64({ sub: "u_someone_else", iss: ISSUER, aud: [RESOURCE], scope: "catchall.read", exp: NOW + 60 })}.${t.split(".")[2]}`;
		rejects(tampered, "invalid_token");
	});

	it("refuses alg none and HMAC", () => {
		const h = b64({ alg: "none", typ: "at+jwt" });
		const p = b64({
			iss: ISSUER,
			sub: "u",
			aud: [RESOURCE],
			scope: "catchall.read",
			exp: NOW + 60,
		});
		rejects(`${h}.${p}.`, "invalid_token");
		rejects(token({}, { alg: "HS256" }), "invalid_token");
	});

	it("refuses ID tokens and other JWT types", () => {
		rejects(token({}, { typ: "JWT" }), "invalid_token");
	});

	it("needs the catchall.read scope", () => {
		expect(
			rejects(token({ scope: "openid email" }), "insufficient_scope"),
		).toMatch(/catchall\.read/);
	});

	it("needs a subject", () => {
		rejects(token({ sub: "" }), "invalid_token");
	});

	it("rejects garbage", () => {
		rejects("not.a.jwt", "invalid_token");
		rejects("abc", "invalid_token");
	});
});

describe("bearerToken", () => {
	it("finds the token, also next to the Sites runtime's own credentials", () => {
		expect(bearerToken("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
		expect(bearerToken("Bearer aaa.bbb.ccc, Basic dXNlcjpwYXNz")).toBe(
			"aaa.bbb.ccc",
		);
		expect(bearerToken("Basic dXNlcjpwYXNz, bearer aaa.bbb.ccc")).toBe(
			"aaa.bbb.ccc",
		);
		expect(bearerToken("Bearer ctk_123")).toBeNull();
		expect(bearerToken(null)).toBeNull();
	});
});

describe("protected resource metadata", () => {
	it("names the resource and the issuer", () => {
		expect(protectedResourceMetadata(RESOURCE, ISSUER)).toEqual({
			resource: RESOURCE,
			authorization_servers: [ISSUER],
			scopes_supported: ["catchall.read"],
			bearer_methods_supported: ["header"],
			resource_name: "Catchall",
		});
	});

	it("lives at the RFC 9728 path for the resource", () => {
		expect(metadataUrl(RESOURCE)).toBe(
			"https://inbox.example.dev/.well-known/oauth-protected-resource/mcp",
		);
		expect(metadataUrl("https://inbox.example.dev/")).toBe(
			"https://inbox.example.dev/.well-known/oauth-protected-resource",
		);
	});

	it("points 401s at it", () => {
		expect(wwwAuthenticate(RESOURCE)).toBe(
			'Bearer resource_metadata="https://inbox.example.dev/.well-known/oauth-protected-resource/mcp", scope="catchall.read"',
		);
		expect(
			wwwAuthenticate(RESOURCE, {
				code: "invalid_token",
				description: 'The "token" has expired.',
			}),
		).toBe(
			`Bearer error="invalid_token", resource_metadata="https://inbox.example.dev/.well-known/oauth-protected-resource/mcp", scope="catchall.read", error_description="The 'token' has expired."`,
		);
	});
});
