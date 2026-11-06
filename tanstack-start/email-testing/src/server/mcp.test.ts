import { describe, expect, it } from "vitest";
import type { Link, MessageDetail } from "#/lib/types";
import {
	handleBody,
	handleMessage,
	MAX_WAIT_SECONDS,
	type McpBackend,
	PROTOCOL_VERSIONS,
	pickActionLink,
	RPC,
	type TOOLS,
} from "./mcp";

const link = (url: string, label = ""): Link => ({
	url,
	label,
	local: url.includes("localhost"),
	insecure: url.startsWith("http://"),
});

function message(id: string, fields: Partial<MessageDetail>): MessageDetail {
	return {
		id,
		mailbox: "signup-8f3a",
		recipient: "signup-8f3a@inbox-demo.appwrite.email",
		fromName: "Kestrel",
		fromAddress: "no-reply@kestrel.dev",
		subject: "Your Kestrel verification code",
		preview: "Enter 482913",
		code: null,
		firstLink: null,
		linkCount: 0,
		attachmentCount: 0,
		spamScore: 0.02,
		spamVerdict: "ham",
		receivedAt: "2026-11-03T10:00:00.000Z",
		read: false,
		text: "Enter 482913",
		html: "<p>Enter 482913</p>",
		links: [],
		attachments: [],
		headers: [["subject", "Your Kestrel verification code"]],
		date: "2026-11-03T10:00:00.000Z",
		messageId: `<${id}@kestrel.dev>`,
		cc: "",
		replyTo: "",
		to: "signup-8f3a@inbox-demo.appwrite.email",
		transport: { tls: true, helo: "mail.kestrel.dev" },
		checks: [{ id: "tls", status: "pass", title: "Sent over TLS", detail: "" }],
		rawJson: "{}",
		...fields,
	};
}

function backend(
	messages: MessageDetail[],
	arrivals: { at: number; message: MessageDetail }[] = [],
) {
	let now = Date.parse("2026-11-03T10:05:00.000Z");
	const start = now;
	const all = () => [
		...messages,
		...arrivals.filter((a) => now - start >= a.at).map((a) => a.message),
	];
	const matches = (m: MessageDetail, to?: string, since?: string | null) => {
		const address = to?.toLowerCase();
		if (
			address &&
			(address.includes("@") ? m.recipient !== address : m.mailbox !== address)
		)
			return false;
		return !since || m.receivedAt > since;
	};
	const calls: string[] = [];
	const b: McpBackend & { calls: string[]; slept: number } = {
		calls,
		slept: 0,
		async listMessages({ to, since, limit, unreadOnly }) {
			calls.push(`list ${to ?? ""} ${since ?? ""} ${limit} ${unreadOnly}`);
			return all()
				.filter((m) => matches(m, to, since) && (!unreadOnly || !m.read))
				.sort((a, z) => z.receivedAt.localeCompare(a.receivedAt))
				.slice(0, limit);
		},
		async getMessage(id) {
			return all().find((m) => m.id === id) ?? null;
		},
		async latestMessageId(to, since) {
			const found = all()
				.filter((m) => matches(m, to, since))
				.sort((a, z) => z.receivedAt.localeCompare(a.receivedAt))[0];
			return found?.id ?? null;
		},
		async sleep(ms) {
			b.slept += ms;
			now += ms;
		},
		now: () => now,
	};
	return b;
}

const call = (name: string, args: Record<string, unknown>, b: McpBackend) =>
	handleMessage(
		{
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: { name, arguments: args },
		},
		b,
	);

async function result(
	name: string,
	args: Record<string, unknown>,
	b: McpBackend,
) {
	const response = await call(name, args, b);
	if (!response || !("result" in response))
		throw new Error(JSON.stringify(response));
	return response.result as {
		// biome-ignore lint/suspicious/noExplicitAny: the tests read deep into the tool results
		structuredContent?: any;
		content: { text: string }[];
		isError?: boolean;
	};
}

const code = message("m_code", {
	code: "482913",
	links: [
		link("https://kestrel.dev/unsubscribe", "Unsubscribe"),
		link("https://app.kestrel.dev/verify?token=9f2c", "Verify email"),
	],
	receivedAt: "2026-11-03T10:04:30.000Z",
});
const old = message("m_old", {
	code: "111111",
	receivedAt: "2026-11-03T09:00:00.000Z",
});
const other = message("m_other", {
	mailbox: "ops",
	recipient: "ops@inbox-demo.appwrite.email",
	subject: "Nightly deploy finished",
	read: true,
	receivedAt: "2026-11-03T10:02:00.000Z",
});

describe("protocol", () => {
	it("initializes with the client's version when supported", async () => {
		const r = await handleMessage(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "claude-code", version: "2" },
				},
			},
			backend([]),
		);
		expect(r).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2025-06-18",
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "catchall" },
			},
		});
	});

	it("answers an unknown version with its newest", async () => {
		const r = await handleMessage(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "1999-01-01" },
			},
			backend([]),
		);
		expect(
			r &&
				"result" in r &&
				(r.result as { protocolVersion: string }).protocolVersion,
		).toBe(PROTOCOL_VERSIONS[0]);
	});

	it("lists four read-only tools with input schemas", async () => {
		const r = await handleMessage(
			{ jsonrpc: "2.0", id: "a", method: "tools/list" },
			backend([]),
		);
		const tools = (r as { result: { tools: typeof TOOLS } }).result.tools;
		expect(tools.map((t) => t.name)).toEqual([
			"list_messages",
			"get_message",
			"wait_for_message",
			"get_latest_code",
		]);
		for (const tool of tools) {
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.annotations.readOnlyHint).toBe(true);
		}
	});

	it("pings", async () => {
		expect(
			await handleMessage(
				{ jsonrpc: "2.0", id: 3, method: "ping" },
				backend([]),
			),
		).toEqual({
			jsonrpc: "2.0",
			id: 3,
			result: {},
		});
	});

	it("doesn't answer notifications or responses", async () => {
		expect(
			await handleMessage(
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				backend([]),
			),
		).toBeNull();
		expect(
			await handleMessage({ jsonrpc: "2.0", id: 4, result: {} }, backend([])),
		).toBeNull();
		expect(
			await handleBody(
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				backend([]),
			),
		).toEqual({
			status: 202,
			body: null,
		});
	});

	it("rejects bad requests and unknown methods", async () => {
		expect(
			await handleMessage({ id: 1, method: "ping" }, backend([])),
		).toMatchObject({
			error: { code: RPC.INVALID_REQUEST },
		});
		expect(await handleMessage("nope", backend([]))).toMatchObject({
			id: null,
			error: { code: RPC.INVALID_REQUEST },
		});
		expect(
			await handleMessage(
				{ jsonrpc: "2.0", id: 1, method: "resources/list" },
				backend([]),
			),
		).toMatchObject({
			error: { code: RPC.METHOD_NOT_FOUND },
		});
		expect(await call("send_email", {}, backend([]))).toMatchObject({
			error: { code: RPC.INVALID_PARAMS },
		});
	});

	it("handles a batch", async () => {
		const out = await handleBody(
			[
				{ jsonrpc: "2.0", id: 1, method: "ping" },
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			],
			backend([]),
		);
		expect(out.status).toBe(200);
		expect((out.body as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
		expect((await handleBody([], backend([]))).status).toBe(400);
	});

	it("turns a backend failure into an internal error without details", async () => {
		const b = backend([]);
		b.listMessages = async () => {
			throw new Error("secret stack trace");
		};
		const r = await call("list_messages", {}, b);
		expect(r).toMatchObject({ error: { code: RPC.INTERNAL_ERROR } });
		expect(JSON.stringify(r)).not.toContain("secret");
	});
});

describe("list_messages", () => {
	it("returns clean summaries, newest first", async () => {
		const r = await result("list_messages", {}, backend([old, code, other]));
		expect(r.structuredContent.count).toBe(3);
		expect(
			r.structuredContent.messages.map((m: { id: string }) => m.id),
		).toEqual(["m_code", "m_other", "m_old"]);
		expect(r.structuredContent.messages[0]).toEqual({
			id: "m_code",
			to: "signup-8f3a@inbox-demo.appwrite.email",
			from: { name: "Kestrel", address: "no-reply@kestrel.dev" },
			subject: "Your Kestrel verification code",
			receivedAt: "2026-11-03T10:04:30.000Z",
			preview: "Enter 482913",
			code: "482913",
			firstLink: null,
			linkCount: 0,
			attachmentCount: 0,
			read: false,
		});
		// The text content is the same JSON, for clients that don't read structuredContent.
		expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
	});

	it("filters by address, time and unread", async () => {
		const b = backend([old, code, other]);
		const byLocal = await result("list_messages", { to: "ops" }, b);
		expect(
			byLocal.structuredContent.messages.map((m: { id: string }) => m.id),
		).toEqual(["m_other"]);
		const byFull = await result(
			"list_messages",
			{ to: "Signup-8f3a@inbox-demo.appwrite.email" },
			b,
		);
		expect(byFull.structuredContent.count).toBe(2);
		const since = await result(
			"list_messages",
			{ since: "2026-11-03T10:00:00Z" },
			b,
		);
		expect(since.structuredContent.count).toBe(2);
		const unread = await result("list_messages", { unread_only: true }, b);
		expect(
			unread.structuredContent.messages.map((m: { id: string }) => m.id),
		).toEqual(["m_code", "m_old"]);
		const limited = await result("list_messages", { limit: 1 }, b);
		expect(limited.structuredContent.count).toBe(1);
	});

	it("reports bad arguments as a tool error the model can fix", async () => {
		const b = backend([]);
		for (const args of [
			{ limit: 0 },
			{ limit: 51 },
			{ limit: "x" },
			{ since: "yesterday" },
			{ unread_only: "yes" },
			{ to: 5 },
		]) {
			const r = await result("list_messages", args, b);
			expect(r.isError).toBe(true);
		}
		expect(b.calls).toEqual([]);
	});
});

describe("get_message", () => {
	it("returns the whole message with the action link picked out", async () => {
		const r = await result("get_message", { id: "m_code" }, backend([code]));
		const m = r.structuredContent.message;
		expect(m).toMatchObject({
			id: "m_code",
			code: "482913",
			actionLink: {
				url: "https://app.kestrel.dev/verify?token=9f2c",
				text: "Verify email",
			},
			text: "Enter 482913",
			html: "<p>Enter 482913</p>",
			htmlTruncated: false,
			checks: [{ id: "tls", status: "pass" }],
			spam: { score: 0.02, verdict: "ham" },
		});
		expect(m.links).toHaveLength(2);
	});

	it("cuts very long HTML and says so", async () => {
		const big = message("m_big", { html: "x".repeat(150_000) });
		const r = await result("get_message", { id: "m_big" }, backend([big]));
		expect(r.structuredContent.message.html).toHaveLength(100_000);
		expect(r.structuredContent.message.htmlTruncated).toBe(true);
	});

	it("says when a message is gone", async () => {
		const r = await result("get_message", { id: "m_none" }, backend([]));
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toMatch(/No message with ID m_none/);
		expect((await result("get_message", {}, backend([]))).isError).toBe(true);
	});
});

describe("wait_for_message", () => {
	it("returns at once when matching mail is already there", async () => {
		const b = backend([code]);
		const r = await result("wait_for_message", { to: "signup-8f3a" }, b);
		expect(r.structuredContent).toMatchObject({
			timedOut: false,
			message: { id: "m_code", code: "482913" },
		});
		expect(b.slept).toBe(0);
	});

	it("waits for mail that arrives later", async () => {
		const arriving = message("m_new", {
			receivedAt: "2026-11-03T10:05:06.000Z",
			code: "730215",
		});
		const b = backend([], [{ at: 6_000, message: arriving }]);
		const r = await result(
			"wait_for_message",
			{ to: "signup-8f3a", timeout_seconds: 20 },
			b,
		);
		expect(r.structuredContent.message.code).toBe("730215");
		expect(b.slept).toBe(6_000);
	});

	it("ignores old mail by default", async () => {
		const b = backend([old]);
		const r = await result(
			"wait_for_message",
			{ to: "signup-8f3a", timeout_seconds: 3 },
			b,
		);
		expect(r.structuredContent).toMatchObject({
			message: null,
			timedOut: true,
		});
		expect(b.slept).toBe(3_000);
	});

	it("honours since", async () => {
		const b = backend([old]);
		const r = await result(
			"wait_for_message",
			{ to: "signup-8f3a", since: "2026-11-03T08:00:00Z" },
			b,
		);
		expect(r.structuredContent.message.id).toBe("m_old");
	});

	it("needs an address and caps the wait", async () => {
		expect((await result("wait_for_message", {}, backend([]))).isError).toBe(
			true,
		);
		expect(
			(
				await result(
					"wait_for_message",
					{ to: "a", timeout_seconds: MAX_WAIT_SECONDS + 1 },
					backend([]),
				)
			).isError,
		).toBe(true);
	});
});

describe("get_latest_code", () => {
	it("returns the code and the action link", async () => {
		const r = await result(
			"get_latest_code",
			{ to: "signup-8f3a@inbox-demo.appwrite.email" },
			backend([old, code]),
		);
		expect(r.structuredContent).toEqual({
			found: true,
			code: "482913",
			link: {
				url: "https://app.kestrel.dev/verify?token=9f2c",
				text: "Verify email",
				local: false,
				insecure: false,
			},
			messageId: "m_code",
			subject: "Your Kestrel verification code",
			from: { name: "Kestrel", address: "no-reply@kestrel.dev" },
			receivedAt: "2026-11-03T10:04:30.000Z",
		});
	});

	it("says nothing is there yet without waiting by default", async () => {
		const b = backend([]);
		const r = await result("get_latest_code", { to: "nobody" }, b);
		expect(r.structuredContent).toMatchObject({
			found: false,
			code: null,
			link: null,
		});
		expect(b.slept).toBe(0);
	});

	it("can wait", async () => {
		const b = backend([], [{ at: 2_000, message: code }]);
		const r = await result(
			"get_latest_code",
			{ to: "signup-8f3a", timeout_seconds: 5 },
			b,
		);
		expect(r.structuredContent.code).toBe("482913");
	});
});

describe("pickActionLink", () => {
	it("prefers a verify, sign-in or reset link over the rest", () => {
		expect(
			pickActionLink([
				link("https://kestrel.dev", "kestrel.dev"),
				link("https://twitter.com/kestrel", "Twitter"),
				link("https://app.kestrel.dev/reset?token=9f2c1a", "Reset password"),
			])?.label,
		).toBe("Reset password");
		expect(
			pickActionLink([
				link("https://kestrel.dev/blog", "Read more"),
				link("https://app.kestrel.dev/auth/magic?t=1", ""),
			])?.url,
		).toBe("https://app.kestrel.dev/auth/magic?t=1");
	});

	it("skips unsubscribe and social links, and falls back to the first real link", () => {
		expect(
			pickActionLink([
				link("https://kestrel.dev/unsubscribe?u=1", "Unsubscribe"),
				link("https://kestrel.dev/blog/issue-12", "Read the issue"),
			])?.label,
		).toBe("Read the issue");
		expect(
			pickActionLink([link("mailto:hi@kestrel.dev", "Email us")]),
		).toBeNull();
		expect(pickActionLink([])).toBeNull();
	});
});
