// Works out what this Appwrite project can actually do by asking its API. Never by hostname.
// The decide* functions are pure so real recorded responses can be tested without a server.

import type {
	AgentsCapability,
	Capabilities,
	EmbeddingsSource,
	VectorSpec,
	VectorsCapability,
} from "#/lib/setup-types";
import { appwriteEnv, siteKey, siteOrigin } from "./appwrite";

export type ApiResult = {
	status: number;
	type: string;
	json: Record<string, unknown>;
};

async function api(
	method: "GET" | "POST",
	path: string,
	body?: unknown,
	auth = true,
): Promise<ApiResult> {
	const { endpoint, projectId } = appwriteEnv();
	const headers: Record<string, string> = {
		"x-appwrite-project": projectId,
	};
	if (auth) headers["x-appwrite-key"] = siteKey() ?? "";
	if (body !== undefined) headers["content-type"] = "application/json";
	try {
		const res = await fetch(`${endpoint}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(12_000),
		});
		const json = (await res.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		return { status: res.status, type: String(json.type ?? ""), json };
	} catch {
		return { status: 0, type: "unreachable", json: {} };
	}
}

// ---------- VectorsDB ----------

type RawSpec = {
	slug: string;
	name: string;
	price: number;
	cpu: number;
	memory: number;
	includedStorage: number;
	enabled: boolean;
};

export function toVectorSpec(raw: RawSpec): VectorSpec {
	return {
		slug: raw.slug,
		name: raw.name,
		cpu: Math.round(raw.cpu / 1000),
		memoryGb: Math.round(raw.memory / 1024),
		storageGb: raw.includedStorage,
		price: raw.price,
	};
}

// Cloud answers the specifications route with live prices. On self-hosted Appwrite that route
// doesn't exist, so the request is read as a database ID: 404 means VectorsDB is on and the
// database wasn't found, and 403 general_service_disabled means VectorsDB is off.
export function decideVectors(
	specs: ApiResult,
	list: ApiResult | null,
): VectorsCapability {
	if (specs.status === 200) {
		const all = (specs.json.specifications ?? []) as RawSpec[];
		const enabled = all.filter((s) => s.enabled);
		return enabled.length
			? { kind: "paid", specs: enabled.map(toVectorSpec) }
			: { kind: "free-plan" };
	}
	if (specs.type === "general_service_disabled") return { kind: "self-off" };
	if (list?.status === 200) return { kind: "self-on" };
	if (list?.type === "general_service_disabled") return { kind: "self-off" };
	return {
		kind: "unknown",
		message: `Couldn't read this project's vector database options (${specs.status || "no response"}).`,
	};
}

export async function probeVectors(): Promise<VectorsCapability> {
	const specs = await api("GET", "/vectorsdb/specifications");
	const list =
		specs.status === 200 || specs.type === "general_service_disabled"
			? null
			: await api("GET", "/vectorsdb");
	return decideVectors(specs, list);
}

// ---------- OAuth2 server ----------

export type RawProject = {
	oAuth2ServerEnabled?: boolean;
	oAuth2ServerAuthorizationUrl?: string;
};

export function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function decideAgents(
	project: RawProject,
	consentUrl: string,
): AgentsCapability {
	// The attribute only exists on Appwrite Cloud.
	if (project.oAuth2ServerEnabled === undefined) return { kind: "self-hosted" };
	const theirs = project.oAuth2ServerAuthorizationUrl || "";
	if (project.oAuth2ServerEnabled && theirs && theirs !== consentUrl)
		return { kind: "in-use", host: hostOf(theirs) };
	return { kind: "available", ours: project.oAuth2ServerEnabled === true };
}

// ---------- embeddings ----------

export function decideEmbeddings(
	providerHasEmbeddings: boolean,
	appwrite: ApiResult | null,
): EmbeddingsSource {
	if (providerHasEmbeddings) return "provider";
	if (appwrite?.status === 200) return "appwrite";
	return "none";
}

// One short text. Self-hosted Appwrite without the embedding profile answers 503 or 403 here.
function probeAppwriteEmbeddings() {
	return api("POST", "/embeddings/text", { texts: ["probe"] });
}

// ---------- the browser's origin ----------

// Appwrite rejects a browser origin that isn't a platform or one of the project's own domains.
export function decideOrigin(result: ApiResult): "allowed" | "blocked" {
	return result.status === 403 && result.type === "general_unknown_origin"
		? "blocked"
		: "allowed";
}

export async function probeOrigin(): Promise<"allowed" | "blocked"> {
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(`${endpoint}/health/version`, {
		headers: { "x-appwrite-project": projectId, origin: siteOrigin() },
		signal: AbortSignal.timeout(8_000),
	}).catch(() => null);
	if (!res) return "allowed";
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	return decideOrigin({
		status: res.status,
		type: String(json.type ?? ""),
		json,
	});
}

// ---------- summary ----------

export function summarize(
	vectors: VectorsCapability,
	agents: AgentsCapability,
): string {
	switch (vectors.kind) {
		case "paid":
			return "Appwrite Cloud, on a paid plan.";
		case "free-plan":
			return "Appwrite Cloud, on the Free plan.";
		case "self-on":
			return "self-hosted Appwrite, with VectorsDB on.";
		case "self-off":
			return "self-hosted Appwrite.";
		default:
			return agents.kind === "self-hosted"
				? "self-hosted Appwrite."
				: "Appwrite Cloud.";
	}
}

export async function detectCapabilities(
	project: RawProject,
	consentUrl: string,
	providerHasEmbeddings: boolean,
): Promise<Capabilities> {
	const vectors = await probeVectors();
	const agents = decideAgents(project, consentUrl);
	const embeddings = decideEmbeddings(
		providerHasEmbeddings,
		providerHasEmbeddings ? null : await probeAppwriteEmbeddings(),
	);
	return {
		vectors,
		agents,
		embeddings,
		summary: summarize(vectors, agents),
	};
}
