import { AppwriteException } from "node-appwrite";
import { describe, expect, it } from "vitest";
import { removeMessages } from "./messages";

type FakeRow = { $id: string; attachments: string };
type Outcome = "ok" | "gone" | "fail";

// A messages table that lists rows in creation order, like Appwrite with no order query.
function fakeDb(rows: FakeRow[]) {
	const table = [...rows];
	const parse = (queries: string[]) =>
		queries.map((q) => JSON.parse(q) as { method: string; values: unknown[] });
	const db = {
		listRows: async ({ queries }: { queries: string[] }) => {
			let start = 0;
			let limit = 25;
			for (const q of parse(queries)) {
				if (q.method === "limit") limit = Number(q.values[0]);
				if (q.method === "cursorAfter") {
					const at = table.findIndex((r) => r.$id === q.values[0]);
					if (at < 0) throw new AppwriteException("cursor not found", 400);
					start = at + 1;
				}
			}
			const page = table.slice(start, start + limit);
			return { total: table.length, rows: page };
		},
		deleteRows: async ({ queries }: { queries: string[] }) => {
			const ids = new Set(
				parse(queries).find((q) => q.method === "equal")?.values as string[],
			);
			for (let i = table.length - 1; i >= 0; i--)
				if (ids.has(table[i].$id)) table.splice(i, 1);
			return { total: ids.size, rows: [] };
		},
	};
	return { db: db as never, table };
}

function fakeStorage(outcomes: Record<string, Outcome>) {
	const deleted: string[] = [];
	const storage = {
		deleteFile: async ({ fileId }: { fileId: string }) => {
			const outcome = outcomes[fileId] ?? "ok";
			if (outcome === "gone")
				throw new AppwriteException("File not found", 404);
			if (outcome === "fail") throw new AppwriteException("Server error", 500);
			deleted.push(fileId);
			return {};
		},
	};
	return { storage: storage as never, deleted };
}

const row = (id: string, ...fileIds: string[]): FakeRow => ({
	$id: id,
	attachments: JSON.stringify(
		fileIds.map((fileId) => ({ fileId, filename: `${fileId}.pdf` })),
	),
});

const later = () => Date.now() + 60_000;

describe("removeMessages", () => {
	it("keeps a message whose attachment couldn't be deleted", async () => {
		const { db, table } = fakeDb([
			row("a"),
			row("b", "f1", "f2"),
			row("c", "f3"),
			row("d", "f4"),
		]);
		const { storage, deleted } = fakeStorage({ f2: "fail", f4: "gone" });
		const result = await removeMessages(db, storage, later());
		expect(result).toEqual({ removed: 3, kept: 1 });
		// The row still lists both files, so the one that failed can be deleted next time.
		expect(table).toEqual([row("b", "f1", "f2")]);
		expect(deleted).toEqual(["f1", "f3"]);
	});

	it("gets past more than a page of stuck messages", async () => {
		const stuck = Array.from({ length: 150 }, (_, i) => row(`s${i}`, `x${i}`));
		const clean = Array.from({ length: 50 }, (_, i) => row(`c${i}`, `y${i}`));
		const outcomes = Object.fromEntries(
			stuck.map((_, i) => [`x${i}`, "fail" as const]),
		);
		const { db, table } = fakeDb([...stuck, ...clean]);
		const { storage } = fakeStorage(outcomes);
		const result = await removeMessages(db, storage, later());
		expect(result).toEqual({ removed: 50, kept: 150 });
		expect(table.map((r) => r.$id)).toEqual(stuck.map((r) => r.$id));
	});

	it("stops at the deadline", async () => {
		const { db, table } = fakeDb([row("a")]);
		const { storage } = fakeStorage({});
		const result = await removeMessages(db, storage, Date.now() - 1);
		expect(result).toEqual({ removed: 0, kept: 0 });
		expect(table).toHaveLength(1);
	});
});
