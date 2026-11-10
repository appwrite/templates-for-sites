// The AI provider layer and the AI features built on it. OpenAI-compatible only, so any provider
// that speaks the same API works. The key stays on the server: it's read from `secrets` with the
// Site's key and never leaves this module. Reads made for a person use that person's session.

import {
	ID,
	ImageFormat,
	type Models,
	Query,
	Storage,
	TablesDB,
} from "node-appwrite";
import {
	type AskSource,
	type AskTurn,
	askMessages,
	type ChatMessage,
	columnMessages,
	LIMITS,
	searchTerms,
	TEXT_ACTIONS,
	type TextAction,
	textMessages,
} from "#/features/ai/prompts";
import { isTrusted } from "#/features/editor/access";
import {
	canWriteDirect,
	cellPermissions,
	cellRowId,
	contentPermissions,
	rowHash,
} from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page, Role } from "#/lib/types";
import { adminClient, errorCode, type sessionClient } from "./appwrite";
import { AuthError, requireViewer, requireWorkspace } from "./auth";
import { embedPage, embedStale, searchByMeaning } from "./embeddings";
import { saveImageFile } from "./files";
import { assertPublicUrl } from "./net-guard";
import {
	AI_KEY_SECRET,
	AI_USAGE,
	BODIES,
	BUCKET_ID,
	CELLS,
	COMMENTS,
	DATABASE_ID,
	PAGES,
	PROPERTIES,
	SECRETS,
	SETTINGS,
	SETTINGS_ROW,
} from "./schema";
import { readSettings, type SettingsRow, vectorsHealth } from "./settings";
import { type ListedModel, listedModels, pickModels } from "./setup-logic";

export const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_TEXT_MODEL = "gpt-6-luna";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.6";

// Sites stop a request at 30 s, so everything here finishes before that and reports why.
const REQUEST_BUDGET_MS = 26_500;
const IMAGE_PROVIDER_BUDGET_MS = 27_000;
const PROBE_TIMEOUT_MS = 12_000;

export type AiErrorCode =
	| "not_configured"
	| "bad_key"
	| "rate_limited"
	| "no_credit"
	| "model_missing"
	| "timeout"
	| "unreachable"
	| "bad_endpoint"
	| "no_images"
	| "refused"
	| "too_large"
	| "bad_image"
	| "key_required"
	| "not_allowed"
	| "quota"
	| "provider";

export class AiError extends Error {
	constructor(
		readonly code: AiErrorCode,
		message: string,
		readonly status = 502,
	) {
		super(message);
	}
}

const MESSAGES: Record<AiErrorCode, string> = {
	not_configured: "AI isn't set up yet.",
	bad_key: "The AI key was rejected. Check it in Settings.",
	rate_limited:
		"The AI provider is rate limiting this key. Wait a moment and try again.",
	no_credit: "This AI key is out of credit.",
	model_missing: "That model isn't available from this provider.",
	timeout: "That took too long. Try again.",
	unreachable: "Couldn't reach the AI endpoint. Check the URL.",
	bad_endpoint: "That URL doesn't look like an OpenAI-compatible API.",
	no_images: "This model can't make images.",
	refused: "The AI provider refused this request.",
	too_large: "That image is too large to edit.",
	bad_image: "Only PNG, JPEG and WebP images can be edited.",
	key_required: "Enter the key again when you change the endpoint.",
	not_allowed: "You can't edit this page.",
	quota: "You've used today's AI allowance on this Site. Try again tomorrow.",
	provider: "The AI provider returned an error. Try again.",
};

const aiError = (code: AiErrorCode, status?: number, message?: string) =>
	new AiError(code, message ?? MESSAGES[code], status);

// ---------- Config ----------

export type AiConfig = {
	key: string;
	endpoint: string;
	textModel: string;
	imageModel: string;
	embeddingModel: string;
	images: boolean;
	ask: boolean;
	source: "workspace" | "site";
	// A private-network host the Site owner approved at setup, if any (see net-guard).
	privateHost?: string | null;
};

// A workspace's own settings, all in one `secrets` row. A workspace that has none uses the Site's.
type WorkspaceAi = {
	key: string;
	endpoint: string;
	textModel: string;
	imageModel: string;
	embeddingModel: string;
	images: boolean;
	ask: boolean;
};

export const workspaceRowId = (workspaceId: string) =>
	rowHash("ai", workspaceId);
const healthRowId = (workspaceId: string) => rowHash("ai-health", workspaceId);

type SecretRow = Models.Row & { value: string };

async function readSecret(rowId: string): Promise<string | null> {
	try {
		const row = await new TablesDB(adminClient()).getRow<SecretRow>({
			databaseId: DATABASE_ID,
			tableId: SECRETS,
			rowId,
		});
		return row.value || null;
	} catch (err) {
		if (errorCode(err) === 404) return null;
		throw err;
	}
}

async function writeSecret(rowId: string, value: string) {
	await new TablesDB(adminClient()).upsertRow({
		databaseId: DATABASE_ID,
		tableId: SECRETS,
		rowId,
		data: { value },
	});
}

async function deleteSecret(rowId: string) {
	await new TablesDB(adminClient())
		.deleteRow({ databaseId: DATABASE_ID, tableId: SECRETS, rowId })
		.catch((err) => {
			if (errorCode(err) !== 404) throw err;
		});
}

function parseWorkspaceAi(raw: string | null): WorkspaceAi | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<WorkspaceAi>;
		if (!parsed.key || !parsed.endpoint) return null;
		return {
			key: parsed.key,
			endpoint: parsed.endpoint,
			textModel: parsed.textModel || DEFAULT_TEXT_MODEL,
			imageModel: parsed.imageModel || DEFAULT_IMAGE_MODEL,
			embeddingModel: parsed.embeddingModel || "",
			images: Boolean(parsed.images),
			ask: parsed.ask !== false,
		};
	} catch {
		return null;
	}
}

export async function loadConfig(
	workspaceId: string,
): Promise<{ config: AiConfig | null; broken: boolean }> {
	const [settings, override, siteKey, health] = await Promise.all([
		readSettings(),
		readSecret(workspaceRowId(workspaceId)).catch(() => null),
		readSecret(AI_KEY_SECRET).catch(() => null),
		readSecret(healthRowId(workspaceId)).catch(() => null),
	]);
	const broken = Boolean(health);
	const own = parseWorkspaceAi(override);
	if (own)
		return {
			config: {
				...own,
				source: "workspace",
				privateHost: settings?.aiPrivateHost ?? null,
			},
			broken,
		};
	if (!settings?.aiEnabled || !siteKey) return { config: null, broken };
	return {
		broken,
		config: {
			key: siteKey,
			endpoint: settings.aiEndpoint || DEFAULT_ENDPOINT,
			textModel: settings.aiTextModel || DEFAULT_TEXT_MODEL,
			imageModel: settings.aiImageModel || DEFAULT_IMAGE_MODEL,
			embeddingModel: settings.aiEmbeddingModel || "",
			privateHost: settings.aiPrivateHost ?? null,
			images: settings.aiImages,
			ask: siteAsk(settings),
			source: "site",
		},
	};
}

function parseFeatures(settings: SettingsRow | null): Record<string, unknown> {
	try {
		return JSON.parse(settings?.features || "{}");
	} catch {
		return {};
	}
}

function siteAsk(settings: SettingsRow | null) {
	return parseFeatures(settings).aiAsk !== false;
}

async function requireConfig(workspaceId: string): Promise<AiConfig> {
	const { config } = await loadConfig(workspaceId);
	if (!config) throw aiError("not_configured", 409);
	return config;
}

// ---------- Allowance on the Site's AI key ----------
//
// Every workspace without its own key shares the Site's, so each person and each workspace get a
// daily allowance of it. A workspace that brought its own key pays for itself and has no limit here.
// Defaults, and how to change them with env vars, are in the README.

type QuotaKind = "text" | "image";

function quotaLimit(scope: "user" | "workspace", kind: QuotaKind) {
	const defaults = {
		user: { text: 300, image: 30 },
		workspace: { text: 3000, image: 200 },
	};
	const env = `LIVEPAGE_AI_${scope.toUpperCase()}_DAILY_${kind.toUpperCase()}`;
	const value = Number(process.env[env]);
	return process.env[env] && Number.isFinite(value)
		? value
		: defaults[scope][kind];
}

async function spend(
	scope: "user" | "workspace",
	id: string,
	kind: QuotaKind,
	weight: number,
) {
	const limit = quotaLimit(scope, kind);
	if (limit <= 0) return;
	const db = new TablesDB(adminClient());
	const rowId = rowHash("ai-usage", scope, id, kind).slice(0, 32);
	const day = new Date().toISOString().slice(0, 10);
	const row = await db
		.getRow<Models.Row & { day: string }>({
			databaseId: DATABASE_ID,
			tableId: AI_USAGE,
			rowId,
		})
		.catch((err) => {
			if (errorCode(err) === 404) return null;
			throw err;
		});
	if (!row) {
		await db
			.createRow({
				databaseId: DATABASE_ID,
				tableId: AI_USAGE,
				rowId,
				data: { day, count: 0 },
			})
			.catch((err) => {
				if (errorCode(err) !== 409) throw err;
			});
	} else if (row.day !== day) {
		await db.updateRow({
			databaseId: DATABASE_ID,
			tableId: AI_USAGE,
			rowId,
			data: { day, count: 0 },
		});
	}
	try {
		await db.incrementRowColumn({
			databaseId: DATABASE_ID,
			tableId: AI_USAGE,
			rowId,
			column: "count",
			value: weight,
			max: limit,
		});
	} catch (err) {
		// Appwrite refuses an increment past `max`, which is the atomic check.
		if (errorCode(err) === 400 || errorCode(err) === 429)
			throw aiError("quota", 429);
		throw err;
	}
}

async function chargeAi(
	config: AiConfig,
	userId: string,
	workspaceId: string,
	kind: QuotaKind,
	weight = 1,
) {
	if (config.source !== "site" || weight <= 0) return;
	await spend("user", userId, kind, weight);
	await spend("workspace", workspaceId, kind, weight);
}

// A rejected key takes AI off for the workspace until a call succeeds or someone fixes it.
async function noteKeyRejected(workspaceId: string) {
	await writeSecret(
		healthRowId(workspaceId),
		JSON.stringify({ state: "bad_key", at: new Date().toISOString() }),
	).catch(() => undefined);
}

async function noteKeyWorking(workspaceId: string) {
	await deleteSecret(healthRowId(workspaceId)).catch(() => undefined);
}

export function keyHint(key: string) {
	return key.length > 4 ? key.slice(-4) : "";
}

// ---------- Status for the browser (never includes the key) ----------

export type ImageOptions = { aspects: Aspect[]; styles: string[] };
export type Aspect = "square" | "landscape" | "portrait";

export type AiStatus = {
	state: "ready" | "broken" | "none";
	canManage: boolean;
	images: boolean;
	imageOptions: ImageOptions;
	ask: boolean;
	vectors: boolean;
};

export async function aiStatus(workspaceId: string): Promise<AiStatus> {
	const { role } = await requireWorkspace(workspaceId);
	const [{ config, broken }, settings] = await Promise.all([
		loadConfig(workspaceId),
		readSettings(),
	]);
	const canManage = role === "owner" || role === "admin";
	return {
		state: !config ? "none" : broken ? "broken" : "ready",
		canManage,
		images: Boolean(config?.images),
		imageOptions: config
			? imageOptions(config.imageModel)
			: { aspects: [], styles: [] },
		ask: Boolean(config?.ask),
		vectors: (await vectorsHealth(settings)) === "ready",
	};
}

// ---------- Which sizes and styles a model really takes ----------

const SIZES: Record<Aspect, string> = {
	square: "1024x1024",
	landscape: "1536x1024",
	portrait: "1024x1536",
};

// Unknown models get no choices, so we never send a parameter they might reject.
export function imageOptions(model: string): ImageOptions {
	const name = model.toLowerCase();
	if (name.startsWith("dall-e-3")) {
		return {
			aspects: ["landscape", "square", "portrait"],
			styles: ["vivid", "natural"],
		};
	}
	if (name.startsWith("dall-e-2")) return { aspects: ["square"], styles: [] };
	if (name.includes("gpt-image")) {
		return { aspects: ["landscape", "square", "portrait"], styles: [] };
	}
	return { aspects: [], styles: [] };
}

function sizeFor(
	model: string,
	aspect: Aspect | undefined,
): string | undefined {
	const options = imageOptions(model);
	const chosen =
		aspect && options.aspects.includes(aspect) ? aspect : options.aspects[0];
	if (!chosen) return undefined;
	if (model.toLowerCase().startsWith("dall-e-3") && chosen !== "square") {
		return chosen === "landscape" ? "1792x1024" : "1024x1792";
	}
	return SIZES[chosen];
}

// ---------- Talking to the provider ----------

function deadlineSignal(ms: number, outer?: AbortSignal | null) {
	const timeout = AbortSignal.timeout(ms);
	return outer ? AbortSignal.any([timeout, outer]) : timeout;
}

function isOurTimeout(signal: AbortSignal) {
	return (
		signal.reason instanceof DOMException &&
		signal.reason.name === "TimeoutError"
	);
}

function normalizeEndpoint(input: string): string {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw aiError("bad_endpoint", 400);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password
	) {
		throw aiError("bad_endpoint", 400);
	}
	return url.toString().replace(/\/+$/, "");
}

async function classify(
	res: Response,
	cfg: AiConfig,
	path: string,
): Promise<AiError> {
	const text = await res.text().catch(() => "");
	let code = "";
	let message = "";
	try {
		const json = JSON.parse(text) as { error?: unknown };
		if (typeof json.error === "string") message = json.error;
		else if (json.error && typeof json.error === "object") {
			const err = json.error as {
				message?: string;
				code?: string;
				type?: string;
			};
			message = err.message ?? "";
			code = err.code ?? err.type ?? "";
		}
	} catch {
		if (text.trimStart().startsWith("<")) return aiError("bad_endpoint");
	}
	const lower = message.toLowerCase();
	// Providers phrase these differently, and the status alone doesn't say which it is.
	if (
		code === "insufficient_quota" ||
		lower.includes("insufficient_quota") ||
		lower.includes("exceeded your current quota")
	) {
		return aiError("no_credit", 402);
	}
	if (res.status === 401 || code === "invalid_api_key")
		return aiError("bad_key", 401);
	if (res.status === 429) return aiError("rate_limited", 429);
	const isImages = path.startsWith("/images");
	if (
		isImages &&
		(lower.includes("not supported on /v1/images") ||
			lower.includes("does not support image") ||
			(res.status === 400 && lower.includes("model")))
	) {
		return aiError("no_images", 400);
	}
	if (
		code === "content_policy_violation" ||
		code === "moderation_blocked" ||
		lower.includes("content policy") ||
		lower.includes("safety system")
	) {
		return aiError("refused", 400);
	}
	if (
		code === "model_not_found" ||
		lower.includes("model") ||
		(res.status === 403 && lower.includes("access"))
	) {
		const model = isImages
			? cfg.imageModel
			: path.startsWith("/embeddings")
				? cfg.embeddingModel
				: cfg.textModel;
		return aiError(
			"model_missing",
			400,
			`The model "${model}" isn't available from this provider.`,
		);
	}
	if (res.status === 403) return aiError("bad_key", 401);
	if (res.status === 404) return aiError("bad_endpoint");
	if (res.status === 413) return aiError("too_large", 413);
	return aiError("provider");
}

async function provider(
	cfg: AiConfig,
	path: string,
	init: RequestInit,
	signal: AbortSignal,
): Promise<Response> {
	const url = `${cfg.endpoint}${path}`;
	try {
		await assertPublicUrl(url, cfg.privateHost);
	} catch {
		throw aiError("unreachable", 400, "That AI endpoint isn't allowed.");
	}
	let res: Response;
	try {
		res = await fetch(url, {
			...init,
			signal,
			redirect: "error",
			headers: { ...init.headers, authorization: `Bearer ${cfg.key}` },
		});
	} catch (err) {
		if (signal.aborted)
			throw isOurTimeout(signal) ? aiError("timeout", 504) : err;
		throw aiError("unreachable");
	}
	if (!res.ok) {
		const error = await classify(res, cfg, path);
		console.warn(`[ai] ${path} failed: ${res.status} ${error.code}`);
		throw error;
	}
	return res;
}

const json = (body: unknown): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

export async function chatOnce(
	cfg: AiConfig,
	messages: ChatMessage[],
	signal: AbortSignal,
): Promise<string> {
	const res = await provider(
		cfg,
		"/chat/completions",
		json({ model: cfg.textModel, messages }),
		signal,
	);
	const data = (await res.json().catch(() => null)) as {
		choices?: { message?: { content?: string } }[];
	} | null;
	if (!data?.choices) throw aiError("bad_endpoint");
	return data.choices[0]?.message?.content?.trim() ?? "";
}

export async function* chatStream(
	cfg: AiConfig,
	messages: ChatMessage[],
	signal: AbortSignal,
): AsyncGenerator<string> {
	const res = await provider(
		cfg,
		"/chat/completions",
		json({ model: cfg.textModel, messages, stream: true }),
		signal,
	);
	if (!res.body) throw aiError("provider");
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let sawData = false;
	try {
		while (true) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch (err) {
				if (signal.aborted)
					throw isOurTimeout(signal) ? aiError("timeout", 504) : err;
				throw aiError("provider");
			}
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (payload === "[DONE]") return;
				let event: {
					error?: { code?: string };
					choices?: { delta?: { content?: string }; finish_reason?: string }[];
				};
				try {
					event = JSON.parse(payload);
				} catch {
					continue;
				}
				sawData = true;
				if (event.error)
					throw aiError(
						event.error.code === "content_filter" ? "refused" : "provider",
					);
				const choice = event.choices?.[0];
				if (choice?.finish_reason === "content_filter")
					throw aiError("refused", 400);
				if (choice?.delta?.content) yield choice.delta.content;
			}
		}
		if (!sawData) throw aiError("bad_endpoint");
	} finally {
		reader.cancel().catch(() => undefined);
	}
}

export async function listModels(
	cfg: AiConfig,
	signal: AbortSignal,
): Promise<ListedModel[] | null> {
	let res: Response;
	try {
		res = await provider(cfg, "/models", { method: "GET" }, signal);
	} catch (err) {
		// A provider without a model list is fine. Everything else is a real problem.
		if (err instanceof AiError && err.code === "bad_endpoint") throw err;
		throw err;
	}
	return listedModels(await res.json().catch(() => null));
}

export async function embedTexts(
	cfg: AiConfig,
	texts: string[],
	signal: AbortSignal,
): Promise<number[][]> {
	const res = await provider(
		cfg,
		"/embeddings",
		json({ model: cfg.embeddingModel, input: texts }),
		signal,
	);
	const data = (await res.json().catch(() => null)) as {
		data?: { embedding?: number[] }[];
	} | null;
	const vectors = data?.data?.map((d) => d.embedding ?? []) ?? [];
	if (vectors.length !== texts.length || !vectors.every((v) => v.length > 0))
		throw aiError("provider");
	return vectors;
}

// ---------- Images ----------

type ImageInfo = { mime: string; ext: string; width: number; height: number };

// Reads a real image header, so a wrong file is caught before it's saved or sent anywhere.
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		bytes.length > 24 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return {
			mime: "image/png",
			ext: "png",
			width: view.getUint32(16),
			height: view.getUint32(20),
		};
	}
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) break;
			const marker = bytes[offset + 1];
			const size = view.getUint16(offset + 2);
			if (
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc
			) {
				return {
					mime: "image/jpeg",
					ext: "jpg",
					width: view.getUint16(offset + 7),
					height: view.getUint16(offset + 5),
				};
			}
			offset += 2 + size;
		}
		return { mime: "image/jpeg", ext: "jpg", width: 0, height: 0 };
	}
	if (
		bytes.length > 30 &&
		String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
		String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
	) {
		const format = String.fromCharCode(...bytes.slice(12, 16));
		if (format === "VP8X") {
			return {
				mime: "image/webp",
				ext: "webp",
				width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
				height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
			};
		}
		return { mime: "image/webp", ext: "webp", width: 0, height: 0 };
	}
	return null;
}

async function readImageResponse(
	cfg: AiConfig,
	res: Response,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const data = (await res.json().catch(() => null)) as {
		data?: { b64_json?: string; url?: string }[];
	} | null;
	const item = data?.data?.[0];
	if (item?.b64_json)
		return Uint8Array.from(Buffer.from(item.b64_json, "base64"));
	if (item?.url?.startsWith("http")) {
		// The provider chose this URL, so it's checked like any other outgoing address.
		const allowed = await assertPublicUrl(item.url, cfg.privateHost).then(
			() => true,
			() => false,
		);
		if (!allowed) throw aiError("provider");
		const file = await fetch(item.url, { signal, redirect: "error" }).catch(
			() => null,
		);
		if (file?.ok) return new Uint8Array(await file.arrayBuffer());
	}
	if (data && !data.data) throw aiError("bad_endpoint");
	console.warn(`[ai] image response from ${cfg.imageModel} had no image`);
	throw aiError("provider");
}

async function generateImage(
	cfg: AiConfig,
	prompt: string,
	aspect: Aspect | undefined,
	style: string | undefined,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const size = sizeFor(cfg.imageModel, aspect);
	const options = imageOptions(cfg.imageModel);
	const body: Record<string, unknown> = { model: cfg.imageModel, prompt, n: 1 };
	if (size) body.size = size;
	if (cfg.imageModel.toLowerCase().includes("gpt-image"))
		body.quality = "medium";
	if (style && options.styles.includes(style)) body.style = style;
	const res = await provider(cfg, "/images/generations", json(body), signal);
	return readImageResponse(cfg, res, signal);
}

// The shape of the result follows the source, so an edit doesn't crop or stretch it.
function aspectOf(info: ImageInfo): Aspect | undefined {
	if (!info.width || !info.height) return undefined;
	const ratio = info.width / info.height;
	if (ratio > 1.15) return "landscape";
	if (ratio < 0.87) return "portrait";
	return "square";
}

async function editImage(
	cfg: AiConfig,
	bytes: Uint8Array,
	info: ImageInfo,
	prompt: string,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const form = new FormData();
	form.append("model", cfg.imageModel);
	form.append("prompt", prompt);
	if (cfg.imageModel.toLowerCase().includes("gpt-image")) {
		// Edits are slower than generating and only have about 27 s, so ask for the fastest quality.
		form.append("quality", "low");
		const size = sizeFor(cfg.imageModel, aspectOf(info));
		if (size) form.append("size", size);
	}
	form.append(
		"image",
		new Blob([bytes as BlobPart], { type: info.mime }),
		`source.${info.ext}`,
	);
	const res = await provider(
		cfg,
		"/images/edits",
		{ method: "POST", body: form },
		signal,
	);
	return readImageResponse(cfg, res, signal);
}

// ---------- Request helpers ----------

function errorResponse(err: unknown): Response {
	if (err instanceof AuthError) {
		return Response.json(
			{
				error: { code: err.reason, message: err.message },
				message: err.message,
			},
			{ status: err.reason === "signed-out" ? 401 : 403 },
		);
	}
	if (err instanceof AiError) {
		return Response.json(
			{ error: { code: err.code, message: err.message }, message: err.message },
			{ status: err.status },
		);
	}
	if (err instanceof Error && err.name === "AbortError")
		return new Response(null, { status: 499 });
	console.error(
		"[ai] request failed",
		err instanceof Error ? err.message : err,
	);
	const message = "Something went wrong. Try again.";
	return Response.json(
		{ error: { code: "provider", message }, message },
		{ status: 500 },
	);
}

function field(obj: Record<string, unknown>, key: string, max: number): string {
	const value = obj[key];
	return typeof value === "string" ? value.slice(0, max) : "";
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object") {
		throw new AiError("provider", "Bad request.", 400);
	}
	return body as Record<string, unknown>;
}

async function loadPage(
	secretClient: ReturnType<typeof sessionClient>,
	pageId: string,
): Promise<Page> {
	try {
		const row = await new TablesDB(secretClient).getRow<Models.Row & PageRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: pageId,
		});
		return toPage(row);
	} catch (err) {
		if ([401, 404].includes(errorCode(err))) {
			throw new AuthError("You don't have access to this page.", "forbidden");
		}
		throw err;
	}
}

function canEdit(page: Page, userId: string, role: Role | null) {
	if (page.visibility === "workspace" && role && role !== "guest") return true;
	if (page.createdBy === userId) return true;
	return page.shares.some((s) => s.userId === userId && s.level === "edit");
}

// The page must be readable with the person's own session, and editable for anything that writes.
async function requirePage(
	workspaceId: string,
	pageId: string,
	mode: "read" | "edit",
) {
	const session = await requireWorkspace(workspaceId);
	const page = await loadPage(session.client, pageId);
	if (page.workspaceId !== workspaceId) {
		throw new AuthError("You don't have access to this page.", "forbidden");
	}
	if (mode === "edit" && !canEdit(page, session.viewer.userId, session.role)) {
		throw new AiError("not_allowed", MESSAGES.not_allowed, 403);
	}
	return { ...session, page };
}

// ---------- Streaming ----------

const encoder = new TextEncoder();

function ndjson(
	signal: AbortSignal | null,
	run: (send: (event: unknown) => void, aborted: AbortSignal) => Promise<void>,
): Response {
	const ctrl = new AbortController();
	signal?.addEventListener("abort", () => ctrl.abort());
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: unknown) => {
				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					ctrl.abort();
				}
			};
			try {
				// Something reaches the browser right away, so a slow model doesn't look like a dead connection.
				send({ start: true });
				await run(send, ctrl.signal);
			} finally {
				try {
					controller.close();
				} catch {
					// Already closed by a disconnect.
				}
			}
		},
		cancel() {
			ctrl.abort();
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "application/x-ndjson; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			"x-accel-buffering": "no",
		},
	});
}

async function streamModel(
	cfg: AiConfig,
	workspaceId: string,
	messages: ChatMessage[],
	send: (event: unknown) => void,
	aborted: AbortSignal,
) {
	const signal = deadlineSignal(REQUEST_BUDGET_MS, aborted);
	let got = false;
	try {
		for await (const delta of chatStream(cfg, messages, signal)) {
			got = true;
			send({ delta });
		}
		send({ done: true });
		await noteKeyWorking(workspaceId);
	} catch (err) {
		if (aborted.aborted) return;
		const error = err instanceof AiError ? err : aiError("provider");
		if (error.code === "bad_key") await noteKeyRejected(workspaceId);
		send({ error: { code: error.code, message: error.message }, partial: got });
	}
}

// ---------- POST /api/ai/text ----------

export async function handleTextRequest(request: Request): Promise<Response> {
	try {
		const body = await readJson(request);
		const workspaceId = field(body, "workspaceId", 36);
		const pageId = field(body, "pageId", 36);
		const action = field(body, "action", 16) as TextAction;
		if (!TEXT_ACTIONS.includes(action))
			throw new AiError("provider", "Unknown action.", 400);
		const { page, viewer } = await requirePage(workspaceId, pageId, "edit");
		const config = await requireConfig(workspaceId);
		await chargeAi(config, viewer.userId, workspaceId, "text");
		const messages = textMessages({
			action,
			text: field(body, "text", LIMITS.selection),
			context: field(body, "context", LIMITS.context),
			pageTitle: page.title.slice(0, 200),
			instruction: field(body, "instruction", LIMITS.instruction),
			tone: field(body, "tone", 40),
			language: field(body, "language", 40),
		});
		return ndjson(request.signal, (send, aborted) =>
			streamModel(config, workspaceId, messages, send, aborted),
		);
	} catch (err) {
		return errorResponse(err);
	}
}

// ---------- POST /api/ai/ask ----------

type BodyRow = Models.Row & { pageId: string; text: string | null };
type PageDoc = Models.Row & PageRow;
type CellRow = Models.Row & {
	pageId: string;
	propertyId: string;
	value: string | null;
};
type PropertyRow = Models.Row & { name: string; databaseId: string };

function excerptOf(text: string, terms: string[], max = 1_400) {
	const lower = text.toLowerCase();
	let at = -1;
	for (const term of terms) {
		at = lower.indexOf(term);
		if (at >= 0) break;
	}
	if (at < 0 || text.length <= max) return text.slice(0, max);
	const start = Math.max(0, at - Math.floor(max / 3));
	return `${start > 0 ? "..." : ""}${text.slice(start, start + max)}`;
}

function parseCell(value: string | null): string {
	if (value == null) return "";
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed === "string") return parsed;
		if (Array.isArray(parsed)) return parsed.join(", ");
		if (typeof parsed === "object" && parsed && "label" in parsed)
			return String((parsed as { label: unknown }).label);
		return String(parsed);
	} catch {
		return value;
	}
}

// Finds what this person can read, using their session. Row permissions do the filtering, so a
// page they can't open can't be retrieved, cited or quoted.
export async function retrieveSources(
	client: ReturnType<typeof sessionClient>,
	workspaceId: string,
	question: string,
	config: AiConfig,
): Promise<AskSource[]> {
	const terms = searchTerms(question);
	if (!terms.length) return [];
	const db = new TablesDB(client);
	const searchText = terms.join(" ");
	const [titleHits, bodyHits, meaningIds] = await Promise.all([
		db.listRows<PageDoc>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				Query.equal("workspaceId", [workspaceId]),
				Query.search("title", searchText),
				Query.limit(8),
			],
		}),
		db.listRows<BodyRow>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			queries: [
				Query.equal("workspaceId", [workspaceId]),
				Query.search("text", searchText),
				Query.limit(12),
			],
		}),
		searchByMeaning(config, client, workspaceId, question),
	]);
	const bodyByPage = new Map(
		bodyHits.rows.map((b) => [b.pageId, b.text ?? ""]),
	);
	const order = [
		...new Set([
			...bodyHits.rows.map((b) => b.pageId),
			...titleHits.rows.map((p) => p.$id),
			...meaningIds,
		]),
	];
	const candidates = order.slice(0, 16);
	if (!candidates.length) return [];

	const pages = await db.listRows<PageDoc>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [Query.equal("$id", candidates), Query.limit(candidates.length)],
	});
	const byId = new Map(pages.rows.map((p) => [p.$id, p]));
	const visible = candidates.filter((id) => {
		const page = byId.get(id);
		return page && page.workspaceId === workspaceId && !page.trashedAt;
	});

	// Title-only and meaning-only hits still need their text.
	const missing = visible.filter((id) => !bodyByPage.has(id));
	if (missing.length) {
		const extra = await db.listRows<BodyRow>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			queries: [Query.equal("pageId", missing), Query.limit(missing.length)],
		});
		for (const row of extra.rows) bodyByPage.set(row.pageId, row.text ?? "");
	}

	// Database rows carry their facts in cells, so include those with the property names.
	const rowIds = visible.filter((id) => byId.get(id)?.kind === "row");
	const cellText = new Map<string, string>();
	if (rowIds.length) {
		const cells = await db.listRows<CellRow>({
			databaseId: DATABASE_ID,
			tableId: CELLS,
			queries: [Query.equal("pageId", rowIds), Query.limit(200)],
		});
		const propertyIds = [...new Set(cells.rows.map((c) => c.propertyId))];
		const properties = propertyIds.length
			? await db.listRows<PropertyRow>({
					databaseId: DATABASE_ID,
					tableId: PROPERTIES,
					queries: [
						Query.equal("$id", propertyIds),
						Query.limit(propertyIds.length),
					],
				})
			: { rows: [] as PropertyRow[] };
		const names = new Map(properties.rows.map((p) => [p.$id, p.name]));
		const databaseIds = [
			...new Set(rowIds.map((id) => byId.get(id)?.databaseId).filter(Boolean)),
		] as string[];
		const databases = databaseIds.length
			? await db.listRows<PageDoc>({
					databaseId: DATABASE_ID,
					tableId: PAGES,
					queries: [
						Query.equal("$id", databaseIds),
						Query.limit(databaseIds.length),
					],
				})
			: { rows: [] as PageDoc[] };
		const databaseById = new Map(databases.rows.map((d) => [d.$id, toPage(d)]));
		for (const cell of cells.rows) {
			// Anyone signed in can add a cell row naming a page; only members' rows count.
			const database = databaseById.get(
				byId.get(cell.pageId)?.databaseId ?? "",
			);
			if (!database || !isTrusted(cell, database)) continue;
			const value = parseCell(cell.value);
			if (!value) continue;
			const line = `${names.get(cell.propertyId) ?? "Field"}: ${value}`;
			cellText.set(cell.pageId, `${cellText.get(cell.pageId) ?? ""}${line}\n`);
		}
	}

	const parentTitles = new Map<string, string>();
	const parentIds = [
		...new Set(
			visible.flatMap((id) => {
				const p = byId.get(id);
				return [p?.parentId, p?.databaseId].filter((x): x is string =>
					Boolean(x),
				);
			}),
		),
	].filter((id) => !byId.has(id));
	if (parentIds.length) {
		const parents = await db.listRows<PageDoc>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [Query.equal("$id", parentIds), Query.limit(parentIds.length)],
		});
		for (const p of parents.rows) parentTitles.set(p.$id, p.title ?? "");
	}
	for (const p of pages.rows) parentTitles.set(p.$id, p.title ?? "");

	return visible.slice(0, 6).map((id, index) => {
		const page = byId.get(id) as PageDoc;
		const cells = cellText.get(id);
		const text =
			`${cells ? `${cells}\n` : ""}${bodyByPage.get(id) ?? ""}`.trim();
		const parentId = page.databaseId || page.parentId;
		return {
			n: index + 1,
			id,
			title: page.title || "Untitled",
			parent: parentId ? parentTitles.get(parentId) || null : null,
			excerpt: excerptOf(text, terms) || "(This page has no text yet.)",
		};
	});
}

export async function handleAskRequest(request: Request): Promise<Response> {
	try {
		const body = await readJson(request);
		const workspaceId = field(body, "workspaceId", 36);
		const question = field(body, "question", LIMITS.question).trim();
		if (!question) throw new AiError("provider", "Ask a question first.", 400);
		const history = Array.isArray(body.history)
			? (body.history as AskTurn[]).slice(-3)
			: [];
		const { client, viewer } = await requireWorkspace(workspaceId);
		const config = await requireConfig(workspaceId);
		if (!config.ask)
			throw new AiError(
				"not_configured",
				"Answers across the workspace are turned off.",
				409,
			);
		await chargeAi(config, viewer.userId, workspaceId, "text");
		// Retrieval also uses the last question, so a follow-up keeps its subject.
		const searchFor = [
			...history.slice(-1).map((t) => String(t.question ?? "")),
			question,
		].join(" ");
		const sources = await retrieveSources(
			client,
			workspaceId,
			searchFor,
			config,
		);
		const cleanHistory = history.map((t) => ({
			question: String(t.question ?? "").slice(0, LIMITS.question),
			answer: String(t.answer ?? "").slice(0, 4_000),
		}));
		return ndjson(request.signal, async (send, aborted) => {
			send({ sources: sources.map(({ excerpt: _excerpt, ...s }) => s) });
			if (!sources.length) {
				send({
					delta:
						"I couldn't find anything about that in the pages you can open.",
				});
				send({ done: true });
				return;
			}
			await streamModel(
				config,
				workspaceId,
				askMessages(question, sources, cleanHistory),
				send,
				aborted,
			);
		});
	} catch (err) {
		return errorResponse(err);
	}
}

// ---------- POST /api/ai/image, DELETE /api/ai/image ----------

const MAX_EDIT_BYTES = 12 * 1024 * 1024;

function imageFileName(prompt: string, ext: string) {
	const words = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return `${words || "image"}-${ID.unique().slice(0, 6)}.${ext}`;
}

function checkImageConfig(cfg: AiConfig) {
	if (!cfg.images)
		throw aiError(
			"no_images",
			409,
			"Your AI provider doesn't offer image generation.",
		);
}

// Inputs bigger than this go to the provider resized, so the upload doesn't eat into the time limit.
const EDIT_MAX_SIDE = 1024;
const EDIT_MAX_BYTES = 1_500_000;

// The image to send for an edit: the original when it's already small, otherwise a smaller copy.
// Appwrite makes the copy, so the Site needs no image library. If that fails, the original still works.
async function editSource(
	storage: Storage,
	fileId: string,
	model: string,
): Promise<{ bytes: Uint8Array; info: ImageInfo }> {
	const bytes = new Uint8Array(
		await storage.getFileDownload({ bucketId: BUCKET_ID, fileId }),
	);
	const info = imageInfo(bytes);
	if (!info) throw aiError("bad_image", 415);
	const small =
		bytes.length <= EDIT_MAX_BYTES &&
		Math.max(info.width, info.height) <= EDIT_MAX_SIDE;
	// dall-e-2 edits take PNG only, so leave those as they are.
	if (small || model.toLowerCase().startsWith("dall-e")) return { bytes, info };
	try {
		const landscape = info.width >= info.height;
		const resized = new Uint8Array(
			await storage.getFilePreview({
				bucketId: BUCKET_ID,
				fileId,
				width: landscape ? EDIT_MAX_SIDE : undefined,
				height: landscape ? undefined : EDIT_MAX_SIDE,
				quality: 85,
				output: ImageFormat.Webp,
			}),
		);
		const resizedInfo = imageInfo(resized);
		if (resizedInfo && resized.length < bytes.length)
			return { bytes: resized, info: resizedInfo };
	} catch (err) {
		console.warn(
			"[ai] couldn't resize the source image, sending the original",
			err instanceof Error ? err.message : err,
		);
	}
	return { bytes, info };
}

export async function handleImageRequest(request: Request): Promise<Response> {
	let workspaceId = "";
	try {
		const startedAt = Date.now();
		const body = await readJson(request);
		workspaceId = field(body, "workspaceId", 36);
		const pageId = field(body, "pageId", 36);
		const mode = field(body, "mode", 8);
		const prompt = field(body, "prompt", LIMITS.imagePrompt).trim();
		if (!prompt)
			throw new AiError("provider", "Describe the image first.", 400);
		const { page, secret, client, viewer } = await requirePage(
			workspaceId,
			pageId,
			"edit",
		);
		const config = await requireConfig(workspaceId);
		checkImageConfig(config);
		await chargeAi(config, viewer.userId, workspaceId, "image");
		const left = () =>
			Math.max(1_000, IMAGE_PROVIDER_BUDGET_MS - (Date.now() - startedAt));
		const signal = () => deadlineSignal(left(), request.signal);

		let bytes: Uint8Array;
		if (mode === "edit") {
			const fileId = field(body, "fileId", 36);
			const storage = new Storage(client);
			let meta: Models.File;
			try {
				meta = await storage.getFile({ bucketId: BUCKET_ID, fileId });
			} catch (err) {
				if ([401, 404].includes(errorCode(err)))
					throw new AuthError(
						"You don't have access to that image.",
						"forbidden",
					);
				throw err;
			}
			if (meta.sizeOriginal > MAX_EDIT_BYTES)
				throw aiError(
					"too_large",
					413,
					"That image is too large to edit. The limit is 12 MB.",
				);
			if (!["image/png", "image/jpeg", "image/webp"].includes(meta.mimeType))
				throw aiError("bad_image", 415);
			const { bytes: source, info } = await editSource(
				storage,
				fileId,
				config.imageModel,
			);
			bytes = await editImage(config, source, info, prompt, signal());
		} else {
			const aspect = field(body, "aspect", 12) as Aspect;
			const style = field(body, "style", 12) || undefined;
			bytes = await generateImage(config, prompt, aspect, style, signal());
		}
		const info = imageInfo(bytes);
		if (!info) throw aiError("provider");
		await noteKeyWorking(workspaceId);
		const { fileId } = await saveImageFile(
			secret,
			workspaceId,
			bytes,
			imageFileName(prompt, info.ext),
			contentPermissions(page),
		);
		return Response.json({ fileId, width: info.width, height: info.height });
	} catch (err) {
		if (err instanceof AiError && err.code === "bad_key" && workspaceId) {
			await noteKeyRejected(workspaceId);
		}
		if (err instanceof AiError && err.code === "timeout")
			return errorResponse(
				aiError(
					"timeout",
					504,
					"This image took too long. Try again, or ask for a smaller change.",
				),
			);
		return errorResponse(err);
	}
}

export async function handleImageDiscard(request: Request): Promise<Response> {
	try {
		const fileId = new URL(request.url).searchParams.get("fileId") ?? "";
		const { client } = await requireViewer();
		await new Storage(client).deleteFile({ bucketId: BUCKET_ID, fileId });
		return new Response(null, { status: 204 });
	} catch (err) {
		// A leftover preview is harmless, and the person can't delete it anyway.
		if ([401, 403, 404].includes(errorCode(err)))
			return new Response(null, { status: 204 });
		return errorResponse(err);
	}
}

// ---------- POST /api/ai/column ----------

const COLUMN_RUN_MS = 25_000;
const COLUMN_CELL_MS = 18_000;
const COLUMN_CONCURRENCY = 4;
const COLUMN_MAX_ROWS = 50;

type ColumnOptions = {
	prompt?: string;
	instruction?: string;
	// Property ids to read, plus the special "__body" and "__comments".
	columns?: string[];
	sources?: string[];
};

export async function handleColumnRequest(request: Request): Promise<Response> {
	try {
		const startedAt = Date.now();
		const body = await readJson(request);
		const workspaceId = field(body, "workspaceId", 36);
		const databaseId = field(body, "databaseId", 36);
		const propertyId = field(body, "propertyId", 36);
		const rowIds = Array.isArray(body.rowIds)
			? (body.rowIds as unknown[])
					.filter((id): id is string => typeof id === "string")
					.slice(0, COLUMN_MAX_ROWS)
			: [];
		const {
			client,
			viewer,
			role,
			page: database,
		} = await requirePage(workspaceId, databaseId, "edit");
		if (database.kind !== "database")
			throw new AiError("provider", "That page isn't a database.", 400);
		const config = await requireConfig(workspaceId);
		await chargeAi(config, viewer.userId, workspaceId, "text", rowIds.length);
		const db = new TablesDB(client);

		const property = await db.getRow<
			Models.Row & { options: string | null; databaseId: string; name: string }
		>({
			databaseId: DATABASE_ID,
			tableId: PROPERTIES,
			rowId: propertyId,
		});
		if (property.databaseId !== databaseId)
			throw new AiError("provider", "That column isn't in this database.", 400);
		let options: ColumnOptions = {};
		try {
			options = JSON.parse(property.options ?? "{}") as ColumnOptions;
		} catch {
			// Treated as an empty config below.
		}
		const instruction = (options.prompt ?? options.instruction ?? "").trim();
		if (!instruction)
			throw new AiError(
				"provider",
				"This AI column has no instruction yet.",
				400,
			);
		const reads = new Set(options.columns ?? options.sources ?? []);
		const readsBody = reads.has("__body") || reads.has("content");
		const readsComments = reads.has("__comments") || reads.has("comments");

		const [rows, cellsResult, properties] = await Promise.all([
			db.listRows<PageDoc>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				queries: [
					Query.equal("$id", rowIds.length ? rowIds : [""]),
					Query.equal("databaseId", [databaseId]),
					Query.limit(COLUMN_MAX_ROWS),
				],
			}),
			rowIds.length
				? db.listRows<CellRow>({
						databaseId: DATABASE_ID,
						tableId: CELLS,
						queries: [Query.equal("pageId", rowIds), Query.limit(500)],
					})
				: Promise.resolve({ rows: [] as CellRow[] }),
			db.listRows<PropertyRow>({
				databaseId: DATABASE_ID,
				tableId: PROPERTIES,
				queries: [Query.equal("databaseId", [databaseId]), Query.limit(100)],
			}),
		]);
		const propertyNames = new Map(properties.rows.map((p) => [p.$id, p.name]));

		const needsBody = readsBody;
		const needsComments = readsComments;
		const [bodies, comments] = await Promise.all([
			needsBody && rows.rows.length
				? db.listRows<BodyRow>({
						databaseId: DATABASE_ID,
						tableId: BODIES,
						queries: [
							Query.equal(
								"pageId",
								rows.rows.map((r) => r.$id),
							),
							Query.limit(COLUMN_MAX_ROWS),
						],
					})
				: Promise.resolve({ rows: [] as BodyRow[] }),
			needsComments && rows.rows.length
				? db.listRows<Models.Row & { pageId: string; body: string | null }>({
						databaseId: DATABASE_ID,
						tableId: COMMENTS,
						queries: [
							Query.equal(
								"pageId",
								rows.rows.map((r) => r.$id),
							),
							Query.limit(200),
						],
					})
				: Promise.resolve({
						rows: [] as (Models.Row & {
							pageId: string;
							body: string | null;
						})[],
					}),
		]);
		const bodyByPage = new Map(
			bodies.rows.map((b) => [b.pageId, b.text ?? ""]),
		);
		const trustedCells = cellsResult.rows.filter((c) =>
			isTrusted(c as CellRow & Models.Row, database),
		);
		const commentsByPage = new Map<string, string[]>();
		for (const c of comments.rows)
			commentsByPage.set(c.pageId, [
				...(commentsByPage.get(c.pageId) ?? []),
				c.body ?? "",
			]);

		const admin = new TablesDB(adminClient());
		const done: string[] = [];
		const failed: { rowId: string; message: string }[] = [];
		const queue = rows.rows.filter((r) => !r.trashedAt).slice();
		const remaining = () => queue.map((r) => r.$id);

		const fieldsFor = (row: PageDoc) => {
			const fields: { name: string; value: string }[] = [
				{ name: "Name", value: row.title || "Untitled" },
			];
			for (const cell of trustedCells) {
				if (cell.pageId !== row.$id) continue;
				if (cell.propertyId === propertyId) continue;
				if (reads.size && !reads.has(cell.propertyId)) continue;
				const value = parseCell(cell.value);
				if (value)
					fields.push({
						name: propertyNames.get(cell.propertyId) ?? "Field",
						value,
					});
			}
			if (needsBody)
				fields.push({
					name: "Page content",
					value: (bodyByPage.get(row.$id) ?? "").slice(0, 4_000),
				});
			if (needsComments)
				fields.push({
					name: "Comments",
					value: (commentsByPage.get(row.$id) ?? []).join("\n").slice(0, 2_000),
				});
			return fields;
		};

		const worker = async () => {
			while (true) {
				if (Date.now() - startedAt > COLUMN_RUN_MS - 4_000) return;
				const row = queue.shift();
				if (!row) return;
				const signal = deadlineSignal(
					Math.min(COLUMN_CELL_MS, COLUMN_RUN_MS - (Date.now() - startedAt)),
					request.signal,
				);
				try {
					const value = await chatOnce(
						config,
						columnMessages(instruction, fieldsFor(row)),
						signal,
					);
					const writer = canWriteDirect(toPage(row), {
						userId: viewer.userId,
						role,
					})
						? db
						: admin;
					await writer.upsertRow({
						databaseId: DATABASE_ID,
						tableId: CELLS,
						rowId: cellRowId(row.$id, propertyId),
						data: {
							workspaceId,
							databaseId,
							pageId: row.$id,
							propertyId,
							value: JSON.stringify(value.slice(0, 1_000)),
							updatedBy: viewer.userId,
						},
						permissions: cellPermissions(toPage(row)),
					});
					done.push(row.$id);
				} catch (err) {
					const error = err instanceof AiError ? err : aiError("provider");
					failed.push({ rowId: row.$id, message: error.message });
					if (error.code === "bad_key" || error.code === "not_configured") {
						await noteKeyRejected(workspaceId);
						return;
					}
				}
			}
		};
		await Promise.all(Array.from({ length: COLUMN_CONCURRENCY }, worker));
		return Response.json({ done, failed, remaining: remaining() });
	} catch (err) {
		return errorResponse(err);
	}
}

// ---------- Settings (owners and admins of the workspace only) ----------

export type AiSettingsView = {
	hasKey: boolean;
	keyHint: string;
	source: "workspace" | "site" | "none";
	endpoint: string;
	textModel: string;
	imageModel: string;
	embeddingModel: string;
	ask: boolean;
};

export type Capability = { ok: boolean; model: string; detail: string };

export type AiCapabilities = {
	text: Capability;
	images: Capability;
	search: Capability;
};

export type AiSettingsPatch = {
	key?: string;
	endpoint?: string;
	textModel?: string;
	imageModel?: string;
	embeddingModel?: string;
	ask?: boolean;
};

function viewOf(
	config: AiConfig | null,
	settings: Awaited<ReturnType<typeof readSettings>>,
): AiSettingsView {
	return {
		hasKey: Boolean(config),
		keyHint: config ? keyHint(config.key) : "",
		source: config?.source ?? "none",
		endpoint: config?.endpoint ?? (settings?.aiEndpoint || DEFAULT_ENDPOINT),
		textModel: config?.textModel ?? (settings?.aiTextModel || ""),
		imageModel: config?.imageModel ?? (settings?.aiImageModel || ""),
		embeddingModel:
			config?.embeddingModel ?? (settings?.aiEmbeddingModel || ""),
		ask: config?.ask ?? true,
	};
}

export async function readAiSettings(
	workspaceId: string,
): Promise<AiSettingsView> {
	await requireWorkspace(workspaceId, "admin");
	const [{ config }, settings] = await Promise.all([
		loadConfig(workspaceId),
		readSettings(),
	]);
	return viewOf(config, settings);
}

// What a workspace admin may try. A new endpoint always needs its own key, so a saved key can't be
// pointed at a different server.
function buildCandidate(
	patch: AiSettingsPatch,
	current: AiConfig | null,
	settings: Awaited<ReturnType<typeof readSettings>>,
): AiConfig {
	const currentEndpoint =
		current?.endpoint ?? (settings?.aiEndpoint || DEFAULT_ENDPOINT);
	const endpoint = patch.endpoint
		? normalizeEndpoint(patch.endpoint)
		: currentEndpoint;
	const key = patch.key?.trim() || "";
	if (!key && !current)
		throw aiError("not_configured", 400, "Add an API key first.");
	if (!key && endpoint !== currentEndpoint) throw aiError("key_required", 400);
	return {
		key: key || (current as AiConfig).key,
		endpoint,
		textModel: patch.textModel?.trim() || current?.textModel || "",
		imageModel: patch.imageModel?.trim() || current?.imageModel || "",
		embeddingModel:
			patch.embeddingModel?.trim() ?? current?.embeddingModel ?? "",
		images: false,
		ask: patch.ask ?? current?.ask ?? true,
		source: "workspace",
		privateHost: settings?.aiPrivateHost ?? null,
	};
}

// Nobody named a model, so ask the provider what this account really has. A fixed default can
// name something the account doesn't offer, which leaves images off with no way to tell why.
async function withDetectedModels(candidate: AiConfig): Promise<AiConfig> {
	if (candidate.textModel && candidate.imageModel) return candidate;
	const models = await listModels(candidate, deadlineSignal(PROBE_TIMEOUT_MS));
	const picked = pickModels(models ?? [], {
		textModel: candidate.textModel,
		imageModel: candidate.imageModel,
	});
	return {
		...candidate,
		textModel: picked.textModel || DEFAULT_TEXT_MODEL,
		imageModel: picked.imageModel,
	};
}

const CHAT_MODELS =
	/^(gpt-[3-9]|gpt-6|o[1-9]|claude|llama|mistral|deepseek|qwen|codex)/i;

function imageCapability(model: string, models: string[] | null): Capability {
	if (!models)
		return {
			ok: false,
			model,
			detail: "This provider doesn't list its models, so images stay off.",
		};
	if (!models.includes(model))
		return { ok: false, model, detail: "Not offered by this provider." };
	if (CHAT_MODELS.test(model) && !model.toLowerCase().includes("image")) {
		return {
			ok: false,
			model,
			detail: "This is a text model, not an image model.",
		};
	}
	return { ok: true, model, detail: "Works" };
}

export async function probeProvider(
	config: AiConfig,
	deep: boolean,
): Promise<{ capabilities: AiCapabilities; images: boolean }> {
	const listed = await listModels(config, deadlineSignal(PROBE_TIMEOUT_MS));
	const models = listed ? listed.map((m) => m.id) : null;
	if (models && !models.includes(config.textModel)) {
		throw aiError(
			"model_missing",
			400,
			`The model "${config.textModel}" isn't available from this provider.`,
		);
	}
	if (deep) {
		await chatOnce(
			config,
			[{ role: "user", content: "Reply with the single word OK." }],
			deadlineSignal(PROBE_TIMEOUT_MS),
		);
	}
	const settings = await readSettings();
	const images = imageCapability(config.imageModel, models);
	const embeddingListed = Boolean(models?.includes(config.embeddingModel));
	return {
		images: images.ok,
		capabilities: {
			text: { ok: true, model: config.textModel, detail: "Works" },
			images,
			search: !settings?.vectors
				? {
						ok: false,
						model: config.embeddingModel,
						detail: "Not set up. Keyword search still works.",
					}
				: !config.embeddingModel
					? { ok: true, model: "Appwrite built-in", detail: "Works" }
					: embeddingListed
						? { ok: true, model: config.embeddingModel, detail: "Works" }
						: {
								ok: false,
								model: config.embeddingModel,
								detail: "This embedding model isn't offered here.",
							},
		},
	};
}

export async function testAiSettings(
	workspaceId: string,
	patch: AiSettingsPatch,
) {
	await requireWorkspace(workspaceId, "admin");
	const [{ config }, settings] = await Promise.all([
		loadConfig(workspaceId),
		readSettings(),
	]);
	const candidate = await withDetectedModels(
		buildCandidate(patch, config, settings),
	);
	const result = await probeProvider(candidate, true);
	if (config && candidate.key === config.key) await noteKeyWorking(workspaceId);
	return result.capabilities;
}

export async function saveAiSettings(
	workspaceId: string,
	patch: AiSettingsPatch,
) {
	const { viewer } = await requireWorkspace(workspaceId, "admin");
	const [{ config }, settings] = await Promise.all([
		loadConfig(workspaceId),
		readSettings(),
	]);
	const candidate = await withDetectedModels(
		buildCandidate(patch, config, settings),
	);
	// Switching Ask on or off changes nothing the provider sees, so it needs no round trip.
	const result =
		config && Object.keys(patch).join() === "ask"
			? { images: config.images, capabilities: null }
			: await probeProvider(candidate, true);
	// The person who ran setup owns the Site's own key. Everyone else's change stays in their workspace,
	// so one workspace can't swap the key or endpoint another workspace relies on.
	const features = parseFeatures(settings);
	if (config?.source !== "workspace" && features.ownerId === viewer.userId) {
		const db = new TablesDB(adminClient());
		await writeSecret(AI_KEY_SECRET, candidate.key);
		await db.updateRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
			data: {
				aiEnabled: true,
				aiEndpoint: candidate.endpoint,
				aiTextModel: candidate.textModel,
				aiImageModel: candidate.imageModel,
				aiEmbeddingModel: candidate.embeddingModel,
				aiImages: result.images,
				features: JSON.stringify({ ...features, aiAsk: candidate.ask }),
			},
		});
		await noteKeyWorking(workspaceId);
		return {
			settings: viewOf(
				{ ...candidate, images: result.images, source: "site" },
				settings,
			),
			capabilities: result.capabilities,
		};
	}
	await writeSecret(
		workspaceRowId(workspaceId),
		JSON.stringify({
			key: candidate.key,
			endpoint: candidate.endpoint,
			textModel: candidate.textModel,
			imageModel: candidate.imageModel,
			embeddingModel: candidate.embeddingModel,
			images: result.images,
			ask: candidate.ask,
		}),
	);
	await noteKeyWorking(workspaceId);
	return {
		settings: viewOf({ ...candidate, images: result.images }, settings),
		capabilities: result.capabilities,
	};
}

export async function readCapabilities(
	workspaceId: string,
): Promise<AiCapabilities | null> {
	await requireWorkspace(workspaceId, "admin");
	const { config } = await loadConfig(workspaceId);
	if (!config) return null;
	const { capabilities } = await probeProvider(config, false);
	return capabilities;
}

// ---------- catching vectors up ----------

// Called by a member's browser when a workspace opens, in batches, while pages are missing vectors.
export async function refreshVectors(
	workspaceId: string,
): Promise<{ embedded: number; remaining: number }> {
	const { client, viewer } = await requireWorkspace(workspaceId);
	const { config } = await loadConfig(workspaceId);
	if (!config) return { embedded: 0, remaining: 0 };
	try {
		await chargeAi(config, viewer.userId, workspaceId, "text");
	} catch (err) {
		if (err instanceof AiError && err.code === "quota")
			return { embedded: 0, remaining: 0 };
		throw err;
	}
	return embedStale(config, client, workspaceId);
}

// ---------- POST /api/ai/embed ----------

export async function handleEmbedRequest(request: Request): Promise<Response> {
	try {
		const body = await readJson(request);
		const workspaceId = field(body, "workspaceId", 36);
		const pageId = field(body, "pageId", 36);
		const { client, viewer } = await requirePage(workspaceId, pageId, "read");
		const { config } = await loadConfig(workspaceId);
		if (!config) return Response.json({ skipped: true, reason: "off" });
		await chargeAi(config, viewer.userId, workspaceId, "text");
		return Response.json(await embedPage(config, client, pageId));
	} catch (err) {
		if (err instanceof AuthError) return errorResponse(err);
		if (err instanceof AiError && err.code === "quota")
			return Response.json({ skipped: true, reason: "quota" });
		console.warn(
			"[ai] embedding failed:",
			err instanceof Error ? err.message : err,
		);
		return Response.json({ skipped: true, reason: "failed" });
	}
}
