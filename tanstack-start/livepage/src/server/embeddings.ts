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

// One collection per vector size: workspaces can use different embedding models, and a
// collection only holds vectors of the size it was made with.
const COLLECTION_PREFIX = "pages";
const collectionFor = (dimension: number) =>
	`${COLLECTION_PREFIX}-${dimension}`;
const EMBED_TIMEOUT_MS = 8_000;
const MAX_EMBED_CHARS = 8_000;
// Pages per provider call when catching up.
const STALE_BATCH = 16;

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

// What a page's vector is made from.
function vectorText(title: string, body: string | null) {
	return `${title}\n\n${body ?? ""}`.trim().slice(0, MAX_EMBED_CHARS);
}

// Which model made a vector. Part of its hash, so changing the model or provider makes every page
// stale and the catch-up redoes them.
function modelKey(config: AiConfig) {
	return config.embeddingModel
		? `${config.endpoint}|${config.embeddingModel}`
		: "appwrite";
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
	const text = vectorText(page.title, body.text);
	if (!text) return { skipped: true, reason: "empty" };

	const vectors = new VectorsDB(adminClient());
	const hash = await hashOf(`${modelKey(config)}\n${text}`);
	for (const collectionId of await pageCollections(databaseId)) {
		try {
			const existing = await vectors.getDocument<
				Models.Document & { metadata?: VectorMeta }
			>({ databaseId, collectionId, documentId: pageId });
			if (existing.metadata?.hash === hash)
				return { skipped: true, reason: "unchanged" };
		} catch (err) {
			if (errorCode(err) !== 404) throw err;
		}
	}

	const [vector] = await embed(config, [text]);
	await ensureCollection(databaseId, vector.length);
	await vectors.upsertDocument({
		databaseId,
		collectionId: collectionFor(vector.length),
		documentId: pageId,
		data: {
			embeddings: vector,
			metadata: { workspaceId: page.workspaceId, hash },
		},
		permissions: contentPermissions(page),
	});
	return { skipped: false };
}

async function pageCollections(databaseId: string): Promise<string[]> {
	const { collections } = await new VectorsDB(adminClient())
		.listCollections({ databaseId, queries: [Query.limit(100)] })
		.catch((err) => {
			if (errorCode(err) === 404) return { collections: [] };
			throw err;
		});
	return collections
		.map((c) => c.$id)
		.filter((id) => id.startsWith(COLLECTION_PREFIX));
}

async function ensureCollection(databaseId: string, dimension: number) {
	const vectors = new VectorsDB(adminClient());
	await vectors
		.createCollection({
			databaseId,
			collectionId: collectionFor(dimension),
			name: `Pages (${dimension})`,
			dimension,
			permissions: [],
			documentSecurity: true,
		})
		.catch((err) => {
			if (errorCode(err) !== 409) throw err;
		});
}

// Nearest vectors to look at before deciding which are real matches.
const CANDIDATES = 24;
// How much closer than the typical page a match has to be. Distances depend on the embedding
// model (Appwrite's built-in one and OpenAI's differ by a lot), so a match is judged against the
// other pages for the same query rather than a fixed number. Measured on both: related pages sit
// 0.15 or more below the median, unrelated ones within 0.06 of it.
const MARGIN = 0.1;

// The nearest vectors always include something, related or not. Keeps the ones clearly closer
// than the rest. Without distances (an older Appwrite), keeps them all.
export function closeMatches<T extends { $distance?: number }>(
	documents: T[],
): T[] {
	const distances = documents
		.map((doc) => doc.$distance)
		.filter((d): d is number => typeof d === "number")
		.sort((a, b) => a - b);
	if (distances.length < documents.length || distances.length < 3)
		return documents;
	const median = distances[Math.floor(distances.length / 2)];
	return documents.filter((doc) => (doc.$distance ?? 0) <= median - MARGIN);
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
		// A POST query: a vector of a thousand or more numbers doesn't fit in a GET URL, and Cloud
		// answers 414.
		const { documents } = await new VectorsDB(session).createQuery<
			Models.Document & { metadata?: VectorMeta; $distance?: number }
		>({
			databaseId,
			// Vectors of the size this query's model makes. Ones from another model can't be compared.
			collectionId: collectionFor(vector.length),
			// Someone in several workspaces can read vectors from all of them, so filter before the limit.
			queries: [
				Query.vectorCosine("embeddings", vector),
				Query.equal("metadata.workspaceId", [workspaceId]),
				Query.limit(CANDIDATES),
			],
			total: false,
		});
		return closeMatches(documents)
			.filter((doc) => doc.metadata?.workspaceId === workspaceId)
			.slice(0, 8)
			.map((doc) => doc.$id);
	} catch (err) {
		console.warn(
			"[ai] search by meaning unavailable:",
			err instanceof Error ? err.message : err,
		);
		return [];
	}
}

async function listAll<T extends Models.Row>(
	db: TablesDB,
	tableId: string,
	queries: string[],
): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	for (;;) {
		const { rows } = await db.listRows<T>({
			databaseId: DATABASE_ID,
			tableId,
			queries: [
				...queries,
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		out.push(...rows);
		if (rows.length < 500) return out;
		cursor = rows[rows.length - 1].$id;
	}
}

async function storedHashes(databaseId: string, workspaceId: string) {
	const hashes = new Set<string>();
	for (const collectionId of await pageCollections(databaseId))
		await collectHashes(databaseId, collectionId, workspaceId, hashes);
	return hashes;
}

// Adds `pageId:hash` for every vector of the workspace in one collection.
async function collectHashes(
	databaseId: string,
	collectionId: string,
	workspaceId: string,
	into: Set<string>,
) {
	const vectors = new VectorsDB(adminClient());
	let cursor: string | undefined;
	for (;;) {
		const { documents } = await vectors
			.listDocuments<Models.Document & { metadata?: VectorMeta }>({
				databaseId,
				collectionId,
				queries: [
					Query.equal("metadata.workspaceId", [workspaceId]),
					Query.select(["$id", "metadata"]),
					Query.limit(500),
					...(cursor ? [Query.cursorAfter(cursor)] : []),
				],
			})
			.catch((err) => {
				// No collection yet: nothing has a vector.
				if (errorCode(err) === 404) return { documents: [] };
				throw err;
			});
		for (const doc of documents) into.add(`${doc.$id}:${doc.metadata?.hash}`);
		if (documents.length < 500) return;
		cursor = documents[documents.length - 1].$id;
	}
}

// A page gets its vector when someone edits it in the browser. This catches every other page:
// starter pages, imports, edits by agents, a page closed before the edit was sent, and anything
// written before search by meaning was turned on. One provider call per batch; the browser asks
// again while `remaining` is above zero. It only sees pages this person can read.
export async function embedStale(
	config: AiConfig,
	session: Client,
	workspaceId: string,
): Promise<{ embedded: number; remaining: number }> {
	const databaseId = await vectorsDatabaseId();
	if (!databaseId) return { embedded: 0, remaining: 0 };
	const db = new TablesDB(session);
	const [rows, bodies, hashes] = await Promise.all([
		listAll<Models.Row & PageRow>(db, PAGES, [
			Query.equal("workspaceId", [workspaceId]),
			Query.notEqual("kind", "row"),
			Query.isNull("trashedAt"),
		]),
		listAll<Models.Row & { pageId: string; text: string | null }>(db, BODIES, [
			Query.equal("workspaceId", [workspaceId]),
			Query.select(["pageId", "text"]),
		]),
		storedHashes(databaseId, workspaceId),
	]);
	const bodyOf = new Map(bodies.map((b) => [b.pageId, b.text]));
	const stale: {
		page: ReturnType<typeof toPage>;
		text: string;
		hash: string;
	}[] = [];
	for (const row of rows) {
		const page = toPage(row);
		const text = vectorText(page.title, bodyOf.get(page.id) ?? null);
		if (!text) continue;
		const hash = await hashOf(`${modelKey(config)}\n${text}`);
		if (!hashes.has(`${page.id}:${hash}`)) stale.push({ page, text, hash });
	}
	const batch = stale.slice(0, STALE_BATCH);
	if (!batch.length) return { embedded: 0, remaining: 0 };
	const vectors = await embed(
		config,
		batch.map((item) => item.text),
	);
	await ensureCollection(databaseId, vectors[0].length);
	const store = new VectorsDB(adminClient());
	await Promise.all(
		batch.map((item, i) =>
			store.upsertDocument({
				databaseId,
				collectionId: collectionFor(vectors[0].length),
				documentId: item.page.id,
				data: {
					embeddings: vectors[i],
					metadata: { workspaceId: item.page.workspaceId, hash: item.hash },
				},
				permissions: contentPermissions(item.page),
			}),
		),
	);
	return { embedded: batch.length, remaining: stale.length - batch.length };
}
