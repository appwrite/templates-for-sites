// Brings a finished deployment's tables up to this version of the code. Only ever adds: new tables,
// columns and indexes. Columns build in the background on Appwrite, so a run starts them, and the
// next call (made from the browser after a pause) picks up the ones that are ready.
import type { Models, TablesDB } from "node-appwrite";
import { errorCode } from "./appwrite";
import {
	type Column,
	DATABASE_ID,
	type Index,
	TABLES,
	type TableSpec,
} from "./schema";

const COLUMNS_PER_RUN = 50;

export type SchemaWork = {
	tables: string[];
	columns: string[];
	indexes: string[];
	// Started and not ready yet.
	building: number;
	failed: string[];
};

type RemoteColumn = { key: string; status?: string; error?: string };
type RemoteIndex = { key: string; status?: string; error?: string };

async function columnsOf(db: TablesDB, tableId: string) {
	try {
		const { columns } = await db.listColumns({
			databaseId: DATABASE_ID,
			tableId,
		});
		return columns as unknown as RemoteColumn[];
	} catch (err) {
		if (errorCode(err) === 404) return null;
		throw err;
	}
}

async function indexesOf(db: TablesDB, tableId: string) {
	const { indexes } = await db.listIndexes({
		databaseId: DATABASE_ID,
		tableId,
	});
	return indexes as unknown as RemoteIndex[];
}

function addColumn(db: TablesDB, tableId: string, column: Column) {
	const shared = {
		databaseId: DATABASE_ID,
		tableId,
		key: column.key,
		required: column.required,
		array: column.array,
	};
	switch (column.type) {
		case "varchar":
			return db.createVarcharColumn({
				...shared,
				size: column.size ?? 255,
				xdefault: column.default as string | undefined,
			});
		case "text":
			return db.createTextColumn({ ...shared });
		case "mediumtext":
			return db.createMediumtextColumn({ ...shared });
		case "longtext":
			return db.createLongtextColumn({ ...shared });
		case "integer":
			return db.createIntegerColumn({
				...shared,
				xdefault: column.default as number | undefined,
			});
		case "bigint":
			return db.createBigIntColumn({
				...shared,
				xdefault: column.default as number | undefined,
			});
		case "double":
			return db.createFloatColumn({
				...shared,
				xdefault: column.default as number | undefined,
			});
		case "boolean":
			return db.createBooleanColumn({
				...shared,
				xdefault: column.default as boolean | undefined,
			});
		case "datetime":
			return db.createDatetimeColumn({ ...shared });
		case "enum":
			return db.createEnumColumn({
				...shared,
				elements: column.elements ?? [],
				xdefault: column.default as string | undefined,
			});
	}
}

function addIndex(db: TablesDB, tableId: string, index: Index) {
	return db.createIndex({
		databaseId: DATABASE_ID,
		tableId,
		key: index.key,
		type: index.type as Models.ColumnIndex["type"] as never,
		columns: index.attributes,
		orders: index.orders as never,
	});
}

// What's missing compared with this version of the code.
export async function schemaWork(db: TablesDB): Promise<SchemaWork> {
	const work: SchemaWork = {
		tables: [],
		columns: [],
		indexes: [],
		building: 0,
		failed: [],
	};
	for (const spec of TABLES as TableSpec[]) {
		const columns = await columnsOf(db, spec.id);
		if (!columns) {
			work.tables.push(spec.id);
			continue;
		}
		const have = new Map(columns.map((c) => [c.key, c]));
		for (const column of spec.columns) {
			const remote = have.get(column.key);
			if (!remote) work.columns.push(`${spec.id}.${column.key}`);
			else if (remote.status === "failed")
				work.failed.push(`${spec.id}.${column.key}`);
			else if (remote.status && remote.status !== "available") work.building++;
		}
		const indexes = await indexesOf(db, spec.id);
		const haveIndexes = new Map(indexes.map((i) => [i.key, i]));
		for (const index of spec.indexes) {
			const remote = haveIndexes.get(index.key);
			if (!remote) work.indexes.push(`${spec.id}.${index.key}`);
			else if (remote.status === "failed")
				work.failed.push(`${spec.id}.${index.key}`);
			else if (remote.status && remote.status !== "available") work.building++;
		}
	}
	return work;
}

// Starts everything missing. Safe to run again: a 409 means another run got there first.
export async function applySchema(db: TablesDB, deadline: number) {
	const ignoreConflict = <T>(p: Promise<T>) =>
		p.catch((err) => {
			if (errorCode(err) !== 409) throw err;
		});
	let started = 0;
	for (const spec of TABLES as TableSpec[]) {
		if (Date.now() > deadline || started >= COLUMNS_PER_RUN) break;
		const columns = await columnsOf(db, spec.id);
		if (!columns) {
			await ignoreConflict(
				db.createTable({
					databaseId: DATABASE_ID,
					tableId: spec.id,
					name: spec.name,
					permissions: spec.permissions,
					rowSecurity: spec.rowSecurity,
					columns: spec.columns.map(({ encrypt: _e, ...c }) => c),
					indexes: spec.indexes,
				}),
			);
			started++;
			continue;
		}
		const have = new Set(columns.map((c) => c.key));
		for (const column of spec.columns) {
			if (have.has(column.key)) continue;
			await ignoreConflict(addColumn(db, spec.id, column) as Promise<unknown>);
			started++;
			if (started >= COLUMNS_PER_RUN) break;
		}
		// Only index columns that are ready: an index on a column still building fails.
		const ready = new Set(
			columns.filter((c) => c.status === "available").map((c) => c.key),
		);
		const existing = new Set((await indexesOf(db, spec.id)).map((i) => i.key));
		for (const index of spec.indexes) {
			if (existing.has(index.key)) continue;
			if (!index.attributes.every((a) => a.startsWith("$") || ready.has(a)))
				continue;
			await ignoreConflict(addIndex(db, spec.id, index) as Promise<unknown>);
			started++;
		}
	}
	return started;
}
