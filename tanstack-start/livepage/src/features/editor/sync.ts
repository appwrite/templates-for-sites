// Moves Yjs updates between this tab and Appwrite.
//
// Out: local edits batch for 150 ms and go out as at most one row per 600 ms (Appwrite allows 120
// row creates a minute). Each row carries this tab's caret. In: rows arrive on Realtime filtered to
// this page. Nothing here assumes a row arrives only once or in order; Yjs handles both.
//
// Anything not yet confirmed is kept in localStorage per tab, so a reload or a crash resends it.

import { ID, Query } from "appwrite";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { fetchBody, submitCompact, submitUpdate } from "#/functions/body";
import { createRow, jwtBroker, WriteError } from "#/lib/browser-appwrite";
import type { LiveConnection, LiveEvent } from "#/lib/live";
import { contentPermissions, rowHash } from "#/lib/permissions";
import type { Page } from "#/lib/types";
import { DATABASE_ID, rowsChannel, UPDATES } from "#/server/schema";
import { isTrusted } from "./access";
import {
	BODY_FIELD,
	type Caret,
	fromBase64,
	MAX_STATE_CHARS,
	parseCaret,
	seedUpdate,
	TITLE_FIELD,
	toBase64,
} from "./codec";

// "offline" is shown as "Saved on this device": nothing has reached Appwrite, but the edits are
// kept in localStorage and resend on reconnect. "failed" means the backend keeps refusing or the
// local copy couldn't be written, so the edits are not safe.
// "too-large" means the page no longer fits in one row, so nothing else can be written until it shrinks.
export type SaveState =
	| "saved"
	| "saving"
	| "offline"
	| "failed"
	| "denied"
	| "too-large";

const REMOTE = "appwrite";
const BATCH_MS = 150;
const WRITE_GAP_MS = 600;
const COMPACT_IDLE_MS = 8_000;
const COMPACT_ROWS = 150;
// At most this many bytes go in one row, so a long offline stretch doesn't become one huge request.
// One update bigger than this (a large paste) still goes alone, up to the size a row can take.
const BATCH_BYTES = 3 * 1024 * 1024;
// Below this much unsent, the page can't have grown past the limit, so the costly check is skipped.
const SIZE_CHECK_BYTES = 256 * 1024;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

type UpdateRow = {
	$id: string;
	$permissions: string[];
	pageId: string;
	data: string | null;
	clientId: string | null;
	cursor: string | null;
};

export type SyncOptions = {
	page: Page;
	userId: string;
	name: string;
	color: string;
	connection: LiveConnection;
	direct: boolean;
	editable: boolean;
	onState: (state: SaveState) => void;
	onCompacted?: () => void;
};

const pendingKey = (pageId: string, clientId: number) =>
	`livepage:pending:${pageId}:${clientId}`;

export class PageSync {
	readonly doc = new Y.Doc();
	readonly awareness = new Awareness(this.doc);
	private options: SyncOptions;
	private pending: Uint8Array[] = [];
	private inFlight: Uint8Array | null = null;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private compactTimer: ReturnType<typeof setTimeout> | null = null;
	private lastWriteAt = 0;
	private failures = 0;
	private state: SaveState = "saved";
	private rowsSinceCompact = 0;
	private dirtySinceCompact = false;
	private compacting = false;
	private destroyed = false;
	private denied = false;
	private loaded = false;
	private tooLarge = false;
	private unsentSinceCheck = 0;
	private restoredKeys: string[] = [];
	private online = true;
	private backedUp = true;
	private unsubscribe: (() => void) | null = null;
	private unsubscribePresence: (() => void) | null = null;
	private cachedJwt: {
		jwt: string;
		endpoint: string;
		projectId: string;
	} | null = null;
	private localCaret: Pick<Caret, "anchor" | "head"> | null = null;

	constructor(options: SyncOptions) {
		this.options = options;
		this.doc.on("update", this.onDocUpdate);
		this.awareness.setLocalState({
			user: { name: options.name, color: options.color },
		});
		this.awareness.on("update", this.onAwareness);
	}

	private get page() {
		return this.options.page;
	}

	// ---------- loading ----------

	async start() {
		const { connection } = this.options;
		this.unsubscribe = connection.subscribe({
			id: `updates-${this.page.id}`.slice(0, 36),
			channels: [rowsChannel(UPDATES)],
			queries: [Query.equal("pageId", [this.page.id])],
			onEvent: (event) => this.onRow(event),
		});
		this.unsubscribePresence = connection.subscribe({
			id: `presence-${this.page.id}`.slice(0, 36),
			channels: ["presences"],
			onEvent: (event) => this.onPresence(event),
		});
		this.online =
			typeof navigator === "undefined" || navigator.onLine !== false;
		if (!this.online) this.setState("offline");
		// Read before loading but applied after: a backup usually builds on rows the load brings in, and
		// Yjs would park it, then integrate it under the load's origin, where it never gets sent.
		const unsent = this.readUnsent();
		await this.load();
		if (this.destroyed) return;
		this.restoreUnsent(unsent);
		this.loaded = true;
		await this.seed();
		void this.cacheJwt();
		if (this.pending.length) this.schedule(0);
	}

	private async load() {
		const body = await fetchBody({ data: { pageId: this.page.id } });
		this.doc.transact(() => {
			if (body.snapshot)
				Y.applyUpdate(this.doc, fromBase64(body.snapshot), REMOTE);
			for (const row of body.updates)
				Y.applyUpdate(this.doc, fromBase64(row.data), REMOTE);
		}, REMOTE);
		this.rowsSinceCompact = body.updates.length;
		if (this.rowsSinceCompact >= COMPACT_ROWS && this.options.editable)
			this.scheduleCompact(1_000);
	}

	// A page nobody has typed in yet: give it its first paragraph, and the title it was created with.
	private async seed() {
		if (!this.options.editable) return;
		const seeds: Array<[string, string]> = [];
		if (this.doc.getXmlFragment(BODY_FIELD).length === 0)
			seeds.push([BODY_FIELD, ""]);
		if (this.doc.getXmlFragment(TITLE_FIELD).length === 0)
			seeds.push([TITLE_FIELD, this.page.title]);
		for (const [field, text] of seeds) {
			if (this.destroyed) return;
			const update = seedUpdate(this.page.id, field, text);
			Y.applyUpdate(this.doc, update, REMOTE);
			await this.writeSeed(field, update);
		}
	}

	private async writeSeed(field: string, update: Uint8Array) {
		const data = toBase64(update);
		const rowId = seedRowId(this.page.id, field);
		try {
			await this.send(rowId, data, null);
		} catch (err) {
			// 409: another browser wrote the same seed first, which is the same bytes.
			if (!(err instanceof WriteError) || err.code !== 409) throw err;
		}
	}

	// Edits a previous session of this tab or another never got confirmed. Left in place until they're
	// sent: an error while loading the page must not cost anyone their work.
	private readUnsent() {
		const found: { key: string; value: string }[] = [];
		if (!this.options.editable) return found;
		try {
			const prefix = `livepage:pending:${this.page.id}:`;
			for (const key of Object.keys(localStorage)) {
				if (!key.startsWith(prefix)) continue;
				const value = localStorage.getItem(key);
				if (value) found.push({ key, value });
			}
		} catch {
			// Private windows can refuse storage. Editing still works.
		}
		return found;
	}

	// Always queued for sending, even when applying changes nothing here: the backup exists because
	// the server may never have had these bytes.
	private restoreUnsent(unsent: { key: string; value: string }[]) {
		const parts: Uint8Array[] = [];
		const keys: string[] = [];
		for (const { key, value } of unsent) {
			try {
				parts.push(fromBase64(value));
				keys.push(key);
			} catch {
				// Not something this app wrote. Leave it alone.
			}
		}
		if (!parts.length) return;
		const update = Y.mergeUpdates(parts);
		Y.applyUpdate(this.doc, update, REMOTE);
		this.pending.push(update);
		this.restoredKeys = keys;
		this.saveBackup();
		if (this.backedUp) this.clearRestored();
		this.setState(this.localState());
	}

	// Called once this session's own backup or a confirmed write covers what they held.
	private clearRestored() {
		try {
			for (const key of this.restoredKeys) localStorage.removeItem(key);
		} catch {
			// Nothing to clear.
		}
		this.restoredKeys = [];
	}

	// ---------- incoming ----------

	private onRow(event: LiveEvent) {
		if (!event.events.some((e) => e.endsWith(".create"))) return;
		const row = event.payload as UpdateRow;
		if (row.pageId !== this.page.id || !row.data) return;
		if (row.clientId === String(this.doc.clientID)) return;
		// Anyone signed in can add a row naming this page, so only rows a page member wrote count.
		if (!isTrusted(row, this.page)) return;
		Y.applyUpdate(this.doc, fromBase64(row.data), REMOTE);
		this.rowsSinceCompact++;
		this.applyCaret(row.clientId, parseCaret(row.cursor));
		if (this.rowsSinceCompact >= COMPACT_ROWS && this.options.editable)
			this.scheduleCompact(0);
	}

	private onPresence(event: LiveEvent) {
		type PresenceRow = {
			userId: string;
			metadata?: {
				pageId?: string | null;
				clientId?: string;
				cursor?: string;
			};
		};
		const row = event.payload as PresenceRow;
		const left = event.events.some((e) => e.endsWith(".delete"));
		if (left || row.metadata?.pageId !== this.page.id) {
			this.dropCarets(row.userId);
			return;
		}
		this.applyCaret(
			row.metadata?.clientId ?? null,
			parseCaret(row.metadata?.cursor),
		);
	}

	private applyCaret(clientId: string | null, caret: Caret | null) {
		const id = Number(clientId);
		if (!clientId || !Number.isFinite(id) || !caret) return;
		if (caret.userId === this.options.userId || id === this.doc.clientID)
			return;
		const fresh = !this.awareness.states.has(id);
		this.awareness.states.set(id, {
			user: { name: caret.name, color: caret.color },
			cursor: { anchor: caret.anchor, head: caret.head },
			userId: caret.userId,
		});
		// Far in the future, because this module decides when a caret goes away, not the Awareness timer.
		this.awareness.meta.set(id, {
			clock: 1,
			lastUpdated: Number.MAX_SAFE_INTEGER,
		});
		this.awareness.emit("change", [
			{
				added: fresh ? [id] : [],
				updated: fresh ? [] : [id],
				removed: [],
			},
			"remote",
		]);
	}

	applyPresenceCaret(clientId: string | null, caret: Caret | null) {
		this.applyCaret(clientId, caret);
	}

	dropCarets(userId: string) {
		const removed: number[] = [];
		for (const [id, state] of this.awareness.states)
			if ((state as { userId?: string }).userId === userId) removed.push(id);
		if (!removed.length) return;
		for (const id of removed) {
			this.awareness.states.delete(id);
			this.awareness.meta.delete(id);
		}
		this.awareness.emit("change", [
			{ added: [], updated: [], removed },
			"remote",
		]);
	}

	// ---------- outgoing ----------

	private onDocUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === REMOTE) return;
		this.pending.push(update);
		this.saveBackup();
		this.setState(this.localState());
		if (this.loaded) this.schedule();
	};

	// Takes one row's worth off the queue, oldest first.
	private takeBatch() {
		const parts: Uint8Array[] = [];
		let bytes = 0;
		while (this.pending.length) {
			const next = this.pending[0];
			if (parts.length && bytes + next.length > BATCH_BYTES) break;
			parts.push(next);
			bytes += next.length;
			this.pending.shift();
		}
		return Y.mergeUpdates(parts);
	}

	// Whether the page still fits in a row, counting only content that hasn't been deleted: reading the
	// state back through a fresh doc lets Yjs drop what was deleted, which the undo stack otherwise keeps.
	private fits() {
		const unsent = this.pending.reduce((sum, u) => sum + u.length, 0);
		this.unsentSinceCheck += unsent;
		if (!this.tooLarge && this.unsentSinceCheck < SIZE_CHECK_BYTES) return true;
		this.unsentSinceCheck = 0;
		const copy = new Y.Doc();
		Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.doc));
		const state = Y.encodeStateAsUpdate(copy);
		copy.destroy();
		if ((state.length * 4) / 3 > MAX_STATE_CHARS) {
			this.tooLarge = true;
			this.setState("too-large");
			return false;
		}
		if (this.tooLarge) {
			// It shrank. The queue may still hold the oversized update, so send the state as it is now.
			this.tooLarge = false;
			this.pending = [state];
			this.saveBackup();
		}
		return true;
	}

	private schedule(delay = BATCH_MS) {
		if (this.flushTimer || this.destroyed) return;
		const wait = Math.max(delay, this.lastWriteAt + WRITE_GAP_MS - Date.now());
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, wait);
	}

	private async flush() {
		if (this.inFlight || this.denied || !this.pending.length) return;
		if (!this.fits()) return;
		const batch = this.takeBatch();
		this.inFlight = batch;
		this.setState(this.localState());
		try {
			await this.send(ID.unique(), toBase64(batch), this.caretValue());
			this.inFlight = null;
			this.lastWriteAt = Date.now();
			this.failures = 0;
			this.saveBackup();
			if (!this.pending.length) this.clearRestored();
			this.dirtySinceCompact = true;
			this.rowsSinceCompact++;
			if (this.pending.length) {
				this.setState(this.localState());
				this.schedule();
			} else {
				this.setState("saved");
			}
			this.scheduleCompact();
		} catch (err) {
			this.inFlight = null;
			this.pending.unshift(batch);
			this.saveBackup();
			// The server won't take a row this big. Not a permissions problem, so not "denied".
			if (err instanceof WriteError && err.code === 413) {
				this.tooLarge = true;
				this.setState("too-large");
				return;
			}
			const refused =
				err instanceof WriteError
					? err.code >= 400 &&
						err.code < 500 &&
						err.code !== 408 &&
						err.code !== 429
					: String((err as { message?: unknown })?.message).includes(
							"can only view",
						);
			if (refused) {
				this.denied = true;
				this.setState("denied");
				return;
			}
			// Couldn't reach the server (no response, or the socket's gone) reads the same as offline.
			// A server that answers with an error, twice in a row, is a real failure worth saying out loud.
			const unreachable = err instanceof TypeError;
			this.failures++;
			if (unreachable) this.setState(this.backedUp ? "offline" : "failed");
			else this.setState(this.failures >= 2 ? "failed" : "saving");
			const wait =
				BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)];
			this.schedule(wait);
		}
	}

	private async send(rowId: string, data: string, cursor: string | null) {
		const clientId = String(this.doc.clientID);
		if (!this.options.direct) {
			await submitUpdate({
				data: { pageId: this.page.id, rowId, data, clientId, cursor },
			});
			return;
		}
		await createRow(
			DATABASE_ID,
			UPDATES,
			rowId,
			{
				workspaceId: this.page.workspaceId,
				pageId: this.page.id,
				data,
				clientId,
				cursor,
				createdBy: this.options.userId,
			},
			contentPermissions(this.page),
		);
		void this.cacheJwt();
	}

	private async cacheJwt() {
		try {
			const token = await jwtBroker.get();
			this.cachedJwt = {
				jwt: token.jwt,
				endpoint: token.endpoint,
				projectId: token.projectId,
			};
		} catch {
			// Leaves the previous one; the backup in localStorage covers this.
		}
	}

	private saveBackup() {
		try {
			const key = pendingKey(this.page.id, this.doc.clientID);
			const items = [...this.pending];
			if (this.inFlight) items.push(this.inFlight);
			if (!items.length) localStorage.removeItem(key);
			else localStorage.setItem(key, toBase64(Y.mergeUpdates(items)));
			this.backedUp = true;
		} catch {
			// Over quota or storage is blocked. The next state says so.
			this.backedUp = false;
		}
	}

	// The page is going away. Send what's left with a keepalive request, which outlives the page.
	flushOnExit() {
		const items = [...this.pending];
		if (this.inFlight) items.push(this.inFlight);
		if (!items.length || !this.cachedJwt || !this.options.direct) return;
		const data = toBase64(Y.mergeUpdates(items));
		if (data.length > 60_000) return; // keepalive bodies are capped; the backup resends it next time.
		const { endpoint, projectId, jwt } = this.cachedJwt;
		try {
			void fetch(`${endpoint}/tablesdb/${DATABASE_ID}/tables/${UPDATES}/rows`, {
				method: "POST",
				keepalive: true,
				headers: {
					"content-type": "application/json",
					"X-Appwrite-Project": projectId,
					"X-Appwrite-JWT": jwt,
				},
				body: JSON.stringify({
					rowId: ID.unique(),
					data: {
						workspaceId: this.page.workspaceId,
						pageId: this.page.id,
						data,
						clientId: String(this.doc.clientID),
						cursor: this.caretValue(),
						createdBy: this.options.userId,
					},
					permissions: contentPermissions(this.page),
				}),
			});
		} catch {
			// The backup in localStorage covers this.
		}
	}

	// The page as it is now, from Realtime. Rows are written with the permissions in force when they
	// are sent, so a page that changed access has to be told here or new rows carry the old roles.
	setPage(page: Page, access: { direct: boolean; editable: boolean }) {
		const changed =
			contentPermissions(page).join() !== contentPermissions(this.page).join();
		const lost = this.options.editable && !access.editable;
		this.options = { ...this.options, page, ...access };
		if (lost) {
			this.denied = true;
			this.setState("denied");
			return;
		}
		if (!changed || !this.options.editable || !this.loaded) return;
		// Anything written just before this arrived went out with the old roles, and compaction won't
		// merge it. This row carries all of it under the new ones.
		this.pending.push(Y.encodeStateAsUpdate(this.doc));
		this.saveBackup();
		this.schedule(0);
	}

	setOnline(online: boolean) {
		this.online = online;
		if (online) {
			this.failures = 0;
			if (this.unsent) this.setState("saving");
			else this.setState("saved");
			if (this.pending.length) this.schedule(0);
		} else {
			this.setState(this.backedUp ? "offline" : "failed");
		}
	}

	// What to show while edits are waiting to go out.
	private localState(): SaveState {
		if (this.online) return "saving";
		return this.backedUp ? "offline" : "failed";
	}

	// After a dropped socket: events sent while it was away were not replayed, so read them.
	async resync() {
		if (this.destroyed) return;
		try {
			await this.load();
			if (this.pending.length) this.schedule(0);
		} catch {
			// The next reconnect tries again.
		}
	}

	private setState(state: SaveState) {
		// A denied editor stays denied, even if an old request finishes afterwards.
		if (this.denied && state !== "denied") return;
		if (this.state === state) return;
		this.state = state;
		this.options.onState(state);
	}

	get unsent() {
		return this.pending.length > 0 || this.inFlight !== null;
	}

	// ---------- carets ----------

	private onAwareness = () => {
		const local = this.awareness.getLocalState() as {
			cursor?: { anchor: unknown; head: unknown } | null;
		} | null;
		const cursor = local?.cursor ?? null;
		const next = cursor ? { anchor: cursor.anchor, head: cursor.head } : null;
		if (JSON.stringify(next) === JSON.stringify(this.localCaret)) return;
		this.localCaret = next;
		this.publishPresence();
	};

	private caretValue(): string | null {
		if (!this.localCaret) return null;
		const value = JSON.stringify({
			...this.localCaret,
			name: this.options.name.slice(0, 60),
			color: this.options.color,
			userId: this.options.userId,
			at: Date.now(),
		} satisfies Caret);
		return value.length <= 1024 ? value : null;
	}

	// Idle caret moves go over Presence, which is throttled to one message per 2.5 s by LiveConnection.
	publishPresence() {
		if (
			typeof document !== "undefined" &&
			document.visibilityState === "hidden"
		)
			return;
		this.options.connection.setPresence({
			status: "online",
			metadata: {
				workspaceId: this.page.workspaceId,
				pageId: this.page.id,
				name: this.options.name,
				clientId: String(this.doc.clientID),
				cursor: this.caretValue() ?? undefined,
			},
			permissions: [`read("team:${this.page.workspaceId}")`],
		});
	}

	// ---------- compaction ----------

	private scheduleCompact(delay = COMPACT_IDLE_MS) {
		if (!this.options.editable || this.destroyed) return;
		if (this.compactTimer) clearTimeout(this.compactTimer);
		this.compactTimer = setTimeout(() => {
			this.compactTimer = null;
			void this.compact();
		}, delay);
	}

	async compact() {
		if (this.compacting || !this.options.editable || this.destroyed) return;
		if (!this.dirtySinceCompact && this.rowsSinceCompact < COMPACT_ROWS) return;
		this.compacting = true;
		try {
			const result = await submitCompact({ data: { pageId: this.page.id } });
			if (result.status === "ok") {
				this.rowsSinceCompact = 0;
				this.dirtySinceCompact = false;
				this.options.onCompacted?.();
			} else if (result.status === "too_large") {
				this.tooLarge = true;
				this.setState("too-large");
			}
		} catch (err) {
			// Compaction is housekeeping, and the next one picks up where this stopped. The one failure
			// that matters here is access being gone: nothing typed from now on would ever be merged.
			const message = String((err as { message?: unknown })?.message);
			if (
				message.includes("can only view") ||
				message.includes("don't have access")
			) {
				this.denied = true;
				this.setState("denied");
			}
		} finally {
			this.compacting = false;
		}
	}

	destroy() {
		this.flushOnExit();
		if (this.unsent && !this.options.direct) {
			// Keepalive only covers direct writes; the backup covers this if the request doesn't finish.
			const items = [...this.pending];
			if (this.inFlight) items.push(this.inFlight);
			void submitUpdate({
				data: {
					pageId: this.page.id,
					rowId: ID.unique(),
					data: toBase64(Y.mergeUpdates(items)),
					clientId: String(this.doc.clientID),
					cursor: null,
				},
			}).catch(() => undefined);
		}
		if (this.dirtySinceCompact)
			void submitCompact({ data: { pageId: this.page.id } }).catch(
				() => undefined,
			);
		this.destroyed = true;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		if (this.compactTimer) clearTimeout(this.compactTimer);
		this.unsubscribe?.();
		this.unsubscribePresence?.();
		this.awareness.destroy();
		this.doc.off("update", this.onDocUpdate);
	}
}

function seedRowId(pageId: string, field: string) {
	return rowHash("seed", pageId, field);
}
