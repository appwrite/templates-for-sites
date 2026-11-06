// The MCP server behind /mcp: JSON-RPC over Streamable HTTP, stateless, JSON responses only.
// Data access is passed in, so the protocol and the tools are unit tested without Appwrite.
import type { Link, MessageDetail, MessageSummary } from "#/lib/types";

export const PROTOCOL_VERSIONS = [
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
];
export const SERVER_INFO = {
	name: "catchall",
	title: "Catchall",
	version: "1.0.0",
};

// Sites end a request after 30 seconds, so a wait stays under that. Call it again to wait longer.
export const MAX_WAIT_SECONDS = 25;
const DEFAULT_WAIT_SECONDS = 20;
// With no `since`, a wait counts mail from this long before the call, so mail that lands just
// before the agent starts waiting isn't missed.
const DEFAULT_LOOKBACK_MS = 60_000;
const POLL_MS = 1_000;
const MAX_HTML_CHARS = 100_000;

export type MessageQuery = {
	to?: string;
	since?: string;
	limit: number;
	unreadOnly?: boolean;
};

export type McpBackend = {
	listMessages(query: MessageQuery): Promise<MessageSummary[]>;
	getMessage(id: string): Promise<MessageDetail | null>;
	// The newest message for an address (or the part before the @), received after `since`.
	latestMessageId(to: string, since: string | null): Promise<string | null>;
	sleep(ms: number): Promise<void>;
	now(): number;
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
	"Catchall is a shared test inbox. Every address at its domain receives mail. Use wait_for_message after your app sends an email, get_latest_code for a sign-up code or link, and list_messages or get_message to look around. Addresses can be full (signup-1@inbox-….appwrite.email) or just the part before the @.";

const addressProperty = {
	type: "string",
	description:
		"Who the mail was sent to: a full address, or just the part before the @ (for example signup-8f3a).",
};
const sinceProperty = {
	type: "string",
	format: "date-time",
	description:
		"ISO 8601 time. Only mail received after this counts. Use the time just before your app sent the email.",
};

export const TOOLS = [
	{
		name: "list_messages",
		title: "List messages",
		description:
			"Lists messages in the inbox, newest first, with the code and first link pulled out of each. Filter by address and by time.",
		inputSchema: {
			type: "object",
			properties: {
				to: addressProperty,
				since: sinceProperty,
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "How many messages to return, up to 50.",
				},
				unread_only: {
					type: "boolean",
					default: false,
					description: "Only messages nobody has opened yet.",
				},
			},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "get_message",
		title: "Get a message",
		description:
			"Returns one message in full: text and HTML bodies, every link, the code, attachments and checks (TLS, spam score, missing text part and so on).",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The message ID from list_messages.",
				},
			},
			required: ["id"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "wait_for_message",
		title: "Wait for a message",
		description: `Waits for mail to an address and returns it in full as soon as it arrives. Without since, mail from up to a minute before the call counts. Waits up to ${MAX_WAIT_SECONDS} seconds per call; call again to keep waiting.`,
		inputSchema: {
			type: "object",
			properties: {
				to: addressProperty,
				since: sinceProperty,
				timeout_seconds: {
					type: "integer",
					minimum: 1,
					maximum: MAX_WAIT_SECONDS,
					default: DEFAULT_WAIT_SECONDS,
					description: `How long to wait, up to ${MAX_WAIT_SECONDS} seconds.`,
				},
			},
			required: ["to"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "get_latest_code",
		title: "Get the latest code or link",
		description:
			"Returns the verification code and the most likely action link (verify, confirm, sign in, reset password and so on) from the newest message to an address. Set timeout_seconds to wait for it to arrive.",
		inputSchema: {
			type: "object",
			properties: {
				to: addressProperty,
				since: sinceProperty,
				timeout_seconds: {
					type: "integer",
					minimum: 0,
					maximum: MAX_WAIT_SECONDS,
					default: 0,
					description: `Wait up to this many seconds for a message. 0 returns at once.`,
				},
			},
			required: ["to"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
] as const;

// ---------- clean JSON for the tools ----------

function from(m: MessageSummary) {
	return { name: m.fromName || null, address: m.fromAddress };
}

export function summaryJson(m: MessageSummary) {
	return {
		id: m.id,
		to: m.recipient,
		from: from(m),
		subject: m.subject,
		receivedAt: m.receivedAt,
		preview: m.preview,
		code: m.code,
		firstLink: m.firstLink
			? { url: m.firstLink.url, text: m.firstLink.label }
			: null,
		linkCount: m.linkCount,
		attachmentCount: m.attachmentCount,
		read: m.read,
	};
}

export function messageJson(m: MessageDetail) {
	const htmlTruncated = m.html.length > MAX_HTML_CHARS;
	return {
		id: m.id,
		to: m.recipient,
		from: from(m),
		replyTo: m.replyTo || null,
		cc: m.cc || null,
		subject: m.subject,
		receivedAt: m.receivedAt,
		code: m.code,
		actionLink: linkJson(pickActionLink(m.links)),
		links: m.links.map(linkJson),
		text: m.text,
		html: htmlTruncated ? m.html.slice(0, MAX_HTML_CHARS) : m.html,
		htmlTruncated,
		attachments: m.attachments.map((a) => ({
			name: a.name,
			contentType: a.contentType,
			size: a.size,
		})),
		checks: m.checks.map((c) => ({
			id: c.id,
			status: c.status,
			title: c.title,
			detail: c.detail,
		})),
		spam: m.spamVerdict ? { score: m.spamScore, verdict: m.spamVerdict } : null,
		transport: m.transport,
	};
}

function linkJson(link: Link | null) {
	return link
		? {
				url: link.url,
				text: link.label || null,
				local: link.local,
				insecure: link.insecure,
			}
		: null;
}

const ACTION_WORDS =
	/verif|confirm|activat|magic|log-?in|sign-?in|sign-?up|reset|password|token|auth|invite|accept|join|otp|code|callback/i;
const NOT_ACTIONS =
	/unsubscribe|preferences|privacy|terms|help|support|mailto:|twitter\.com|x\.com\/|facebook|linkedin|instagram|youtube|github\.com\/[^/]+\/?$|view.*(browser|online)/i;

// The link most likely to be the one a test should follow.
export function pickActionLink(links: Link[]): Link | null {
	const usable = links.filter(
		(l) =>
			/^https?:\/\//i.test(l.url) && !NOT_ACTIONS.test(`${l.url} ${l.label}`),
	);
	return (
		usable.find((l) => ACTION_WORDS.test(l.label)) ||
		usable.find((l) => ACTION_WORDS.test(l.url)) ||
		usable[0] ||
		null
	);
}

// ---------- tools ----------

class ToolInputError extends Error {}

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

function optionalSince(args: Args) {
	const since = optionalString(args, "since");
	if (since === undefined) return undefined;
	const time = Date.parse(since);
	if (Number.isNaN(time))
		throw new ToolInputError(
			"since must be an ISO 8601 date, like 2026-11-03T10:00:00Z.",
		);
	return new Date(time).toISOString();
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

async function waitForId(
	backend: McpBackend,
	to: string,
	since: string | null,
	timeoutSeconds: number,
) {
	const deadline = backend.now() + timeoutSeconds * 1000;
	for (;;) {
		const id = await backend.latestMessageId(to, since);
		if (id) return id;
		if (backend.now() >= deadline) return null;
		await backend.sleep(
			Math.min(POLL_MS, Math.max(0, deadline - backend.now())),
		);
	}
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

const HANDLERS: Record<
	string,
	(args: Args, backend: McpBackend) => Promise<ToolResult>
> = {
	async list_messages(args, backend) {
		const limit = integer(args, "limit", 1, 50, 20);
		const unreadOnly =
			args.unread_only === undefined ? false : args.unread_only;
		if (typeof unreadOnly !== "boolean")
			throw new ToolInputError("unread_only must be true or false.");
		const messages = await backend.listMessages({
			to: optionalString(args, "to"),
			since: optionalSince(args),
			limit,
			unreadOnly,
		});
		return ok({ count: messages.length, messages: messages.map(summaryJson) });
	},

	async get_message(args, backend) {
		const id = requiredString(args, "id");
		const message = await backend.getMessage(id);
		if (!message)
			return toolError(`No message with ID ${id}. It may have been deleted.`);
		return ok({ message: messageJson(message) });
	},

	async wait_for_message(args, backend) {
		const to = requiredString(args, "to");
		const timeout = integer(
			args,
			"timeout_seconds",
			1,
			MAX_WAIT_SECONDS,
			DEFAULT_WAIT_SECONDS,
		);
		const since =
			optionalSince(args) ??
			new Date(backend.now() - DEFAULT_LOOKBACK_MS).toISOString();
		const id = await waitForId(backend, to, since, timeout);
		const message = id ? await backend.getMessage(id) : null;
		if (!message)
			return ok({
				message: null,
				timedOut: true,
				note: `Nothing for ${to} after ${timeout} s. Call again to keep waiting.`,
			});
		return ok({ message: messageJson(message), timedOut: false });
	},

	async get_latest_code(args, backend) {
		const to = requiredString(args, "to");
		const timeout = integer(args, "timeout_seconds", 0, MAX_WAIT_SECONDS, 0);
		const since = optionalSince(args) ?? null;
		const id = await waitForId(backend, to, since, timeout);
		const message = id ? await backend.getMessage(id) : null;
		if (!message)
			return ok({
				found: false,
				code: null,
				link: null,
				note: timeout
					? `Nothing for ${to} after ${timeout} s.`
					: `No mail for ${to} yet. Set timeout_seconds to wait for it.`,
			});
		const link = pickActionLink(message.links);
		return ok({
			found: true,
			code: message.code,
			link: linkJson(link),
			messageId: message.id,
			subject: message.subject,
			from: from(message),
			receivedAt: message.receivedAt,
		});
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
				// Bad arguments come back as a tool error, so the model can fix them and retry.
				if (err instanceof ToolInputError)
					return { jsonrpc: "2.0", id, result: toolError(err.message) };
				return rpcError(id, RPC.INTERNAL_ERROR, "The tool failed. Try again.");
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
