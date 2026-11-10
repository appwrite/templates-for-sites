import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
import { AppwriteException, Client } from "node-appwrite";

// Appwrite Sites sets these at runtime. The APPWRITE_* fallbacks are for running the site locally.
export function appwriteEnv() {
	const endpoint = (
		process.env.APPWRITE_SITE_API_ENDPOINT ||
		process.env.APPWRITE_ENDPOINT ||
		""
	).replace(/\/$/, "");
	const projectId =
		process.env.APPWRITE_SITE_PROJECT_ID ||
		process.env.APPWRITE_PROJECT_ID ||
		"";
	const siteId = process.env.APPWRITE_SITE_ID || "";
	const siteName = process.env.APPWRITE_SITE_NAME || "";
	return { endpoint, projectId, siteId, siteName };
}

// The URL browsers use to reach Appwrite. Deployed sites often see an internal address in
// APPWRITE_SITE_API_ENDPOINT, so self-hosters can set APPWRITE_PUBLIC_ENDPOINT to the public one.
export function publicEndpoint() {
	return (
		process.env.APPWRITE_PUBLIC_ENDPOINT || appwriteEnv().endpoint
	).replace(/\/$/, "");
}

export function isCloudEndpoint(endpoint: string) {
	try {
		const host = new URL(endpoint).hostname;
		return host === "cloud.appwrite.io" || host.endsWith(".cloud.appwrite.io");
	} catch {
		return false;
	}
}

export function consoleUrl(path: string) {
	const { endpoint, projectId, siteId } = appwriteEnv();
	let region = "";
	try {
		const host = new URL(endpoint).hostname;
		region = host.endsWith(".cloud.appwrite.io") ? host.split(".")[0] : "";
	} catch {
		// Leave the region out.
	}
	const project = region
		? `project-${region}-${projectId}`
		: `project-${projectId}`;
	return `https://cloud.appwrite.io/console/${project}/sites/site-${siteId}${path}`;
}

// Every request to a site on Appwrite Sites carries a short-lived key in this header.
// It holds the scopes set on the site, so changing the scopes in the Console applies on the next request.
export function siteKey(): string | null {
	return (
		getRequestHeader("x-appwrite-key") || process.env.APPWRITE_API_KEY || null
	);
}

// Returns the scopes inside the site's key, or null when the key is not a site key (for example a local API key).
export function keyScopes(key = siteKey()): string[] | null {
	if (!key?.startsWith("ephemeral_")) return null;
	try {
		const payload = key.slice("ephemeral_".length).split(".")[1];
		const decoded = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		);
		return Array.isArray(decoded.scopes) ? decoded.scopes : [];
	} catch {
		return [];
	}
}

export function siteOrigin() {
	return getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
}

function baseClient() {
	const { endpoint, projectId } = appwriteEnv();
	const client = new Client().setEndpoint(endpoint).setProject(projectId);
	// Appwrite accepts redirect URLs (password reset, invites) on hosts that belong to the project.
	// This site's domain is one of them, so requests name it as their origin.
	client.addHeader("Origin", siteOrigin());
	const userAgent = getRequestHeader("user-agent");
	if (userAgent) client.setForwardedUserAgent(userAgent);
	return client;
}

export function adminClient() {
	const key = siteKey();
	if (!key)
		throw new Error(
			"This request has no Appwrite key. Deploy the site on Appwrite Sites.",
		);
	return baseClient().setKey(key);
}

export function sessionClient(secret: string) {
	return baseClient().setSession(secret);
}

// No key and no session: Appwrite applies its normal sign-in limits to these requests.
export function guestClient() {
	return baseClient();
}

// Session endpoints answer with the session secret in a header. The SDK only returns the body, so these use fetch.
export async function createSessionRequest(
	path: string,
	method: "POST" | "PATCH" | "PUT",
	body: Record<string, unknown>,
) {
	const { endpoint, projectId } = appwriteEnv();
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"x-appwrite-project": projectId,
		origin: siteOrigin(),
	};
	const userAgent = getRequestHeader("user-agent");
	if (userAgent) headers["x-forwarded-user-agent"] = userAgent;
	const res = await fetch(`${endpoint}${path}`, {
		method,
		headers,
		body: JSON.stringify(body),
	});
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) {
		throw new AppwriteException(
			String(json.message || res.statusText),
			res.status,
			String(json.type || ""),
		);
	}
	const secret = readSecret(res, projectId);
	return { json, secret };
}

function readSecret(res: Response, projectId: string): string | null {
	const cookieName = `a_session_${projectId}`;
	const fallback = res.headers.get("x-fallback-cookies");
	if (fallback) {
		try {
			const parsed = JSON.parse(fallback);
			if (parsed[cookieName]) return parsed[cookieName];
		} catch {
			// Try the cookie instead.
		}
	}
	const cookies =
		typeof res.headers.getSetCookie === "function"
			? res.headers.getSetCookie()
			: [];
	for (const cookie of cookies) {
		const [pair] = cookie.split(";");
		const [name, ...rest] = pair.split("=");
		if (name.trim() === cookieName) return decodeURIComponent(rest.join("="));
	}
	return null;
}

export function errorCode(err: unknown): number {
	return err instanceof AppwriteException ? err.code : 0;
}

export function errorType(err: unknown): string {
	return err instanceof AppwriteException ? err.type : "";
}

export function errorMessage(err: unknown): string {
	if (err instanceof AppwriteException || err instanceof Error)
		return err.message;
	return String(err);
}
