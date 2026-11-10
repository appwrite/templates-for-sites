// Reads imports and builds exports in the browser, so a large archive never has to fit in one Site
// request. Both sides talk to the server in small batches.

import { unzipSync, zipSync } from "fflate";
import * as Y from "yjs";
import { parseCsv, toCsv } from "#/features/database/csv";
import { fromBase64 } from "#/features/editor/codec";
import {
	fetchExportBatch,
	fetchExportDatabase,
	submitImport,
} from "#/functions/settings";
import { docFileIds, docToMarkdown, type MarkdownOptions } from "#/lib/blocks";
import { randomId } from "#/lib/browser";
import type { ImportItem, ImportTooLong } from "./server/transfer";

export type SourceFile = { path: string; data: Uint8Array };

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const encode = (text: string) => new TextEncoder().encode(text);
const BATCH = 10;

// Notion names everything "Title 32hexchars"; that id isn't part of the title.
export function stripNotionId(name: string) {
	const parts = name.split(" ");
	const last = parts[parts.length - 1] ?? "";
	if (
		parts.length > 1 &&
		last.length === 32 &&
		[...last].every((c) => "0123456789abcdef".includes(c))
	)
		return parts.slice(0, -1).join(" ");
	return name;
}

// Unpacks zips, including the zip-inside-a-zip of large Notion exports.
export function expandFiles(files: SourceFile[]): SourceFile[] {
	const out: SourceFile[] = [];
	for (const file of files) {
		if (file.path.toLowerCase().endsWith(".zip")) {
			const inner = unzipSync(file.data);
			out.push(
				...expandFiles(
					Object.entries(inner).map(([path, data]) => ({ path, data })),
				),
			);
		} else if (!file.path.endsWith("/") && file.data.length > 0) out.push(file);
	}
	return out;
}

const extensionOf = (path: string) =>
	path.slice(path.lastIndexOf(".") + 1).toLowerCase();
const stemOf = (path: string) => path.slice(0, path.lastIndexOf("."));
const dirOf = (path: string) =>
	path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function firstHeading(markdown: string) {
	const line = markdown.split("\n").find((l) => l.trim());
	return line?.startsWith("# ") ? line.slice(2).trim() : null;
}

function withoutHeading(markdown: string) {
	const lines = markdown.split("\n");
	const index = lines.findIndex((l) => l.trim());
	if (index >= 0 && lines[index].startsWith("# ")) lines.splice(index, 1);
	return lines.join("\n").trim();
}

// Works out pages and databases from a tree of Markdown and CSV files. A file's parent is the page
// or database named after its folder, which is how Notion lays out an export.
export function itemsFromFiles(input: SourceFile[]): ImportItem[] {
	const files = expandFiles(input);
	const csvs = new Map<string, SourceFile>();
	for (const file of files) {
		if (extensionOf(file.path) !== "csv") continue;
		// Notion ships "X.csv" and "X_all.csv" for one database; the _all one has every row.
		const stem = stemOf(file.path);
		const key = stem.endsWith("_all") ? stem.slice(0, -4) : stem;
		if (stem.endsWith("_all") || !csvs.has(key)) csvs.set(key, file);
	}
	const pages = files.filter((f) =>
		["md", "markdown"].includes(extensionOf(f.path)),
	);
	const pageStems = new Set(pages.map((f) => stemOf(f.path)));

	const databaseFor = (dir: string) => (csvs.has(dir) ? dir : null);
	const items: ImportItem[] = [];
	const rowBodies = new Map<string, Record<string, string>>();
	for (const file of pages) {
		const markdown = decode(file.data);
		const dir = dirOf(file.path);
		const database = databaseFor(dir);
		if (database) {
			const title =
				firstHeading(markdown) ?? stripNotionId(stemOf(baseOf(file.path)));
			const bodies = rowBodies.get(database) ?? {};
			bodies[title] = withoutHeading(markdown);
			rowBodies.set(database, bodies);
			continue;
		}
		items.push({
			key: stemOf(file.path),
			parentKey: pageStems.has(dir) ? dir : null,
			kind: "page",
			title: firstHeading(markdown) ?? stripNotionId(stemOf(baseOf(file.path))),
			markdown: withoutHeading(markdown),
		});
	}
	for (const [key, file] of csvs) {
		const table = parseCsv(decode(file.data));
		const dir = dirOf(key);
		items.push({
			key,
			parentKey: pageStems.has(dir) ? dir : null,
			kind: "database",
			title: stripNotionId(baseOf(key)),
			columns: table.headers,
			rows: table.rows,
			rowBodies: rowBodies.get(key),
		});
	}
	// Parents first, so a page is never listed before the one it sits under.
	const depth = (item: ImportItem) => item.key.split("/").length;
	return items.sort((a, b) => depth(a) - depth(b));
}

// Each row of a database counts as one, so a big spreadsheet moves the bar like a big folder does.
export function importUnits(items: ImportItem[]) {
	return items.reduce((sum, i) => sum + (i.rows ? i.rows.length : 1), 0);
}

const ROW_BATCH = 200;
const BATCH_CHARS = 1_000_000;

// Cuts the import into requests that each finish well inside a Site's time limit: a few pages, or
// a slice of one database's rows. A database's first slice also creates its columns.
function importBatches(items: ImportItem[]) {
	const batches: { items: ImportItem[]; units: number }[] = [];
	let pages: ImportItem[] = [];
	let pageChars = 0;
	const flushPages = () => {
		if (pages.length) batches.push({ items: pages, units: pages.length });
		pages = [];
		pageChars = 0;
	};
	for (const item of items) {
		if (item.kind !== "database") {
			const chars = item.markdown?.length ?? 0;
			if (pages.length >= BATCH || pageChars + chars > BATCH_CHARS)
				flushPages();
			pages.push(item);
			pageChars += chars;
			continue;
		}
		flushPages();
		const rows = item.rows ?? [];
		let offset = 0;
		do {
			let end = offset;
			let chars = 0;
			while (end < rows.length && end - offset < ROW_BATCH) {
				chars += rows[end].reduce((sum, cell) => sum + cell.length, 0);
				if (chars > BATCH_CHARS && end > offset) break;
				end++;
			}
			const slice = rows.slice(offset, end);
			const rowBodies: Record<string, string> = {};
			for (const row of slice) {
				const body = item.rowBodies?.[row[0] ?? ""];
				if (body !== undefined) rowBodies[row[0] ?? ""] = body;
			}
			batches.push({
				items: [
					{
						...item,
						rows: slice,
						rowOffset: offset,
						rowBodies: Object.keys(rowBodies).length ? rowBodies : undefined,
					},
				],
				units: slice.length || 1,
			});
			offset = end;
		} while (offset < rows.length);
	}
	flushPages();
	return batches;
}

export type ImportResume = { importId: string; index: number; done: number };

// A retry carries the same import id and the batch it stopped at. Row ids come from that id, so
// even a batch sent twice lands on the same rows.
export async function runImport(
	workspaceId: string,
	items: ImportItem[],
	onProgress: (done: number) => void,
	cancelled: () => boolean,
	resume?: ImportResume,
) {
	const importId = resume?.importId ?? randomId().replaceAll("-", "");
	const batches = importBatches(items);
	const tooLong: ImportTooLong[] = [];
	const state: ImportResume = {
		importId,
		index: resume?.index ?? 0,
		done: resume?.done ?? 0,
	};
	try {
		for (; state.index < batches.length; state.index++) {
			if (cancelled()) break;
			const batch = batches[state.index];
			const result = await submitImport({
				data: { workspaceId, importId, sectionId: null, items: batch.items },
			});
			tooLong.push(...result.tooLong);
			state.done += batch.units;
			onProgress(state.done);
		}
	} catch (err) {
		throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
			resume: state,
		});
	}
	return { done: state.done, tooLong };
}

const safeName = (title: string) => {
	const cleaned = [...(title || "Untitled")]
		.map((c) => ('/\\:*?"<>|'.includes(c) || c.charCodeAt(0) < 32 ? " " : c))
		.join("")
		.trim();
	return cleaned.slice(0, 80) || "Untitled";
};

type Exported = Awaited<ReturnType<typeof fetchExportBatch>>["pages"][number];

function docOf(page: Exported) {
	const doc = new Y.Doc();
	if (page.snapshot) Y.applyUpdate(doc, fromBase64(page.snapshot));
	for (const update of page.updates) Y.applyUpdate(doc, fromBase64(update));
	return doc;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
};

type ExportImage = { path: string; data: Uint8Array };

// Downloads the images an export uses into `folder`, each once, with the signed-in person's own
// access. One that can't be read is left out and keeps its link to this site.
async function fetchImages(
	fileIds: string[],
	folder: string,
	into: Map<string, ExportImage | null>,
) {
	for (const fileId of fileIds) {
		if (into.has(fileId)) continue;
		into.set(fileId, null);
		try {
			const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
				credentials: "same-origin",
			});
			if (!res.ok) continue;
			const type = (res.headers.get("content-type") ?? "")
				.split(";")[0]
				.trim()
				.toLowerCase();
			const extension = IMAGE_EXTENSIONS[type] ?? "bin";
			const number = [...into.values()].filter(Boolean).length + 1;
			into.set(fileId, {
				path: `${folder}/image-${number}.${extension}`,
				data: new Uint8Array(await res.arrayBuffer()),
			});
		} catch {
			// Offline or gone: the Markdown links to the site instead.
		}
	}
}

// Links each image to its file in the zip, relative to a Markdown file `depth` folders down.
function zipLinks(
	images: Map<string, ExportImage | null>,
	depth: number,
): MarkdownOptions {
	return {
		imageSrc: (fileId) => {
			const image = images.get(fileId);
			return image
				? `${"../".repeat(depth)}${image.path}`
				: `${location.origin}/api/files/${fileId}`;
		},
	};
}

export function saveFile(
	data: Uint8Array | string,
	name: string,
	type: string,
) {
	const blob = new Blob(
		[typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer)],
		{ type },
	);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// One page as Markdown. As a .zip, its images come along in `images/` and the Markdown links to
// them; as a lone .md, images link to this site.
export async function exportPage(
	doc: Y.Doc,
	title: string,
	format: "md" | "zip",
) {
	const name = safeName(title);
	if (format === "md") {
		const markdown = docToMarkdown(doc, title || "Untitled", {
			imageSrc: (fileId) => `${location.origin}/api/files/${fileId}`,
		});
		saveFile(markdown, `${name}.md`, "text/markdown");
		return;
	}
	const images = new Map<string, ExportImage | null>();
	await fetchImages(docFileIds(doc), "images", images);
	const files: Record<string, Uint8Array> = {
		[`${name}.md`]: encode(
			docToMarkdown(doc, title || "Untitled", zipLinks(images, 0)),
		),
	};
	for (const image of images.values())
		if (image) files[image.path] = image.data;
	saveFile(zipSync(files, { level: 6 }), `${name}.zip`, "application/zip");
}

export async function runExport(
	workspaceId: string,
	onProgress: (done: number) => void,
	cancelled: () => boolean,
) {
	const pages: Exported[] = [];
	let cursor: string | undefined;
	for (;;) {
		if (cancelled()) return null;
		const batch = await fetchExportBatch({ data: { workspaceId, cursor } });
		pages.push(...batch.pages);
		onProgress(pages.length);
		if (!batch.cursor) break;
		cursor = batch.cursor;
	}
	const byId = new Map(pages.map((p) => [p.id, p]));
	// The images folder is taken, so a page called "images" gets another name.
	const used = new Set<string>(["images"]);
	const paths = new Map<string, string>();
	const unique = (path: string) => {
		let candidate = path;
		for (let i = 2; used.has(candidate); i++) candidate = `${path} ${i}`;
		used.add(candidate);
		return candidate;
	};
	const pathOf = (page: Exported, guard = 0): string => {
		const cached = paths.get(page.id);
		if (cached) return cached;
		const parent = page.parentId ? byId.get(page.parentId) : undefined;
		const prefix = parent && guard < 64 ? `${pathOf(parent, guard + 1)}/` : "";
		const path = unique(`${prefix}${safeName(page.title)}`);
		paths.set(page.id, path);
		return path;
	};
	const files: Record<string, Uint8Array> = {};
	const images = new Map<string, ExportImage | null>();
	for (const page of pages) {
		if (cancelled()) return null;
		const path = pathOf(page);
		if (page.kind === "database") {
			let headers: string[] = [];
			const rows: string[][] = [];
			let cursor: string | undefined;
			do {
				const slice = await fetchExportDatabase({
					data: { workspaceId, databaseId: page.id, cursor },
				});
				headers = slice.headers;
				rows.push(...slice.rows);
				cursor = slice.cursor ?? undefined;
			} while (cursor);
			files[`${path}.csv`] = encode(toCsv(headers, rows));
		} else {
			const doc = docOf(page);
			await fetchImages(docFileIds(doc), "images", images);
			const depth = path.split("/").length - 1;
			files[`${path}.md`] = encode(
				docToMarkdown(doc, page.title, zipLinks(images, depth)),
			);
			doc.destroy();
		}
	}
	for (const image of images.values())
		if (image) files[image.path] = image.data;
	return { zip: zipSync(files, { level: 6 }), count: pages.length };
}
