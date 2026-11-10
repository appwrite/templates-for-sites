// Search for ⌘K and the Map. The logic lives in server/search.ts; these are the browser's way in.
import { createServerFn } from "@tanstack/react-start";
import { Query, TablesDB } from "node-appwrite";
import { loadConfig } from "#/server/ai";
import { requireWorkspace } from "#/server/auth";
import { searchByMeaning } from "#/server/embeddings";
import { BODIES, DATABASE_ID } from "#/server/schema";
import { hitsByIds, type SearchHit, searchWorkspace } from "#/server/search";

export type { SearchHit };

export const searchPages = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string; query: string; limit?: number }) => d)
	.handler(async ({ data }) => {
		const { client } = await requireWorkspace(data.workspaceId);
		return searchWorkspace(client, data.workspaceId, data.query, data.limit);
	});

// Pages that match by meaning and not by keyword, for the "By meaning" part of ⌘K. Empty whenever
// vector search or AI isn't set up, so callers don't need to know which.
export const searchMeaning = createServerFn({ method: "GET" })
	.validator(
		(d: { workspaceId: string; query: string; exclude?: string[] }) => d,
	)
	.handler(async ({ data }): Promise<SearchHit[]> => {
		const { client } = await requireWorkspace(data.workspaceId);
		const { config } = await loadConfig(data.workspaceId);
		if (!config || data.query.trim().length < 3) return [];
		const ids = (
			await searchByMeaning(config, client, data.workspaceId, data.query)
		).filter((id) => !data.exclude?.includes(id));
		return hitsByIds(client, ids);
	});

// What the Map shows as "Related by meaning": pages close to this one that it doesn't link to yet.
export const fetchRelated = createServerFn({ method: "GET" })
	.validator((d: { workspaceId: string; pageId: string; title: string }) => d)
	.handler(async ({ data }): Promise<SearchHit[]> => {
		const { client } = await requireWorkspace(data.workspaceId);
		const { config } = await loadConfig(data.workspaceId);
		if (!config) return [];
		const { rows } = await new TablesDB(client).listRows<
			{
				pageId: string;
				text: string | null;
			} & import("node-appwrite").Models.Row
		>({
			databaseId: DATABASE_ID,
			tableId: BODIES,
			queries: [
				Query.equal("pageId", [data.pageId]),
				Query.select(["pageId", "text"]),
				Query.limit(1),
			],
		});
		const text = `${data.title}\n${rows[0]?.text ?? ""}`.trim();
		if (!text) return [];
		const ids = (
			await searchByMeaning(config, client, data.workspaceId, text)
		).filter((id) => id !== data.pageId);
		return hitsByIds(client, ids);
	});
