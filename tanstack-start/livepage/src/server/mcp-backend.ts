// What the MCP tools read and write with. Every call runs with a JWT of the person who connected
// the agent, so Appwrite's permissions apply. Writes that need roles the person doesn't hold
// (a page shared with named people) use the site key, after the same access check the editor uses.
import { Client, ID, type Models, Query, TablesDB, Teams } from "node-appwrite";
import * as Y from "yjs";
import { isTrusted, levelFor } from "#/features/editor/access";
import {
	BODY_FIELD,
	digest,
	fromBase64,
	toBase64,
} from "#/features/editor/codec";
import {
	appendBlocks,
	docToMarkdown,
	markdownToBlocks,
	snapshotFromBlocks,
} from "#/lib/blocks";
import {
	cellPermissions,
	cellRowId,
	contentPermissions,
	pagePermissions,
} from "#/lib/permissions";
import { type PageRow, toPage } from "#/lib/rows";
import type { Page } from "#/lib/types";
import { adminClient, appwriteEnv, errorCode, siteOrigin } from "./appwrite";
import type { McpBackend, WorkspaceRef } from "./mcp";
import { ToolInputError } from "./mcp";
import type { McpCaller } from "./oauth";
import {
	BODIES,
	CELLS,
	DATABASE_ID,
	PAGES,
	PROPERTIES,
	UPDATES,
} from "./schema";
import { searchWorkspace } from "./search";
import { listWorkspaces } from "./workspaces";

function jwtClient(jwt: string): Client {
	const { endpoint, projectId } = appwriteEnv();
	return new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
}

type AppRow = Models.Row & PageRow;
type UpdateRow = Models.Row & { data: string | null };
type BodyRow = Models.Row & { snapshot: string | null; text: string | null };

const siteUrl = (origin: string, pageId: string) => `${origin}/p/${pageId}`;

async function currentDoc(client: Client, page: Page) {
	const pageId = page.id;
	const db = new TablesDB(client);
	const [body, updates] = await Promise.all([
		db
			.getRow<BodyRow>({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: pageId,
			})
			.catch((err) => {
				if (errorCode(err) === 404) return null;
				throw err;
			}),
		allUpdates(db, pageId),
	]);
	const doc = new Y.Doc();
	if (body?.snapshot) Y.applyUpdate(doc, fromBase64(body.snapshot));
	// Anyone signed in can add a row naming this page, so only rows a page member wrote count.
	for (const row of updates)
		if (row.data && isTrusted(row, page))
			Y.applyUpdate(doc, fromBase64(row.data));
	return { doc, body };
}

async function allUpdates(db: TablesDB, pageId: string) {
	const rows: UpdateRow[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await db.listRows<UpdateRow>({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			queries: [
				Query.equal("pageId", [pageId]),
				Query.orderAsc("$createdAt"),
				Query.limit(500),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		rows.push(...page.rows.filter((r) => r.data));
		if (page.rows.length < 500) break;
		cursor = page.rows[page.rows.length - 1].$id;
	}
	return rows;
}

async function membersOf(db: Client, workspaceId: string) {
	const { memberships } = await new Teams(db).listMemberships({
		teamId: workspaceId,
		queries: [Query.limit(1000)],
	});
	return memberships;
}

function plain(value: string | null | undefined) {
	if (value === null || value === undefined) return null;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

export function backendFor(caller: McpCaller): McpBackend {
	const client = () => jwtClient(caller.jwt);

	async function loadPage(id: string): Promise<Page | null> {
		try {
			const row = await new TablesDB(client()).getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: id,
			});
			return toPage(row);
		} catch (err) {
			if (errorCode(err) === 404 || errorCode(err) === 401) return null;
			throw err;
		}
	}

	async function roleOf(workspaceId: string) {
		const memberships = await membersOf(client(), workspaceId).catch(() => []);
		const mine = memberships.find(
			(m) => m.userId === caller.userId && m.confirm,
		);
		if (!mine) return null;
		if (mine.roles.includes("owner")) return "owner" as const;
		if (mine.roles.includes("admin")) return "admin" as const;
		if (mine.roles.includes("member")) return "member" as const;
		return "guest" as const;
	}

	async function requireEdit(page: Page) {
		const role = await roleOf(page.workspaceId);
		if (levelFor(page, caller.userId, role) !== "edit")
			throw new ToolInputError("This person can only view this page.");
		if (page.trashedAt)
			throw new ToolInputError("This page is in Trash. Restore it first.");
		return role;
	}

	return {
		async listWorkspaces(): Promise<WorkspaceRef[]> {
			const list = await listWorkspaces(client(), caller.userId);
			return list.map((w) => ({ id: w.id, name: w.name, role: w.role }));
		},

		async search(workspaceId, query, limit) {
			const hits = await searchWorkspace(client(), workspaceId, query, limit);
			return hits.map((h) => ({
				id: h.id,
				title: h.title || "Untitled",
				kind: h.kind,
				snippet: h.snippet,
				database_id: h.databaseId,
			}));
		},

		async readPage(pageId) {
			const page = await loadPage(pageId);
			if (!page) return null;
			const { doc } = await currentDoc(client(), page);
			const markdown = docToMarkdown(doc, page.title || "Untitled");
			const facts = digest(doc.getXmlFragment(BODY_FIELD));
			doc.destroy();
			return {
				id: page.id,
				workspace_id: page.workspaceId,
				title: page.title || "Untitled",
				kind: page.kind,
				parent_id: page.parentId,
				database_id: page.databaseId,
				markdown,
				links: facts.links,
				updated_at: page.updatedAt,
			};
		},

		async createPage({ workspaceId, title, markdown, parentId }) {
			const role = await roleOf(workspaceId);
			if (!role || role === "guest")
				throw new ToolInputError(
					"This person can't create pages in that workspace.",
				);
			const id = ID.unique();
			const access = {
				workspaceId,
				visibility: "workspace" as const,
				createdBy: caller.userId,
				shares: [],
			};
			const position = Date.now() / 1000;
			// Site key: page rows are never written directly by a person, and the role check above
			// is what authorized this one.
			const db = new TablesDB(adminClient());
			if (parentId) {
				const parent = await loadPage(parentId);
				if (!parent || parent.workspaceId !== workspaceId)
					throw new ToolInputError("That parent page isn't in this workspace.");
			}
			const row = await db.createRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: id,
				data: {
					workspaceId,
					parentId: parentId ?? null,
					sectionId: null,
					kind: "page",
					title: title.slice(0, 512),
					icon: null,
					coverFileId: null,
					position,
					databaseId: null,
					visibility: "workspace",
					shares: null,
					publishedSlug: null,
					trashedAt: null,
					createdBy: caller.userId,
					updatedBy: caller.userId,
				},
				permissions: pagePermissions(access),
			});
			const { snapshot, stateVector, text } = snapshotFromBlocks(
				id,
				title,
				markdownToBlocks(markdown),
			);
			await db.createRow({
				databaseId: DATABASE_ID,
				tableId: BODIES,
				rowId: id,
				data: {
					workspaceId,
					pageId: id,
					snapshot,
					stateVector,
					snapshotAt: new Date().toISOString(),
					text,
				},
				permissions: contentPermissions(access),
			});
			return { id: row.$id, title, url: siteUrl(siteOrigin(), id) };
		},

		async appendToPage(pageId, markdown) {
			const page = await loadPage(pageId);
			if (!page) return null;
			await requireEdit(page);
			if (page.kind === "database")
				throw new ToolInputError("Use update_row to change a database.");
			const blocks = markdownToBlocks(markdown);
			if (!blocks.length) throw new ToolInputError("markdown is empty.");
			const { doc, body } = await currentDoc(client(), page);
			const before = Y.encodeStateVector(doc);
			appendBlocks(doc, blocks);
			const update = Y.encodeStateAsUpdate(doc, before);
			const appended = digest(doc.getXmlFragment(BODY_FIELD)).text;
			doc.destroy();
			const admin = new TablesDB(adminClient());
			// A row on the updates channel: every open editor merges it in straight away, and the next
			// compaction folds it into the snapshot.
			await admin.createRow({
				databaseId: DATABASE_ID,
				tableId: UPDATES,
				rowId: ID.unique(),
				data: {
					workspaceId: page.workspaceId,
					pageId,
					data: toBase64(update),
					clientId: `agent-${caller.clientId}`.slice(0, 36),
					cursor: null,
					createdBy: caller.userId,
				},
				permissions: contentPermissions(page),
			});
			// Search text only: the snapshot belongs to compaction, which reads the update above.
			if (body)
				await admin.updateRow({
					databaseId: DATABASE_ID,
					tableId: BODIES,
					rowId: pageId,
					data: { text: appended },
				});
			return { id: pageId, appended: blocks.length };
		},

		async queryDatabase({ databaseId, limit, cursor }) {
			const page = await loadPage(databaseId);
			if (!page) return null;
			if (page.kind !== "database")
				throw new ToolInputError("That page isn't a database.");
			const db = new TablesDB(client());
			const [{ rows: props }, { rows }] = await Promise.all([
				db.listRows<
					Models.Row & { name: string; type: string; options: string | null }
				>({
					databaseId: DATABASE_ID,
					tableId: PROPERTIES,
					queries: [Query.equal("databaseId", [databaseId]), Query.limit(100)],
				}),
				db.listRows<AppRow>({
					databaseId: DATABASE_ID,
					tableId: PAGES,
					queries: [
						Query.equal("databaseId", [databaseId]),
						Query.isNull("trashedAt"),
						Query.orderAsc("position"),
						Query.limit(limit),
						...(cursor ? [Query.cursorAfter(cursor)] : []),
					],
				}),
			]);
			const properties = props.map((p) => ({
				id: p.$id,
				name: p.name,
				type: p.type,
				options: plain(p.options) as {
					choices?: { id: string; name: string }[];
				} | null,
			}));
			const cellMap = new Map<string, Map<string, unknown>>();
			const trustedCell = (cell: Models.Row) => isTrusted(cell, page);
			if (rows.length) {
				const { rows: cells } = await db.listRows<
					Models.Row & {
						pageId: string;
						propertyId: string;
						value: string | null;
					}
				>({
					databaseId: DATABASE_ID,
					tableId: CELLS,
					queries: [
						Query.equal(
							"pageId",
							rows.map((r) => r.$id),
						),
						Query.limit(5000),
					],
				});
				for (const cell of cells.filter(trustedCell)) {
					if (!cellMap.has(cell.pageId)) cellMap.set(cell.pageId, new Map());
					cellMap.get(cell.pageId)?.set(cell.propertyId, plain(cell.value));
				}
			}
			const readable = (prop: (typeof properties)[number], value: unknown) => {
				const choices = prop.options?.choices;
				if (!choices) return value;
				const names = (v: unknown) =>
					choices.find((c) => c.id === v)?.name ?? v;
				return Array.isArray(value) ? value.map(names) : names(value);
			};
			return {
				database: { id: page.id, title: page.title || "Untitled" },
				properties: properties.map((p) => ({
					name: p.name,
					type: p.type,
					...(p.options?.choices
						? { options: p.options.choices.map((c) => c.name) }
						: {}),
				})),
				rows: rows.map((row) => ({
					id: row.$id,
					title: row.title,
					values: Object.fromEntries(
						properties
							.filter((p) => p.type !== "title")
							.map((p) => [
								p.name,
								readable(p, cellMap.get(row.$id)?.get(p.id) ?? null),
							]),
					),
				})),
				next_cursor: rows.length === limit ? rows[rows.length - 1].$id : null,
			};
		},

		async updateRow({ databaseId, rowId, title, values }) {
			const database = await loadPage(databaseId);
			if (!database) return null;
			if (database.kind !== "database")
				throw new ToolInputError("That page isn't a database.");
			const role = await requireEdit(database);
			if (!role)
				throw new ToolInputError("This person isn't in that workspace.");
			const row = await loadPage(rowId);
			if (!row || row.databaseId !== databaseId) return null;
			const db = new TablesDB(client());
			const admin = new TablesDB(adminClient());
			if (title !== undefined)
				await admin.updateRow({
					databaseId: DATABASE_ID,
					tableId: PAGES,
					rowId,
					data: { title: title.slice(0, 512), updatedBy: caller.userId },
				});
			let changed = 0;
			if (values && Object.keys(values).length) {
				const { rows: props } = await db.listRows<
					Models.Row & { name: string; type: string; options: string | null }
				>({
					databaseId: DATABASE_ID,
					tableId: PROPERTIES,
					queries: [Query.equal("databaseId", [databaseId]), Query.limit(100)],
				});
				const perms = cellPermissions(database);
				const cells = Object.entries(values).map(([name, raw]) => {
					const prop = props.find(
						(p) => p.name.toLowerCase() === name.toLowerCase(),
					);
					if (!prop) throw new ToolInputError(`No property called "${name}".`);
					if (prop.type === "title")
						throw new ToolInputError("Set the title with the title argument.");
					const options = plain(prop.options) as {
						choices?: { id: string; name: string }[];
					} | null;
					const encode = (v: unknown) => {
						if (!options?.choices) return v;
						if (v === null) return null;
						const choice = options.choices.find(
							(c) =>
								c.id === v || c.name.toLowerCase() === String(v).toLowerCase(),
						);
						if (!choice)
							throw new ToolInputError(
								`"${String(v)}" isn't an option for ${prop.name}.`,
							);
						return choice.id;
					};
					const value = Array.isArray(raw) ? raw.map(encode) : encode(raw);
					return {
						$id: cellRowId(rowId, prop.$id),
						$permissions: perms,
						workspaceId: database.workspaceId,
						databaseId,
						pageId: rowId,
						propertyId: prop.$id,
						value: JSON.stringify(value),
						updatedBy: caller.userId,
					};
				});
				await admin.upsertRows({
					databaseId: DATABASE_ID,
					tableId: CELLS,
					rows: cells as unknown as object[],
				});
				changed = cells.length;
			}
			return { id: rowId, changed };
		},
	};
}
