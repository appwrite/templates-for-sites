import { createHash, randomBytes } from "node:crypto";
import { ID, type Models, Query, TablesDB } from "node-appwrite";
import type { TokenInfo } from "#/lib/types";
import { adminClient } from "./appwrite";
import type { Viewer } from "./auth";
import { DATABASE_ID, TOKEN_LIFETIME_DAYS, TOKENS } from "./schema";

type TokenRow = Models.Row & {
	name: string;
	hash: string;
	prefix: string;
	createdBy: string;
	createdByName: string;
	expiresAt: string;
	lastUsedAt: string | null;
};

const ALPHABET =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomToken() {
	let out = "";
	while (out.length < 32) {
		for (const byte of randomBytes(48)) {
			// 248 is the largest multiple of 62 below 256, so every character is equally likely.
			if (byte < 248 && out.length < 32)
				out += ALPHABET[byte % ALPHABET.length];
		}
	}
	return `ctk_${out}`;
}

function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function toInfo(row: TokenRow, viewer: Viewer): TokenInfo {
	return {
		id: row.$id,
		name: row.name,
		prefix: row.prefix,
		createdBy: row.createdBy,
		createdByName: row.createdByName,
		createdAt: row.$createdAt,
		expiresAt: row.expiresAt,
		lastUsedAt: row.lastUsedAt || null,
		mine: row.createdBy === viewer.userId,
	};
}

// Tokens use the site's key (rows.*). The server checks the person's role before each call.
export async function listTokens(viewer: Viewer) {
	const queries = [Query.orderDesc("$createdAt"), Query.limit(100)];
	if (viewer.role !== "admin")
		queries.push(Query.equal("createdBy", viewer.userId));
	const page = await new TablesDB(adminClient()).listRows<TokenRow>({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		queries,
	});
	return page.rows.map((row) => toInfo(row, viewer));
}

export async function createToken(viewer: Viewer, name: string) {
	const clean = name.trim().slice(0, 64);
	if (!clean)
		throw new Error("Give the token a name, like the CI job that uses it.");
	const token = randomToken();
	// Every token expires. 90 days is the longest a token lives; create a new one before then.
	const expiresAt = new Date(
		Date.now() + TOKEN_LIFETIME_DAYS * 86_400_000,
	).toISOString();
	const row = await new TablesDB(adminClient()).createRow<TokenRow>({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		rowId: ID.unique(),
		data: {
			name: clean,
			hash: hashToken(token),
			prefix: `${token.slice(0, 8)}…${token.slice(-4)}`,
			createdBy: viewer.userId,
			createdByName: viewer.name || viewer.email,
			expiresAt,
			lastUsedAt: null,
		},
	});
	return { token, info: toInfo(row, viewer) };
}

export async function revokeToken(viewer: Viewer, id: string) {
	const db = new TablesDB(adminClient());
	const row = await db.getRow<TokenRow>({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		rowId: id,
	});
	if (viewer.role !== "admin" && row.createdBy !== viewer.userId)
		throw new Error("You can only revoke your own tokens.");
	await db.deleteRow({ databaseId: DATABASE_ID, tableId: TOKENS, rowId: id });
}

export async function verifyToken(token: string | null) {
	if (!token || !/^ctk_[A-Za-z0-9]{32}$/.test(token)) return null;
	const db = new TablesDB(adminClient());
	const page = await db.listRows<TokenRow>({
		databaseId: DATABASE_ID,
		tableId: TOKENS,
		queries: [Query.equal("hash", hashToken(token)), Query.limit(1)],
	});
	const row = page.rows[0];
	if (!row || Date.parse(row.expiresAt) <= Date.now()) return null;
	const lastUsed = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0;
	if (Date.now() - lastUsed > 5 * 60_000) {
		await db
			.updateRow({
				databaseId: DATABASE_ID,
				tableId: TOKENS,
				rowId: row.$id,
				data: { lastUsedAt: new Date().toISOString() },
			})
			.catch(() => undefined);
	}
	return row;
}
