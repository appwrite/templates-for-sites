import {
	type Client,
	type Models,
	Query,
	Storage,
	TablesDB,
} from "node-appwrite";
import type {
	Attachment,
	Check,
	InboxCounts,
	InboxFilter,
	Link,
	MailboxCount,
	MessageDetail,
	MessageSummary,
} from "#/lib/types";
import { adminClient } from "./appwrite";
import { BUCKET_ID, DATABASE_ID, MESSAGES } from "./schema";

type Row = Models.Row & Record<string, unknown>;

const SUMMARY_COLUMNS = [
	"$id",
	"mailbox",
	"recipient",
	"fromName",
	"fromAddress",
	"subject",
	"preview",
	"code",
	"links",
	"linkCount",
	"attachmentCount",
	"spamScore",
	"spamVerdict",
	"receivedAt",
	"read",
];

function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== "string" || !value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function toSummary(row: Row): MessageSummary {
	const links = parseJson<Link[]>(row.links, []);
	return {
		id: row.$id,
		mailbox: String(row.mailbox || ""),
		recipient: String(row.recipient || ""),
		fromName: String(row.fromName || ""),
		fromAddress: String(row.fromAddress || ""),
		subject: String(row.subject || ""),
		preview: String(row.preview || ""),
		code: (row.code as string) || null,
		firstLink: links[0] || null,
		linkCount: Number(row.linkCount || 0),
		attachmentCount: Number(row.attachmentCount || 0),
		spamScore: typeof row.spamScore === "number" ? row.spamScore : null,
		spamVerdict: (row.spamVerdict as string) || null,
		receivedAt: String(row.receivedAt || row.$createdAt),
		read: Boolean(row.read),
	};
}

function filterQueries(filter: InboxFilter): string[] {
	switch (filter) {
		case "code":
			return [Query.isNotNull("code")];
		case "link":
			return [Query.greaterThan("linkCount", 0)];
		case "attachments":
			return [Query.greaterThan("attachmentCount", 0)];
		case "unread":
			return [Query.equal("read", false)];
		default:
			return [];
	}
}

function searchQueries(search: string): string[] {
	const q = search.trim();
	if (!q) return [];
	return [
		Query.or([
			Query.contains("mailbox", q),
			Query.contains("recipient", q),
			Query.contains("subject", q),
			Query.contains("fromAddress", q),
			Query.contains("fromName", q),
			Query.equal("code", q),
		]),
	];
}

export type ListInput = {
	filter?: InboxFilter;
	search?: string;
	mailbox?: string;
	limit?: number;
	after?: string;
};

export async function listMessages(client: Client, input: ListInput) {
	const db = new TablesDB(client);
	const queries = [
		Query.select(SUMMARY_COLUMNS),
		Query.orderDesc("receivedAt"),
		Query.limit(Math.min(Math.max(input.limit || 50, 1), 100)),
		...filterQueries(input.filter || "all"),
		...searchQueries(input.search || ""),
	];
	if (input.mailbox) queries.push(Query.equal("mailbox", input.mailbox));
	if (input.after) queries.push(Query.greaterThan("receivedAt", input.after));
	const page = await db.listRows<Row>({
		databaseId: DATABASE_ID,
		tableId: MESSAGES,
		queries,
	});
	return { messages: page.rows.map(toSummary), total: page.total };
}

export async function countMessages(client: Client): Promise<InboxCounts> {
	const db = new TablesDB(client);
	const filters: InboxFilter[] = [
		"all",
		"code",
		"link",
		"attachments",
		"unread",
	];
	const totals = await Promise.all(
		filters.map((filter) =>
			db
				.listRows({
					databaseId: DATABASE_ID,
					tableId: MESSAGES,
					queries: [
						Query.select(["$id"]),
						Query.limit(1),
						...filterQueries(filter),
					],
				})
				.then((page) => page.total),
		),
	);
	return Object.fromEntries(
		filters.map((f, i) => [f, totals[i]]),
	) as InboxCounts;
}

export async function recentMailboxes(client: Client): Promise<MailboxCount[]> {
	const page = await new TablesDB(client).listRows<Row>({
		databaseId: DATABASE_ID,
		tableId: MESSAGES,
		queries: [
			Query.select(["mailbox"]),
			Query.orderDesc("receivedAt"),
			Query.limit(300),
		],
	});
	const counts = new Map<string, number>();
	for (const row of page.rows) {
		const mailbox = String(row.mailbox || "");
		counts.set(mailbox, (counts.get(mailbox) || 0) + 1);
	}
	return [...counts.entries()]
		.slice(0, 12)
		.map(([mailbox, count]) => ({ mailbox, count }));
}

function buildChecks(
	row: Row,
	links: Link[],
	attachments: Attachment[],
	meta: Record<string, unknown>,
): Check[] {
	const checks: Check[] = [];
	const html = String(row.html || "");
	const text = String(row.text || "");
	const transport = (meta.transport || {}) as { tls?: boolean };
	checks.push(
		transport.tls
			? {
					id: "tls",
					status: "pass",
					title: "Received over TLS",
					detail: "The sending server encrypted the connection.",
				}
			: {
					id: "tls",
					status: "warn",
					title: "Received without TLS",
					detail:
						"The sending server didn't encrypt the connection. Most providers do.",
				},
	);
	const verdict = row.spamVerdict as string | null;
	if (verdict) {
		const score =
			typeof row.spamScore === "number" ? row.spamScore.toFixed(2) : "?";
		checks.push({
			id: "spam",
			status: verdict === "ham" ? "pass" : verdict === "spam" ? "fail" : "warn",
			title:
				verdict === "ham"
					? "Not spam"
					: verdict === "spam"
						? "Looks like spam"
						: "Spam check unsure",
			detail: `Spam score ${score}. Below 0.2 is not spam, 0.99 and above is spam.`,
		});
	}
	if (!String(row.subject || "").trim()) {
		checks.push({
			id: "subject",
			status: "fail",
			title: "No subject",
			detail: "Many clients show an empty subject as spam.",
		});
	}
	for (const link of links.filter((l) => l.local)) {
		checks.push({
			id: `local-${link.url}`,
			status: "fail",
			title: "Link points to a local address",
			detail: `${link.url} only works on the machine that sent it.`,
		});
	}
	const insecure = links.filter((l) => l.insecure && !l.local);
	if (insecure.length) {
		checks.push({
			id: "http",
			status: "warn",
			title: `${insecure.length} link${insecure.length === 1 ? "" : "s"} without HTTPS`,
			detail: insecure.map((l) => l.url).join("\n"),
		});
	}
	if (html && !text) {
		checks.push({
			id: "text",
			status: "warn",
			title: "No plain-text version",
			detail:
				"Some clients and spam filters expect a text part next to the HTML.",
		});
	}
	const htmlBytes = Buffer.byteLength(html, "utf8");
	if (htmlBytes > 102 * 1024) {
		checks.push({
			id: "size",
			status: "warn",
			title: "Gmail will clip this message",
			detail: `The HTML is ${Math.round(htmlBytes / 1024)} KB. Gmail cuts off anything over 102 KB.`,
		});
	}
	const imagesWithoutAlt = [...html.matchAll(/<img\b[^>]*>/gi)].filter(
		(m) => !/\balt\s*=/.test(m[0]),
	).length;
	if (imagesWithoutAlt) {
		checks.push({
			id: "alt",
			status: "warn",
			title: `${imagesWithoutAlt} image${imagesWithoutAlt === 1 ? "" : "s"} without alt text`,
			detail:
				"Screen readers and clients that block images show nothing in their place.",
		});
	}
	for (const failed of attachments.filter((a) => a.error)) {
		checks.push({
			id: `att-${failed.name}`,
			status: "fail",
			title: `${failed.name} wasn't saved`,
			detail: failed.error || "",
		});
	}
	return checks;
}

// Inline images (cid:) become data URLs, because the sandboxed preview can't send the session cookie.
async function inlineImages(
	client: Client,
	html: string,
	attachments: Attachment[],
) {
	if (!html.includes("cid:")) return html;
	const storage = new Storage(client);
	let budget = 4 * 1024 * 1024;
	let out = html;
	for (const att of attachments) {
		if (
			!att.contentId ||
			!att.fileId ||
			!att.contentType.startsWith("image/") ||
			att.size > budget
		)
			continue;
		try {
			const bytes = await storage.getFileDownload({
				bucketId: BUCKET_ID,
				fileId: att.fileId,
			});
			budget -= att.size;
			const url = `data:${att.contentType};base64,${Buffer.from(bytes).toString("base64")}`;
			out = out.split(`cid:${att.contentId}`).join(url);
		} catch {
			// Leave the cid: reference in place.
		}
	}
	return out;
}

export async function getMessage(
	client: Client,
	id: string,
	markRead = true,
): Promise<MessageDetail> {
	const db = new TablesDB(client);
	const row = await db.getRow<Row>({
		databaseId: DATABASE_ID,
		tableId: MESSAGES,
		rowId: id,
	});
	const links = parseJson<Link[]>(row.links, []);
	const attachments = parseJson<Attachment[]>(row.attachments, []);
	const meta = parseJson<Record<string, unknown>>(row.meta, {});
	const rawHeaders = (meta.headers || {}) as Record<string, string[] | string>;
	const headers: [string, string][] = [];
	for (const [name, values] of Object.entries(rawHeaders)) {
		for (const value of Array.isArray(values) ? values : [values])
			headers.push([name, String(value)]);
	}
	if (markRead && !row.read) {
		await db
			.updateRow({
				databaseId: DATABASE_ID,
				tableId: MESSAGES,
				rowId: id,
				data: { read: true },
			})
			.catch(() => undefined);
	}
	const summary = toSummary(row);
	return {
		...summary,
		text: String(row.text || ""),
		html: await inlineImages(client, String(row.html || ""), attachments),
		links,
		attachments,
		headers,
		date: String(meta.date || ""),
		messageId: String(meta.messageId || ""),
		cc: String(meta.cc || ""),
		replyTo: String(meta.replyTo || ""),
		to: String(meta.to || summary.recipient),
		transport: (meta.transport as MessageDetail["transport"]) || null,
		checks: buildChecks(row, links, attachments, meta),
		rawJson: JSON.stringify(
			{ ...meta, text: row.text, html: row.html, attachments },
			null,
			2,
		),
	};
}

export async function deleteMessage(client: Client, id: string) {
	const db = new TablesDB(client);
	const row = await db.getRow<Row>({
		databaseId: DATABASE_ID,
		tableId: MESSAGES,
		rowId: id,
	});
	const storage = new Storage(client);
	for (const att of parseJson<Attachment[]>(row.attachments, [])) {
		if (att.fileId)
			await storage
				.deleteFile({ bucketId: BUCKET_ID, fileId: att.fileId })
				.catch(() => undefined);
	}
	await db.deleteRow({ databaseId: DATABASE_ID, tableId: MESSAGES, rowId: id });
}

// Uses the site's key: rows.write and files.write.
export async function emptyInbox() {
	const client = adminClient();
	const db = new TablesDB(client);
	const storage = new Storage(client);
	const started = Date.now();
	let removed = 0;
	while (Date.now() - started < 20_000) {
		const page = await db.listRows<Row>({
			databaseId: DATABASE_ID,
			tableId: MESSAGES,
			queries: [Query.select(["$id", "attachments"]), Query.limit(100)],
		});
		if (page.rows.length === 0) break;
		const fileIds = page.rows.flatMap((row) =>
			parseJson<Attachment[]>(row.attachments, [])
				.map((a) => a.fileId)
				.filter((f): f is string => Boolean(f)),
		);
		await Promise.allSettled(
			fileIds.map((fileId) =>
				storage.deleteFile({ bucketId: BUCKET_ID, fileId }),
			),
		);
		await db.deleteRows({
			databaseId: DATABASE_ID,
			tableId: MESSAGES,
			queries: [
				Query.equal(
					"$id",
					page.rows.map((r) => r.$id),
				),
			],
		});
		removed += page.rows.length;
	}
	return removed;
}

// ---------- CI API ----------

export function apiMessage(detail: MessageDetail, origin: string) {
	return {
		id: detail.id,
		to: [detail.recipient],
		from: detail.fromName
			? `${detail.fromName} <${detail.fromAddress}>`
			: detail.fromAddress,
		subject: detail.subject,
		receivedAt: detail.receivedAt,
		codes: detail.code ? [detail.code] : [],
		links: detail.links.map(({ url, label }) => ({ text: label, url })),
		spam: detail.spamVerdict
			? { score: detail.spamScore, verdict: detail.spamVerdict }
			: null,
		text: detail.text,
		html: detail.html,
		attachments: detail.attachments.map((a) => ({
			name: a.name,
			contentType: a.contentType,
			size: a.size,
			url: a.fileId ? `${origin}/api/attachments/${a.fileId}` : null,
		})),
		headers: detail.headers,
	};
}

export async function findLatest(address: string, since: string | null) {
	const client = adminClient();
	const db = new TablesDB(client);
	const normalized = address.trim().toLowerCase();
	const queries = [Query.orderDesc("receivedAt"), Query.limit(1)];
	if (normalized.includes("@"))
		queries.push(Query.equal("recipient", normalized));
	else queries.push(Query.equal("mailbox", normalized));
	if (since) queries.push(Query.greaterThan("receivedAt", since));
	const page = await db.listRows<Row>({
		databaseId: DATABASE_ID,
		tableId: MESSAGES,
		queries,
	});
	return page.rows[0] ? page.rows[0].$id : null;
}

export async function getMessageWithKey(id: string) {
	return getMessage(adminClient(), id, false);
}
