// The MCP server behind /mcp: JSON-RPC over Streamable HTTP, stateless, JSON responses only.
// Data access is passed in, so the protocol and the tools are unit tested without Appwrite.

export const PROTOCOL_VERSIONS = [
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
];
export const SERVER_INFO = {
	name: "livepage",
	title: "Livepage",
	version: "1.0.0",
};

export type WorkspaceRef = { id: string; name: string; role: string };

export type McpBackend = {
	listWorkspaces(): Promise<WorkspaceRef[]>;
	search(
		workspaceId: string,
		query: string,
		limit: number,
	): Promise<Record<string, unknown>[]>;
	readPage(pageId: string): Promise<Record<string, unknown> | null>;
	createPage(input: {
		workspaceId: string;
		title: string;
		markdown: string;
		parentId?: string;
	}): Promise<Record<string, unknown>>;
	appendToPage(
		pageId: string,
		markdown: string,
	): Promise<Record<string, unknown> | null>;
	queryDatabase(input: {
		databaseId: string;
		limit: number;
		cursor?: string;
	}): Promise<Record<string, unknown> | null>;
	updateRow(input: {
		databaseId: string;
		rowId: string;
		title?: string;
		values?: Record<string, unknown>;
	}): Promise<Record<string, unknown> | null>;
};

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
	jsonrpc?: unknown;
	id?: JsonRpcId;
	method?: unknown;
	params?: unknown;
	result?: unknown;
	error?: unknown;
};
type JsonRpcResponse =
	| { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
	| {
			jsonrpc: "2.0";
			id: JsonRpcId;
			error: { code: number; message: string; data?: unknown };
	  };

export const RPC = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

const INSTRUCTIONS =
	"Livepage is a team workspace of pages and databases. Everything you do here runs as the person who connected you, with their permissions. Call list_workspaces first if you're not sure which workspace to use. Use search to find pages, read_page for a page in Markdown, create_page and append_to_page to write, query_database to read a database's rows and update_row to change them. Page writes show up live for anyone who has the page open.";

const WORKSPACE = {
	type: "string",
	description: "The workspace ID from list_workspaces.",
};
const PAGE = {
	type: "string",
	description: "The page ID, from search or read_page.",
};

export const TOOLS = [
	{
		name: "list_workspaces",
		title: "List workspaces",
		description:
			"Lists the workspaces this person belongs to, with their role in each.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "search",
		title: "Search the workspace",
		description:
			"Keyword search over page titles and bodies in one workspace. Only returns pages this person can open.",
		inputSchema: {
			type: "object",
			properties: {
				workspace_id: WORKSPACE,
				query: {
					type: "string",
					minLength: 2,
					description: "Words to look for.",
				},
				limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
			},
			required: ["workspace_id", "query"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "read_page",
		title: "Read a page",
		description:
			"Returns one page as Markdown, with its title, kind and link. For a database page, use query_database to see its rows.",
		inputSchema: {
			type: "object",
			properties: { page_id: PAGE },
			required: ["page_id"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "create_page",
		title: "Create a page",
		description:
			"Creates a new page from Markdown. Anyone in the workspace can see it.",
		inputSchema: {
			type: "object",
			properties: {
				workspace_id: WORKSPACE,
				title: { type: "string", maxLength: 512 },
				markdown: { type: "string", description: "The page body in Markdown." },
				parent_id: {
					type: "string",
					description: "Optional. Nest under this page.",
				},
			},
			required: ["workspace_id", "title"],
			additionalProperties: false,
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
	},
	{
		name: "append_to_page",
		title: "Append to a page",
		description:
			"Adds Markdown to the end of a page. It merges into the live document, so people editing see it appear and nothing they write is lost.",
		inputSchema: {
			type: "object",
			properties: {
				page_id: PAGE,
				markdown: { type: "string", description: "What to add, in Markdown." },
			},
			required: ["page_id", "markdown"],
			additionalProperties: false,
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
	},
	{
		name: "query_database",
		title: "Query a database",
		description:
			"Returns a database's properties and its rows. Each row has its ID, title and values by property name. Page through with the returned cursor.",
		inputSchema: {
			type: "object",
			properties: {
				database_id: { type: "string", description: "The database's page ID." },
				limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
				cursor: {
					type: "string",
					description: "From a previous call, to get the next rows.",
				},
			},
			required: ["database_id"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "update_row",
		title: "Update a database row",
		description:
			"Changes a row's title or its values. Values are keyed by property name; a select or status takes the option's name, a person takes their user ID, a date takes YYYY-MM-DD, a checkbox takes true or false.",
		inputSchema: {
			type: "object",
			properties: {
				database_id: { type: "string" },
				row_id: { type: "string" },
				title: { type: "string", maxLength: 512 },
				values: {
					type: "object",
					description: "Property name to new value. Use null to clear.",
					additionalProperties: true,
				},
			},
			required: ["database_id", "row_id"],
			additionalProperties: false,
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
	},
] as const;

// ---------- tools ----------

export class ToolInputError extends Error {}

type Args = Record<string, unknown>;

function optionalString(args: Args, key: string) {
	const value = args[key];
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string")
		throw new ToolInputError(`${key} must be a string.`);
	return value.trim();
}

function requiredString(args: Args, key: string) {
	const value = optionalString(args, key);
	if (!value) throw new ToolInputError(`${key} is required.`);
	return value;
}

function integer(
	args: Args,
	key: string,
	min: number,
	max: number,
	fallback: number,
) {
	const value = args[key];
	if (value === undefined || value === null) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max)
		throw new ToolInputError(
			`${key} must be a whole number from ${min} to ${max}.`,
		);
	return n;
}

type ToolResult = {
	content: { type: "text"; text: string }[];
	structuredContent?: unknown;
	isError?: boolean;
};

function ok(value: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		structuredContent: value,
	};
}

function toolError(message: string): ToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

const NOT_FOUND = (id: string) =>
	toolError(`Nothing found with ID ${id}, or this person can't open it.`);

const HANDLERS: Record<
	string,
	(args: Args, backend: McpBackend) => Promise<ToolResult>
> = {
	async list_workspaces(_args, backend) {
		return ok({ workspaces: await backend.listWorkspaces() });
	},

	async search(args, backend) {
		const workspaceId = requiredString(args, "workspace_id");
		const query = requiredString(args, "query");
		const limit = integer(args, "limit", 1, 25, 10);
		const results = await backend.search(workspaceId, query, limit);
		return ok({ count: results.length, results });
	},

	async read_page(args, backend) {
		const id = requiredString(args, "page_id");
		const page = await backend.readPage(id);
		return page ? ok({ page }) : NOT_FOUND(id);
	},

	async create_page(args, backend) {
		const page = await backend.createPage({
			workspaceId: requiredString(args, "workspace_id"),
			title: requiredString(args, "title"),
			markdown: optionalString(args, "markdown") ?? "",
			parentId: optionalString(args, "parent_id"),
		});
		return ok({ page });
	},

	async append_to_page(args, backend) {
		const id = requiredString(args, "page_id");
		const result = await backend.appendToPage(
			id,
			requiredString(args, "markdown"),
		);
		return result ? ok(result) : NOT_FOUND(id);
	},

	async query_database(args, backend) {
		const id = requiredString(args, "database_id");
		const result = await backend.queryDatabase({
			databaseId: id,
			limit: integer(args, "limit", 1, 100, 25),
			cursor: optionalString(args, "cursor"),
		});
		return result ? ok(result) : NOT_FOUND(id);
	},

	async update_row(args, backend) {
		const databaseId = requiredString(args, "database_id");
		const rowId = requiredString(args, "row_id");
		const values = args.values;
		if (
			values !== undefined &&
			(typeof values !== "object" || values === null || Array.isArray(values))
		)
			throw new ToolInputError("values must be an object.");
		const title = optionalString(args, "title");
		if (title === undefined && values === undefined)
			throw new ToolInputError("Give a title or values to change.");
		const result = await backend.updateRow({
			databaseId,
			rowId,
			title,
			values: values as Record<string, unknown> | undefined,
		});
		return result ? ok(result) : NOT_FOUND(rowId);
	},
};

// ---------- JSON-RPC ----------

function rpcError(
	id: JsonRpcId,
	code: number,
	message: string,
): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

function negotiate(requested: unknown) {
	return typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
		? requested
		: PROTOCOL_VERSIONS[0];
}

// One JSON-RPC message in, one response out, or null for notifications and responses.
export async function handleMessage(
	message: unknown,
	backend: McpBackend,
): Promise<JsonRpcResponse | null> {
	if (!message || typeof message !== "object" || Array.isArray(message))
		return rpcError(null, RPC.INVALID_REQUEST, "Invalid request.");
	const m = message as JsonRpcMessage;
	const hasId =
		"id" in m && (typeof m.id === "string" || typeof m.id === "number");
	if (m.jsonrpc !== "2.0")
		return rpcError(
			hasId ? (m.id as JsonRpcId) : null,
			RPC.INVALID_REQUEST,
			"jsonrpc must be 2.0.",
		);
	if (typeof m.method !== "string") {
		// A response to something the server sent. This server sends nothing, so ignore it.
		if ("result" in m || "error" in m) return null;
		return rpcError(
			hasId ? (m.id as JsonRpcId) : null,
			RPC.INVALID_REQUEST,
			"Missing method.",
		);
	}
	// Notifications (no id) get no response.
	if (!hasId) return null;
	const id = m.id as JsonRpcId;
	const params = (
		m.params && typeof m.params === "object" ? m.params : {}
	) as Args;

	switch (m.method) {
		case "initialize":
			return {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: negotiate(params.protocolVersion),
					capabilities: { tools: { listChanged: false } },
					serverInfo: SERVER_INFO,
					instructions: INSTRUCTIONS,
				},
			};
		case "ping":
			return { jsonrpc: "2.0", id, result: {} };
		case "tools/list":
			return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
		case "tools/call": {
			const name = params.name;
			const handler = typeof name === "string" ? HANDLERS[name] : undefined;
			if (!handler)
				return rpcError(
					id,
					RPC.INVALID_PARAMS,
					`Unknown tool: ${String(name)}.`,
				);
			const args = (
				params.arguments && typeof params.arguments === "object"
					? params.arguments
					: {}
			) as Args;
			try {
				return { jsonrpc: "2.0", id, result: await handler(args, backend) };
			} catch (err) {
				// Bad arguments and access errors come back as a tool error, so the model can adjust.
				if (err instanceof ToolInputError)
					return { jsonrpc: "2.0", id, result: toolError(err.message) };
				const message = err instanceof Error ? err.message : "The tool failed.";
				return { jsonrpc: "2.0", id, result: toolError(message) };
			}
		}
		default:
			return rpcError(
				id,
				RPC.METHOD_NOT_FOUND,
				`Method not found: ${m.method}.`,
			);
	}
}

// A POST body: one message or (in 2025-03-26) a batch. `body: null` means 202 with no body.
export async function handleBody(
	body: unknown,
	backend: McpBackend,
): Promise<{ status: number; body: unknown | null }> {
	if (Array.isArray(body)) {
		if (body.length === 0)
			return {
				status: 400,
				body: rpcError(null, RPC.INVALID_REQUEST, "Empty batch."),
			};
		const responses = (
			await Promise.all(body.map((m) => handleMessage(m, backend)))
		).filter((r): r is JsonRpcResponse => r !== null);
		return responses.length
			? { status: 200, body: responses }
			: { status: 202, body: null };
	}
	const response = await handleMessage(body, backend);
	return response
		? { status: 200, body: response }
		: { status: 202, body: null };
}

export function parseError() {
	return rpcError(null, RPC.PARSE_ERROR, "Parse error: the body is not JSON.");
}
