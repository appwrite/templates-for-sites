// Direct row writes from the browser, authenticated with the same short-lived JWT as Realtime.
// Only high-frequency editing goes this way (Yjs updates, cells). Everything else is a server function.
//
// Limits: Appwrite allows 120 row creates and 120 row upserts per user per minute (per IP and
// route). `createRow` and `upsertRow` keep below that with a client-side budget, and wait out 429s.

import { fetchToken } from "#/functions/realtime";
import type { TokenResult } from "#/lib/live";

type Row = {
	$id: string;
	$createdAt: string;
	$updatedAt: string;
	$permissions: string[];
	[key: string]: unknown;
};

class JwtBroker {
	private token:
		| (Extract<TokenResult, { status: "ok" }> & {
				expiresAt: number;
				issuedAt: number;
		  })
		| null = null;
	private pending: Promise<void> | null = null;

	// A JWT with at least two minutes left.
	async get() {
		if (!this.token || this.token.expiresAt - Date.now() < 120_000) {
			this.pending ??= this.refresh().finally(() => {
				this.pending = null;
			});
			await this.pending;
		}
		if (!this.token) throw new Error("You're signed out.");
		return this.token;
	}

	invalidate() {
		this.token = null;
	}

	// A request failed before it could read a response. True when the JWT in use is old enough to be
	// the cause: it's then dropped, so the next get() fetches a new one.
	discardOld() {
		if (!this.token || Date.now() - this.token.issuedAt < 5_000) return false;
		this.token = null;
		return true;
	}

	private async refresh() {
		const result = await fetchToken();
		this.token =
			result.status === "ok"
				? {
						...result,
						issuedAt: Date.now(),
						expiresAt: Date.now() + result.expiresIn * 1000,
					}
				: null;
	}
}

export const jwtBroker = new JwtBroker();

// A token bucket refilled over a minute.
class WriteBudget {
	private readonly tokens: number[] = [];
	constructor(private readonly perMinute: number) {}

	async take() {
		for (;;) {
			const now = Date.now();
			while (this.tokens.length && now - this.tokens[0] > 60_000)
				this.tokens.shift();
			if (this.tokens.length < this.perMinute) {
				this.tokens.push(now);
				return;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, 60_000 - (now - this.tokens[0]) + 50),
			);
		}
	}
}

const createBudget = new WriteBudget(100);
const upsertBudget = new WriteBudget(100);

export class WriteError extends Error {
	constructor(
		message: string,
		readonly code: number,
		readonly type: string,
	) {
		super(message);
	}
}

const SIGNED_OUT = "You're signed out.";

async function request(
	method: string,
	path: string,
	body?: unknown,
	attempt = 0,
): Promise<unknown> {
	const token = await jwtBroker.get();
	let res: Response;
	try {
		res = await fetch(`${token.endpoint}${path}`, {
			method,
			headers: {
				"content-type": "application/json",
				"X-Appwrite-Project": token.projectId,
				"X-Appwrite-JWT": token.jwt,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (err) {
		// Appwrite's 401 for a dead JWT has no CORS headers, so the browser reports it as a network
		// error. Treat that as a dead JWT once: retry with a new one, then give up.
		if (attempt === 0 && navigator.onLine !== false && jwtBroker.discardOld())
			return request(method, path, body, 1);
		throw err;
	}
	if (res.status === 401 && attempt === 0) {
		jwtBroker.invalidate();
		return request(method, path, body, 1);
	}
	if (res.status === 429 && attempt < 5) {
		// Wait for the window to pass. The bucket above keeps this rare.
		const reset = Number(res.headers.get("x-ratelimit-reset"));
		const waitMs = reset
			? Math.max(500, reset * 1000 - Date.now())
			: 5_000 * 2 ** attempt;
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(waitMs, 60_000)),
		);
		return request(method, path, body, attempt + 1);
	}
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok)
		throw new WriteError(
			String(json.message || SIGNED_OUT),
			res.status,
			String(json.type || ""),
		);
	return json;
}

const rowsPath = (databaseId: string, tableId: string) =>
	`/tablesdb/${databaseId}/tables/${tableId}/rows`;

export async function createRow(
	databaseId: string,
	tableId: string,
	rowId: string,
	data: Record<string, unknown>,
	permissions: string[],
) {
	await createBudget.take();
	return (await request("POST", rowsPath(databaseId, tableId), {
		rowId,
		data,
		permissions,
	})) as Row;
}

export async function upsertRow(
	databaseId: string,
	tableId: string,
	rowId: string,
	data: Record<string, unknown>,
	permissions: string[],
) {
	await upsertBudget.take();
	return (await request("PUT", `${rowsPath(databaseId, tableId)}/${rowId}`, {
		data,
		permissions,
	})) as Row;
}

export async function updateRow(
	databaseId: string,
	tableId: string,
	rowId: string,
	data: Record<string, unknown>,
) {
	await upsertBudget.take();
	return (await request("PATCH", `${rowsPath(databaseId, tableId)}/${rowId}`, {
		data,
	})) as Row;
}

export async function deleteRow(
	databaseId: string,
	tableId: string,
	rowId: string,
) {
	return request("DELETE", `${rowsPath(databaseId, tableId)}/${rowId}`);
}

export async function listRows(
	databaseId: string,
	tableId: string,
	queries: string[],
) {
	const params = queries
		.map((q) => `queries[]=${encodeURIComponent(q)}`)
		.join("&");
	return (await request(
		"GET",
		`${rowsPath(databaseId, tableId)}?${params}`,
	)) as { total: number; rows: Row[] };
}

export type PresenceRow = {
	$id: string;
	userId: string;
	status: string;
	metadata: Record<string, unknown>;
	$updatedAt: string;
};

// Everyone currently online whose presence this person can read.
export async function listPresences() {
	const params = `queries[]=${encodeURIComponent(JSON.stringify({ method: "limit", values: [100] }))}`;
	const result = (await request("GET", `/presences?${params}`)) as {
		presences: PresenceRow[];
	};
	return result.presences;
}
