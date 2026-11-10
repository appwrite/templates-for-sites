// Changing who can see a page. Appwrite row permissions are what actually enforce access, so every
// change rewrites the permissions on the page and on all the rows that belong to it, with the
// site key: a person can't write roles they don't hold themselves (see lib/permissions.ts).
//
// Rows are grouped per table and changed in batches (`updateRows`), so a large database costs a
// few requests and never hits the row-by-row limits a browser would.
import { type Models, Query, TablesDB } from "node-appwrite";
import { isTrusted } from "#/features/editor/access";
import {
	cellPermissions,
	contentPermissions,
	pagePermissions,
} from "#/lib/permissions";
import { type PageRow, parseShares, toPage } from "#/lib/rows";
import type { Page, Role, Share, Visibility } from "#/lib/types";
import { adminClient, errorCode } from "#/server/appwrite";
import { AuthError, requireViewer, workspaceRole } from "#/server/auth";
import { notifyUsers } from "#/server/notifications";
import {
	ACCESS_REQUESTS,
	BODIES,
	CELLS,
	COMMENTS,
	DATABASE_ID,
	LINKS,
	PAGES,
	PROPERTIES,
	UPDATES,
	VERSIONS,
	VIEWS,
} from "#/server/schema";

type AppRow = Models.Row & PageRow;
const BATCH = 100;

function chunks<T>(list: T[], size = BATCH) {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

const VISIBILITIES: Visibility[] = ["workspace", "private", "restricted"];
const LEVELS: Share["level"][] = ["edit", "comment", "view"];

export function canManageSharing(
	role: Role | null,
	page: Pick<Page, "createdBy" | "visibility">,
	userId: string,
) {
	if (!role) return false;
	if (role === "owner" || role === "admin") return true;
	if (page.createdBy === userId) return true;
	return role === "member" && page.visibility === "workspace";
}

// Loads the page through the person's own client: if they can't read it, this fails.
export async function loadManagedPage(pageId: string) {
	const { client, viewer } = await requireViewer();
	let row: AppRow;
	try {
		row = await new TablesDB(client).getRow<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: pageId,
		});
	} catch (err) {
		if (errorCode(err) === 404)
			throw new AuthError("You don't have access to this page.", "forbidden");
		throw err;
	}
	const page = toPage(row);
	const role = await workspaceRole(client, viewer.userId, page.workspaceId);
	return { client, viewer, page, role };
}

async function requireManage(pageId: string) {
	const loaded = await loadManagedPage(pageId);
	if (!canManageSharing(loaded.role, loaded.page, loaded.viewer.userId))
		throw new AuthError(
			"You can't change who has access to this page.",
			"forbidden",
		);
	return loaded;
}

// ---------- changing access ----------
//
// A big database has more rows than one request can touch before a Site times out, so a change runs
// as a job. The browser holds it and calls one step after another; each step does what it can in
// STEP_MS, and the job says what's left. It can stop and be resumed at any point. A page's own row
// goes last: it's the record that the change finished, and until then its old access still shows
// and the job can be run again.
const STEP_MS = 12_000;

type Pass = {
	tableId: string;
	attribute: string;
	value: string;
	permissions: string[];
	since?: string;
};

export type AccessJob = {
	rootId: string;
	visibility: Visibility;
	shares: Share[];
	startedAt: string;
	queue: string[];
	phase: number;
	cursor: string | null;
	done: number;
	total: number;
	before: { visibility: Visibility; shares: Share[] } | null;
};

type Target = {
	workspaceId: string;
	visibility: Visibility;
	createdBy: string;
	shares: Share[];
};

function passesFor(page: Page, target: Target, since?: string): Pass[] {
	const content = contentPermissions(target);
	const cells = cellPermissions(target);
	const pass = (tableId: string, attribute: string, permissions: string[]) => ({
		tableId,
		attribute,
		value: page.id,
		permissions,
		since,
	});
	const database =
		page.kind === "database"
			? [
					pass(CELLS, "databaseId", cells),
					pass(PROPERTIES, "databaseId", content),
					pass(VIEWS, "databaseId", content),
				]
			: [];
	return [
		pass(CELLS, "pageId", cells),
		...database,
		pass(COMMENTS, "pageId", content),
		pass(VERSIONS, "pageId", content),
		pass(LINKS, "sourceId", content),
		pass(UPDATES, "pageId", content),
		pass(BODIES, "pageId", content),
	];
}

// Rows nobody allowed could have written are removed, not rewritten: `updates` and `cells` take
// direct writes, so anyone signed in can add a row naming this page, and giving it the page's
// permissions would launder it into a trusted row. A row already carrying the new roles (a retried
// step) is fine.
function forged(row: Models.Row, before: Target, target: Target) {
	return !isTrusted(row, before) && !isTrusted(row, target);
}

async function deleteById(db: TablesDB, tableId: string, ids: string[]) {
	if (ids.length)
		await db.deleteRows({
			databaseId: DATABASE_ID,
			tableId,
			queries: [Query.equal("$id", ids)],
		});
}

async function setPermissions(
	db: TablesDB,
	tableId: string,
	ids: string[],
	permissions: string[],
	extra: Record<string, unknown> = {},
) {
	for (const part of chunks(ids))
		await db.updateRows({
			databaseId: DATABASE_ID,
			tableId,
			data: { ...extra, $permissions: permissions },
			queries: [Query.equal("$id", part)],
		});
}

// One table's rows for one page, a batch at a time, until the deadline. The next cursor, or null when done.
async function runPass(
	db: TablesDB,
	pass: Pass,
	before: Target,
	target: Target,
	start: string | null,
	deadline: number,
	count: (n: number) => void,
) {
	let cursor = start;
	for (;;) {
		const { rows } = await db.listRows<Models.Row>({
			databaseId: DATABASE_ID,
			tableId: pass.tableId,
			queries: [
				Query.equal(pass.attribute, [pass.value]),
				Query.select(["$id", "$permissions"]),
				...(pass.since
					? [Query.greaterThanEqual("$updatedAt", pass.since)]
					: []),
				Query.limit(BATCH),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		const vetted = pass.tableId === UPDATES || pass.tableId === CELLS;
		const bad = vetted ? rows.filter((r) => forged(r, before, target)) : [];
		const kept = rows.filter((r) => !bad.includes(r));
		await deleteById(
			db,
			pass.tableId,
			bad.map((r) => r.$id),
		);
		await setPermissions(
			db,
			pass.tableId,
			kept.map((r) => r.$id),
			pass.permissions,
		);
		count(rows.length);
		if (rows.length < BATCH) return null;
		cursor = rows[rows.length - 1].$id;
		if (Date.now() > deadline) return cursor;
	}
}

// The rows of a database, each with its own body, history and comments, a batch at a time.
async function runRows(
	db: TablesDB,
	page: Page,
	before: Target,
	target: Target,
	start: string | null,
	deadline: number,
	count: (n: number) => void,
) {
	const content = contentPermissions(target);
	const shares = target.shares.length ? JSON.stringify(target.shares) : null;
	let cursor = start;
	for (;;) {
		const { rows } = await db.listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				Query.equal("databaseId", [page.id]),
				Query.select(["$id", "$permissions", "createdBy"]),
				Query.limit(BATCH),
				...(cursor ? [Query.cursorAfter(cursor)] : []),
			],
		});
		if (!rows.length) return null;
		const ids = rows.map((r) => r.$id);
		// Updates are vetted row by row; the other tables are the page's own.
		const updates = await db.listRows<Models.Row>({
			databaseId: DATABASE_ID,
			tableId: UPDATES,
			queries: [
				Query.equal("pageId", ids),
				Query.select(["$id", "$permissions"]),
				Query.limit(1000),
			],
		});
		const bad = updates.rows.filter((r) => forged(r, before, target));
		await deleteById(
			db,
			UPDATES,
			bad.map((r) => r.$id),
		);
		for (const tableId of [UPDATES, BODIES, VERSIONS, COMMENTS])
			await db.updateRows({
				databaseId: DATABASE_ID,
				tableId,
				data: { $permissions: content },
				queries: [Query.equal("pageId", ids)],
			});
		await setPermissions(db, PAGES, ids, pagePermissions(target), {
			visibility: target.visibility,
			shares,
		});
		count(rows.length);
		if (rows.length < BATCH) return null;
		cursor = rows[rows.length - 1].$id;
		if (Date.now() > deadline) return cursor;
	}
}

const asTarget = (
	page: Page,
	access: { visibility: Visibility; shares: Share[] },
): Target => ({
	workspaceId: page.workspaceId,
	createdBy: page.createdBy,
	visibility: access.visibility,
	shares: access.shares,
});

async function loadRow(db: TablesDB, rowId: string) {
	try {
		return toPage(
			await db.getRow<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId,
			}),
		);
	} catch (err) {
		if (errorCode(err) === 404) return null;
		throw err;
	}
}

// Sub-pages follow their parent, so a private page can't keep shared children.
async function descendants(db: TablesDB, rootId: string) {
	const out: string[] = [];
	let level = [rootId];
	while (level.length && out.length < 1000) {
		const next: string[] = [];
		for (const part of chunks(level)) {
			const { rows } = await db.listRows<AppRow>({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				queries: [
					Query.equal("parentId", part),
					Query.select(["$id"]),
					Query.limit(500),
				],
			});
			next.push(...rows.map((r) => r.$id));
		}
		out.push(...next);
		level = next;
	}
	return out;
}

// True when rootId is this page or one of its ancestors. The queue comes back from the browser, so
// a step checks each page it's about to change really is under the page being managed.
async function isUnder(db: TablesDB, page: Page, rootId: string) {
	let current: Page | null = page;
	for (let depth = 0; current && depth < 256; depth++) {
		if (current.id === rootId) return true;
		current = current.parentId ? await loadRow(db, current.parentId) : null;
	}
	return false;
}

function normalizeShares(input: Share[]) {
	return [
		...new Map(
			input
				.filter(
					(s) => s && typeof s.userId === "string" && LEVELS.includes(s.level),
				)
				.map((s) => [s.userId, { userId: s.userId, level: s.level }]),
		).values(),
	];
}

export async function advanceAccessJob(input: AccessJob) {
	if (!VISIBILITIES.includes(input.visibility))
		throw new Error("That isn't a visibility setting.");
	await requireManage(input.rootId);
	const db = new TablesDB(adminClient());
	const deadline = Date.now() + STEP_MS;
	const job: AccessJob = {
		...input,
		shares: normalizeShares(input.shares),
	};
	const count = (n: number) => {
		job.done += n;
	};
	while (job.queue.length && Date.now() < deadline) {
		const pageId = job.queue[0];
		const page = await loadRow(db, pageId);
		if (!page) {
			job.queue = job.queue.slice(1);
			job.phase = 0;
			job.cursor = null;
			continue;
		}
		if (!(await isUnder(db, page, job.rootId)))
			throw new AuthError("You can't change access to that page.", "forbidden");
		job.before ??= { visibility: page.visibility, shares: page.shares };
		const before = asTarget(page, job.before);
		const target = asTarget(page, job);
		const passes = passesFor(page, target);
		const sweeps = [
			...passesFor(page, target, job.startedAt).filter(
				(p) => p.tableId === UPDATES || p.tableId === CELLS,
			),
		];
		const rowsPhase = passes.length;
		const firstSweep = rowsPhase + 1;
		const selfPhase = firstSweep + sweeps.length;

		if (job.phase < rowsPhase) {
			job.cursor = await runPass(
				db,
				passes[job.phase],
				before,
				target,
				job.cursor,
				deadline,
				count,
			);
			if (!job.cursor) job.phase++;
		} else if (job.phase === rowsPhase) {
			job.cursor =
				page.kind === "database"
					? await runRows(db, page, before, target, job.cursor, deadline, count)
					: null;
			if (!job.cursor) job.phase = firstSweep;
		} else if (job.phase < selfPhase) {
			// Tabs that hadn't heard yet may have written rows with the old access while this ran.
			job.cursor = await runPass(
				db,
				sweeps[job.phase - firstSweep],
				before,
				target,
				job.cursor,
				deadline,
				() => undefined,
			);
			if (!job.cursor) job.phase++;
		} else {
			await db.updateRow({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: page.id,
				data: {
					visibility: target.visibility,
					shares: target.shares.length ? JSON.stringify(target.shares) : null,
				},
				permissions: pagePermissions(target),
			});
			count(1);
			job.queue = job.queue.slice(1);
			job.phase = 0;
			job.cursor = null;
			job.before = null;
		}
	}
	return job.queue.length ? { job, done: false } : { job: null, done: true };
}

// Starts a change and runs the first step, which is enough for an ordinary page.
async function startAccessJob(
	page: Page,
	visibility: Visibility,
	shares: Share[],
) {
	const db = new TablesDB(adminClient());
	const children = await descendants(db, page.id);
	let total = children.length + 1;
	if (page.kind === "database") {
		const { total: rows } = await db.listRows<AppRow>({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			queries: [
				Query.equal("databaseId", [page.id]),
				Query.select(["$id"]),
				Query.limit(1),
			],
		});
		total += rows;
	}
	const job: AccessJob = {
		rootId: page.id,
		visibility,
		shares,
		startedAt: new Date().toISOString(),
		// Sub-pages first, the page itself last: its row says whether the change finished.
		queue: [...children.reverse(), page.id],
		phase: 0,
		cursor: null,
		done: 0,
		total,
		before: null,
	};
	return advanceAccessJob(job);
}

export async function changeVisibility(pageId: string, visibility: Visibility) {
	if (!VISIBILITIES.includes(visibility))
		throw new Error("That isn't a visibility setting.");
	const { page } = await requireManage(pageId);
	const next = { ...page, visibility };
	return {
		page: next,
		...(await startAccessJob(page, visibility, page.shares)),
	};
}

export async function changeShares(pageId: string, input: Share[]) {
	const { page } = await requireManage(pageId);
	// Shares only count for people who are really in the workspace (see pageAccess), but a level
	// that isn't one of the three shouldn't reach the row at all.
	const shares = normalizeShares(input);
	const visibility =
		page.visibility === "private" && shares.length
			? "restricted"
			: page.visibility === "restricted" && !shares.length
				? "private"
				: page.visibility;
	const next: Page = { ...page, shares, visibility };
	return { page: next, ...(await startAccessJob(page, visibility, shares)) };
}

const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSlug(title: string) {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
	let suffix = "";
	for (let i = 0; i < 6; i++)
		suffix += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
	return base ? `${base}-${suffix}` : suffix;
}

export function normalizeSlug(input: string) {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Sets or clears the public address. Published pages are read by the site's server with the site
// key, so no row ever gets a public permission: signing out of Appwrite doesn't change what's visible.
export async function setPublished(
	pageId: string,
	published: boolean,
	slug?: string,
) {
	const { page } = await requireManage(pageId);
	const db = new TablesDB(adminClient());
	if (!published) {
		await db.updateRow({
			databaseId: DATABASE_ID,
			tableId: PAGES,
			rowId: page.id,
			data: { publishedSlug: null },
		});
		return { ...page, publishedSlug: null };
	}
	const wanted = slug ? normalizeSlug(slug) : "";
	if (slug && (wanted.length < 3 || wanted.length > 128))
		throw new Error("Use 3 to 128 letters, numbers or dashes for the address.");
	for (let attempt = 0; attempt < 4; attempt++) {
		const candidate = attempt === 0 && wanted ? wanted : randomSlug(page.title);
		try {
			await db.updateRow({
				databaseId: DATABASE_ID,
				tableId: PAGES,
				rowId: page.id,
				data: { publishedSlug: candidate },
			});
			return { ...page, publishedSlug: candidate };
		} catch (err) {
			if (errorCode(err) !== 409) throw err;
			if (attempt === 0 && wanted)
				throw new Error("That address is taken. Try another one.");
		}
	}
	throw new Error("Couldn't pick a free address. Try again.");
}

// ---------- access requests ----------

export type AccessRequest = {
	id: string;
	pageId: string;
	userId: string;
	userName: string;
	note: string;
	status: "pending" | "approved" | "declined";
	createdAt: string;
};

type RequestRow = Models.Row & {
	workspaceId: string;
	pageId: string;
	userId: string;
	userName: string | null;
	note: string | null;
	status: AccessRequest["status"];
	decidedBy: string | null;
};

const toRequest = (r: RequestRow): AccessRequest => ({
	id: r.$id,
	pageId: r.pageId,
	userId: r.userId,
	userName: r.userName || "Someone",
	note: r.note || "",
	status: r.status,
	createdAt: r.$createdAt,
});

export async function listAccessRequests(pageId: string) {
	const { page } = await requireManage(pageId);
	const { rows } = await new TablesDB(adminClient()).listRows<RequestRow>({
		databaseId: DATABASE_ID,
		tableId: ACCESS_REQUESTS,
		queries: [
			Query.equal("pageId", [page.id]),
			Query.equal("status", ["pending"]),
			Query.orderDesc("$createdAt"),
			Query.limit(50),
		],
	});
	return rows.map(toRequest);
}

export async function decideAccessRequest(
	requestId: string,
	approve: boolean,
	level: Share["level"],
) {
	const db = new TablesDB(adminClient());
	const request = await db.getRow<RequestRow>({
		databaseId: DATABASE_ID,
		tableId: ACCESS_REQUESTS,
		rowId: requestId,
	});
	const { page, viewer } = await requireManage(request.pageId);
	let job: AccessJob | null = null;
	if (approve) {
		const shares = [
			...page.shares.filter((s) => s.userId !== request.userId),
			{ userId: request.userId, level },
		];
		job = (await changeShares(page.id, shares)).job;
		await notifyUsers([request.userId], {
			workspaceId: page.workspaceId,
			pageId: page.id,
			kind: "access_granted",
			actorId: viewer.userId,
			actorName: viewer.name,
			title: `${viewer.name} gave you access to ${page.title || "Untitled"}`,
		});
	}
	await db.updateRow({
		databaseId: DATABASE_ID,
		tableId: ACCESS_REQUESTS,
		rowId: requestId,
		data: {
			status: approve ? "approved" : "declined",
			decidedBy: viewer.userId,
		},
	});
	return {
		...toRequest({ ...request, status: approve ? "approved" : "declined" }),
		job,
	};
}

export { parseShares };
