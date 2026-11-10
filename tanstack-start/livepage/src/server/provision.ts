// Creates the database, every table and the files bucket. Idempotent and safe to re-run.
// Runs with any client that has the setup scopes: the site key in /setup, or an API key.

import {
	type Client,
	type Compression,
	Storage,
	TablesDB,
} from "node-appwrite";
import {
	BUCKET_ID,
	DATABASE_ID,
	MAX_FILE_BYTES,
	SECRETS,
	SETTINGS,
	SETTINGS_ROW,
	TABLES,
	type TableSpec,
} from "./schema.ts";

type Ignorable = { code?: number };

async function ignoreConflict<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch (err) {
		if ((err as Ignorable)?.code === 409) return null;
		throw err;
	}
}

async function exists(fn: () => Promise<unknown>) {
	try {
		await fn();
		return true;
	} catch (err) {
		if ((err as Ignorable)?.code === 404) return false;
		throw err;
	}
}

type SecretColumn = {
	status?: string;
	error?: string;
};

// Columns made inside createTable are usable at once. A column added to an existing table is not:
// Appwrite builds it in the background, and a write before it's `available` fails. So the secrets
// table is created in one call, with its value column. Encryption depends on the plan, so that
// call is tried plain when the plan refuses it. A table made by an interrupted earlier run has no
// value column yet, and then this waits, but only until `deadline`, and reports back. Callers
// return to the client and try again rather than run past the Site's time limit.
const VALUE_COLUMN = { key: "value", type: "text", required: false };

function refusedByPlan(err: unknown) {
	const { code, message } = err as { code?: number; message?: string };
	return (
		code === 400 && Boolean(message?.includes("not available on your plan"))
	);
}

async function createSecretsTable(db: TablesDB, name: string) {
	const create = (columns: object[]) =>
		db.createTable({
			databaseId: DATABASE_ID,
			tableId: SECRETS,
			name,
			permissions: [],
			rowSecurity: false,
			columns,
			indexes: [],
		});
	try {
		return await create([{ ...VALUE_COLUMN, filters: ["encrypt"] }]);
	} catch (err) {
		if (!refusedByPlan(err)) throw err;
	}
	return await create([VALUE_COLUMN]);
}

async function secretColumn(db: TablesDB): Promise<SecretColumn | null> {
	try {
		return (await db.getColumn({
			databaseId: DATABASE_ID,
			tableId: SECRETS,
			key: "value",
		})) as SecretColumn;
	} catch (err) {
		if ((err as Ignorable)?.code === 404) return null;
		throw err;
	}
}

// True once the value column is usable. False means it's still being built: call again.
async function ensureSecrets(db: TablesDB, deadline: number): Promise<boolean> {
	const spec = (TABLES as TableSpec[]).find((t) => t.id === SECRETS);
	if (
		spec &&
		!(await exists(() =>
			db.getTable({ databaseId: DATABASE_ID, tableId: SECRETS }),
		))
	) {
		const made = await ignoreConflict(() => createSecretsTable(db, spec.name));
		if (made) return true;
	}

	for (;;) {
		const column = await secretColumn(db);
		if (!column) {
			await ignoreConflict(() =>
				db
					.createTextColumn({
						databaseId: DATABASE_ID,
						tableId: SECRETS,
						key: "value",
						required: false,
						encrypt: true,
					})
					.catch((err) => {
						if (!refusedByPlan(err)) throw err;
						return db.createTextColumn({
							databaseId: DATABASE_ID,
							tableId: SECRETS,
							key: "value",
							required: false,
						});
					}),
			);
		} else if (column.status === "available") {
			return true;
		} else if (column.status === "failed" || column.status === "stuck") {
			// Appwrite won't finish this one. Clear it, and the next pass makes it again.
			await db
				.deleteColumn({
					databaseId: DATABASE_ID,
					tableId: SECRETS,
					key: "value",
				})
				.catch(() => undefined);
			return false;
		}
		if (Date.now() + 500 > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

export type ProvisionResult = {
	createdTables: string[];
	partial: boolean;
};

// The database and just the secrets table, so setup can store a verified AI key before the rest
// of the build runs. provision() skips anything this already made. False: still being built, try again.
export async function provisionSecrets(client: Client): Promise<boolean> {
	const db = new TablesDB(client);
	await ignoreConflict(() =>
		db.create({ databaseId: DATABASE_ID, name: "Livepage" }),
	);
	return ensureSecrets(db, Date.now() + 8_000);
}

export type ProvisionOptions = {
	// Epoch ms. Stops starting new tables after this, so one request stays inside the Site's time
	// limit; run again to continue. `partial` in the result says it stopped early.
	deadline?: number;
	// False when the caller creates the bucket as its own step.
	bucket?: boolean;
};

const TABLES_AT_ONCE = 4;

export async function provision(
	client: Client,
	options: ProvisionOptions = {},
): Promise<ProvisionResult> {
	const db = new TablesDB(client);
	await ignoreConflict(() =>
		db.create({ databaseId: DATABASE_ID, name: "Livepage" }),
	);
	const createdTables: string[] = [];
	// Everything except secrets, which ensureSecrets makes in one call with its encrypted column.
	const specs = (TABLES as TableSpec[]).filter((t) => t.id !== SECRETS);
	// A few tables at a time: creating one takes seconds, and setup runs inside the Site's time limit.
	for (let i = 0; i < specs.length; i += TABLES_AT_ONCE) {
		if (options.deadline && Date.now() > options.deadline)
			return { createdTables, partial: true };
		await Promise.all(
			specs.slice(i, i + TABLES_AT_ONCE).map(async (spec) => {
				const existing = await db
					.getTable({ databaseId: DATABASE_ID, tableId: spec.id })
					.catch((err: Ignorable) => {
						if (err?.code === 404) return null;
						throw err;
					});
				if (existing) {
					// Keeps table permissions in step with schema.ts on a site set up with older ones.
					if (
						JSON.stringify(existing.$permissions) !==
						JSON.stringify(spec.permissions)
					)
						await db.updateTable({
							databaseId: DATABASE_ID,
							tableId: spec.id,
							name: spec.name,
							permissions: spec.permissions,
						});
					return;
				}
				const columns = spec.columns.map(
					({ encrypt: _encrypt, ...column }) => column,
				);
				// Columns and indexes go in one call, so a table never exists half-made.
				const made = await ignoreConflict(() =>
					db.createTable({
						databaseId: DATABASE_ID,
						tableId: spec.id,
						name: spec.name,
						permissions: spec.permissions,
						rowSecurity: spec.rowSecurity,
						columns,
						indexes: spec.indexes,
					}),
				);
				if (made) createdTables.push(spec.id);
			}),
		);
	}
	if (!(await ensureSecrets(db, options.deadline ?? Date.now() + 8_000)))
		return { createdTables, partial: true };
	await ignoreConflict(() =>
		db.createRow({
			databaseId: DATABASE_ID,
			tableId: SETTINGS,
			rowId: SETTINGS_ROW,
			data: { signup: "invite" },
		}),
	);
	if (options.bucket !== false) {
		await ignoreConflict(() =>
			new Storage(client).createBucket({
				bucketId: BUCKET_ID,
				name: "Files",
				// No create for signed-in people: every upload goes through the site, which
				// sets the file's permissions (see fileOwnedBy in server/files.ts).
				permissions: [],
				fileSecurity: true,
				enabled: true,
				maximumFileSize: MAX_FILE_BYTES,
				compression: "none" as Compression,
				encryption: true,
				antivirus: true,
			}),
		);
	}
	return { createdTables, partial: false };
}
