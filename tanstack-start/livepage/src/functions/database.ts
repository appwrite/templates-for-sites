import { createServerFn } from "@tanstack/react-start";
import {
	type CellEdit,
	createProperty,
	createRows,
	createView,
	deleteProperty,
	deleteView,
	duplicateRows,
	getDatabase,
	type PropertyDraft,
	type RowDraft,
	trashRows,
	updateProperty,
	updateRowMeta,
	updateView,
	writeCells,
} from "#/server/database";

export const fetchDatabase = createServerFn({ method: "GET" })
	.validator((d: { databaseId: string }) => d)
	.handler(({ data }) => getDatabase(data.databaseId));

export const submitCells = createServerFn({ method: "POST" })
	.validator((d: { databaseId: string; edits: CellEdit[] }) => d)
	.handler(({ data }) => writeCells(data.databaseId, data.edits));

export const submitCreateRows = createServerFn({ method: "POST" })
	.validator((d: { databaseId: string; rows: RowDraft[] }) => d)
	.handler(({ data }) => createRows(data.databaseId, data.rows));

export const submitTrashRows = createServerFn({ method: "POST" })
	.validator(
		(d: { databaseId: string; rowIds: string[]; restore?: boolean }) => d,
	)
	.handler(({ data }) =>
		trashRows(data.databaseId, data.rowIds, Boolean(data.restore)),
	);

export const submitDuplicateRows = createServerFn({ method: "POST" })
	.validator(
		(d: { databaseId: string; copies: { id: string; sourceId: string }[] }) =>
			d,
	)
	.handler(({ data }) => duplicateRows(data.databaseId, data.copies));

export const submitRowMeta = createServerFn({ method: "POST" })
	.validator(
		(d: {
			databaseId: string;
			rowId: string;
			patch: {
				title?: string;
				position?: number;
				coverFileId?: string | null;
				icon?: string | null;
			};
		}) => d,
	)
	.handler(({ data }) =>
		updateRowMeta(data.databaseId, data.rowId, data.patch),
	);

export const submitCreateProperty = createServerFn({ method: "POST" })
	.validator((d: PropertyDraft) => d)
	.handler(({ data }) => createProperty(data));

export const submitUpdateProperty = createServerFn({ method: "POST" })
	.validator(
		(d: {
			databaseId: string;
			propertyId: string;
			patch: {
				name?: string;
				type?: string;
				options?: Record<string, unknown>;
				position?: number;
			};
		}) => d,
	)
	.handler(({ data }) =>
		updateProperty(data.databaseId, data.propertyId, data.patch),
	);

export const submitDeleteProperty = createServerFn({ method: "POST" })
	.validator((d: { databaseId: string; propertyId: string }) => d)
	.handler(({ data }) => deleteProperty(data.databaseId, data.propertyId));

export const submitCreateView = createServerFn({ method: "POST" })
	.validator(
		(d: {
			databaseId: string;
			name: string;
			type: string;
			config: Record<string, unknown>;
			position: number;
		}) => d,
	)
	.handler(({ data }) => createView(data));

export const submitUpdateView = createServerFn({ method: "POST" })
	.validator(
		(d: {
			databaseId: string;
			viewId: string;
			patch: {
				name?: string;
				type?: string;
				config?: Record<string, unknown>;
				position?: number;
			};
		}) => d,
	)
	.handler(({ data }) => updateView(data.databaseId, data.viewId, data.patch));

export const submitDeleteView = createServerFn({ method: "POST" })
	.validator((d: { databaseId: string; viewId: string }) => d)
	.handler(({ data }) => deleteView(data.databaseId, data.viewId));
