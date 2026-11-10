// Search by meaning. Opt-in: this only does anything when setup created a VectorsDB and turned the
// feature on. Every path fails soft, because keyword search is the product and this only adds to it.

import type { Models } from "node-appwrite";
import { type Client, Query, TablesDB, VectorsDB } from "node-appwrite";
import { contentPermissions } from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { AiConfig } from "./ai";
import { embedTexts } from "./ai";
import { adminClient, appwriteEnv, errorCode, siteKey } from "./appwrite";
import { BODIES, DATABASE_ID, PAGES } from "./schema";
import { readSettings, vectorsDatabaseName } from "./settings";

const COLLECTION = "pages";
const EMBED_TIMEOUT_MS = 8_000;
const MAX_EMBED_CHARS = 8_000;

type VectorMeta = { workspaceId: string; hash: string };

// Provider embeddings when the AI settings name a model, otherwise Appwrite's built-in ones.
async function embed(config: AiConfig, texts: string[]): Promise<number[][]> {
	if (config.embeddingModel) {
		return embedTexts(config, texts, AbortSignal.timeout(EMBED_TIMEOUT_MS));
	}
	const { endpoint, projectId } = appwriteEnv();
	const res = await fetch(`${endpoint}/embeddings/text`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-appwrite-project": projectId,
			"x-appwrite-key": siteKey() ?? "",
		},
		body: JSON.stringify({ texts }),
		signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`Appwrite embeddings answered ${res.status}`);
	const data = (await res.json()) as { embeddings: { embedding: number[] }[] };
	return data.embeddings.map((e) => e.embedding);
}

async function vectorsDatabaseId(): Promise<string | null> {
	const settings = await readSettings();
	return settings?.vectors ? vectorsDatabaseName(settings) : null;
}

async function hashOf(text: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

// Stores or refreshes one page's vector. Called on a debounce after edits, never by a slash command.
export async function embedPage(
	config: AiConfig,
	session: Client,
	pageId: string,
): Promise<{ skipped: boolean; reason?: string }> {
	const databaseId = await vectorsDatabaseId();
	if (!databaseId) return { skipped: true, reason: "off" };
	const db = new TablesDB(session);
	const page = toPage(
		await db.getRow<Models.Row & PageRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: pageId,
		}),
	);
	const body = await db.getRow<Models.Row & { text: string | null }>({
		databaseId: DATABASE_ID,
		tableId: BODIES,
		rowId: pageId,
	});
	const text = `${page.title}\n\n${body.text ?? ""}`
		.trim()
		.slice(0, MAX_EMBED_CHARS);
	if (!text) return { skipped: true, reason: "empty" };

	const vectors = new VectorsDB(adminClient());
	const hash = await hashOf(text);
	try {
		const existing = await vectors.getDocument<
			Models.Document & { metadata?: VectorMeta }
		>({
			databaseId,
			collectionId: COLLECTION,
			documentId: pageId,
		});
		if (existing.metadata?.hash === hash)
			return { skipped: true, reason: "unchanged" };
	} catch (err) {
		if (errorCode(err) !== 404) throw err;
	}

	const [vector] = await embed(config, [text]);
	await ensureCollection(databaseId, vector.length);
	await vectors.upsertDocument({
		databaseId,
		collectionId: COLLECTION,
		documentId: pageId,
		data: {
			embeddings: vector,
			metadata: { workspaceId: page.workspaceId, hash },
		},
		permissions: contentPermissions(page),
	});
	return { skipped: false };
}

async function ensureCollection(databaseId: string, dimension: number) {
	const vectors = new VectorsDB(adminClient());
	await vectors
		.createCollection({
			databaseId,
			collectionId: COLLECTION,
			name: "Pages",
			dimension,
			permissions: [],
			documentSecurity: true,
		})
		.catch((err) => {
			if (errorCode(err) !== 409) throw err;
		});
}

// Page ids that match by meaning, most similar first. The person's session reads the vectors, so
// documents they can't read never come back. Returns [] whenever this can't run.
export async function searchByMeaning(
	config: AiConfig,
	session: Client,
	workspaceId: string,
	query: string,
): Promise<string[]> {
	try {
		const databaseId = await vectorsDatabaseId();
		if (!databaseId) return [];
		const [vector] = await embed(config, [query.slice(0, MAX_EMBED_CHARS)]);
		const { documents } = await new VectorsDB(session).listDocuments<
			Models.Document & { metadata?: VectorMeta }
		>({
			databaseId,
			collectionId: COLLECTION,
			queries: [Query.vectorCosine("embeddings", vector), Query.limit(8)],
		});
		return documents
			.filter((doc) => doc.metadata?.workspaceId === workspaceId)
			.map((doc) => doc.$id);
	} catch (err) {
		console.warn(
			"[ai] search by meaning unavailable:",
			err instanceof Error ? err.message : err,
		);
		return [];
	}
}
