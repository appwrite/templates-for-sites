// Keyword search and page lookups for search hits. Runs on the person's own client, so Appwrite
// row permissions decide what comes back: nobody can find a page they can't open.
import { type Client, Query, TablesDB } from "node-appwrite";
import type { PageKind } from "#/lib/types";
import { errorCode } from "#/server/appwrite";
import { BODIES, DATABASE_ID, PAGES } from "#/server/schema";

export type SearchHit = {
	id: string;
	title: string;
	kind: PageKind;
	icon: string | null;
	parentId: string | null;
	databaseId: string | null;
	sectionId: string | null;
	snippet: string | null;
	match: "title" | "body";
};

type HitRow = {
	$id: string;
	title: string | null;
	kind: PageKind;
	icon: string | null;
	parentId: string | null;
	databaseId: string | null;
	sectionId: string | null;
};

const HIT_FIELDS = [
	"$id",
	"title",
	"kind",
	"icon",
	"parentId",
	"databaseId",
	"sectionId",
];

function toHit(
	row: HitRow,
	match: SearchHit["match"],
	snippet: string | null,
): SearchHit {
	return {
		id: row.$id,
		title: row.title || "",
		kind: row.kind,
		icon: row.icon || null,
		parentId: row.parentId || null,
		databaseId: row.databaseId || null,
		sectionId: row.sectionId || null,
		snippet,
		match,
	};
}

export function snippetAround(text: string, query: string, radius = 70) {
	const lower = text.toLowerCase();
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	let at = -1;
	for (const word of words) {
		const found = lower.indexOf(word);
		if (found !== -1 && (at === -1 || found < at)) at = found;
	}
	if (at === -1) return text.slice(0, radius * 2).trim();
	const start = Math.max(0, at - radius);
	const end = Math.min(text.length, at + radius);
	return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// Keyword search over titles and bodies. Works for any Appwrite project, with no vector database.
export async function searchWorkspace(
	client: Client,
	workspaceId: string,
	query: string,
	limit = 12,
): Promise<SearchHit[]> {
	const term = query.trim();
	if (term.length < 2) return [];
	const db = new TablesDB(client);
	const [byTitle, byBody] = await Promise.all([
		db
			.listRows<HitRow & import("node-appwrite").Models.Row>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				queries: [
					Query.equal("workspaceId", [workspaceId]),
					Query.search("title", term),
					Query.isNull("trashedAt"),
					Query.select(HIT_FIELDS),
					Query.limit(limit),
				],
			})
			.catch(noResults),
		db
			.listRows<
				{
					pageId: string;
					text: string | null;
				} & import("node-appwrite").Models.Row
			>({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				queries: [
					Query.equal("workspaceId", [workspaceId]),
					Query.search("text", term),
					Query.select(["pageId", "text"]),
					Query.limit(limit),
				],
			})
			.catch(noResults),
	]);

	const hits = byTitle.rows.map((row) => toHit(row as HitRow, "title", null));
	const seen = new Set(hits.map((h) => h.id));
	const bodies = (
		byBody.rows as { pageId: string; text: string | null }[]
	).filter((b) => !seen.has(b.pageId));
	if (bodies.length) {
		const { rows } = await db.listRows<
			HitRow & import("node-appwrite").Models.Row
		>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				Query.equal(
					"$id",
					bodies.map((b) => b.pageId),
				),
				Query.isNull("trashedAt"),
				Query.select(HIT_FIELDS),
				Query.limit(limit),
			],
		});
		const pages = new Map(rows.map((r) => [r.$id, r as HitRow]));
		for (const body of bodies) {
			const page = pages.get(body.pageId);
			if (page)
				hits.push(
					toHit(
						page,
						"body",
						body.text ? snippetAround(body.text, term) : null,
					),
				);
		}
	}
	return hits.slice(0, limit);
}

// A fulltext index still building, or a query the index won't accept, means no results rather
// than a broken search box.
function noResults(err: unknown): { total: number; rows: never[] } {
	if (errorCode(err) === 400 || errorCode(err) === 404)
		return { total: 0, rows: [] };
	throw err;
}

export async function hitsByIds(client: Client, ids: string[]) {
	if (!ids.length) return [];
	const { rows } = await new TablesDB(client).listRows<
		HitRow & import("node-appwrite").Models.Row
	>({
		databaseId: DATABASE_ID,
		tableId: PAGES,
		queries: [
			Query.equal("$id", ids),
			Query.isNull("trashedAt"),
			Query.select(HIT_FIELDS),
			Query.limit(ids.length),
		],
	});
	const byId = new Map(rows.map((row) => [row.$id, row]));
	return ids.flatMap((id) => {
		const row = byId.get(id);
		return row ? [toHit(row, "body", null)] : [];
	});
}
