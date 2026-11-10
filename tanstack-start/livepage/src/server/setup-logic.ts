// The parts of setup that are plain logic, so they can be tested without a server.
import { SETUP_ONLY_SCOPE_NAMES, VECTOR_SCOPE_NAMES } from "./schema";

// Appwrite's message for a missing scope names it: `missing scopes (["tables.read"])`.
export function missingScopeFrom(message: string): string | null {
	const match = message.match(/missing scopes \(\[?"?([a-zA-Z.]+)/);
	return match ? match[1] : null;
}

const looksLikeText = (id: string) =>
	!/embed|image|dall-e|whisper|tts|audio|moderation|rerank|transcribe|realtime/i.test(
		id,
	);
const looksLikeImage = (id: string) =>
	/image|dall-e|flux|sdxl|stable-diffusion/i.test(id);
const looksLikeEmbedding = (id: string) => /embed|bge|nomic/i.test(id);

export type ListedModel = { id: string; type?: string };

// What GET /models answered, in the shapes OpenAI-compatible providers use: most send
// { data: [...] }, Together sends the bare array. Null when it's neither.
export function listedModels(body: unknown): ListedModel[] | null {
	const list = Array.isArray(body)
		? body
		: (body as { data?: unknown } | null)?.data;
	if (!Array.isArray(list)) return null;
	return (list as { id?: unknown; type?: unknown }[])
		.map((m) => ({
			id: String(m?.id ?? ""),
			type: typeof m?.type === "string" ? m.type.toLowerCase() : undefined,
		}))
		.filter((m) => m.id);
}

// Some providers label each model. Only these labels say what a model does ("base" doesn't).
const MODEL_KINDS = new Set([
	"chat",
	"language",
	"code",
	"image",
	"video",
	"audio",
	"embedding",
	"rerank",
	"moderation",
	"transcribe",
]);

const isKind = (
	model: ListedModel,
	kind: string,
	byName: (id: string) => boolean,
) =>
	model.type && MODEL_KINDS.has(model.type)
		? model.type === kind
		: byName(model.id);

// Picks a sensible model of each kind from what the provider lists. A name the person typed in
// Advanced always wins.
export function pickModels(
	models: (string | ListedModel)[],
	overrides: {
		textModel?: string;
		imageModel?: string;
		embeddingModel?: string;
	} = {},
) {
	const list = models.map((m) => (typeof m === "string" ? { id: m } : m));
	const families = ["gpt", "claude", "gemini", "llama", "mistral"];
	const family = (id: string) => {
		const i = families.findIndex((p) => id.toLowerCase().includes(p));
		return i === -1 ? families.length : i;
	};
	// The first number in the id: 6.1 for gpt-6.1-sol, 2.6 for gpt-image-2.6.
	const version = (id: string) => Number(id.match(/\d+(\.\d+)?/)?.[0] ?? 0);
	// Newest first; among equals the shortest name, which is the plain model and not a variant.
	const newest = (a: string, b: string) =>
		version(b) - version(a) || a.length - b.length;
	const idsOf = (kind: string, byName: (id: string) => boolean) =>
		list.filter((m) => isKind(m, kind, byName)).map((m) => m.id);
	const text = idsOf("chat", looksLikeText).sort(
		(a, b) => family(a) - family(b) || newest(a, b),
	)[0];
	const image = idsOf("image", looksLikeImage).sort(newest)[0];
	const embedding = idsOf("embedding", looksLikeEmbedding).sort(newest)[0];
	return {
		textModel: overrides.textModel || text || "",
		imageModel: overrides.imageModel || image || "",
		embeddingModel: overrides.embeddingModel || embedding || "",
	};
}

export function maskKey(key: string) {
	if (key.length <= 12) return "•".repeat(Math.max(4, key.length));
	const dash = key.indexOf("-", 4);
	const prefix =
		dash > 0 && dash < 10 ? key.slice(0, dash + 1) : key.slice(0, 4);
	return `${prefix}${"•".repeat(16)}${key.slice(-4)}`;
}

// A dedicated database reports its compute status. Anything but a settled state still counts as
// starting, so setup can finish and the switch-over happens by itself.
export function vectorsReady(json: Record<string, unknown>) {
	const status = String(json.status ?? "available");
	return ["available", "ready", "online", ""].includes(status);
}

// Scopes the site keeps: everything it had minus the setup-only ones. Keeps VectorsDB's when
// search by meaning is on, because the running site needs them.
export function keptScopes(current: string[], vectors: boolean) {
	return current.filter(
		(s) =>
			!SETUP_ONLY_SCOPE_NAMES.includes(s) ||
			(vectors && VECTOR_SCOPE_NAMES.includes(s)),
	);
}

export function rangeCeiling(message: string): number | null {
	const match = message.match(/between \d+ and (\d+)/);
	return match ? Number(match[1]) : null;
}

// Provisioning gave up, so waiting longer won't help.
export function vectorsFailed(json: Record<string, unknown>) {
	return json.status === "failed";
}
