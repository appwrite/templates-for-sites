// A cell's value is stored as JSON in a text column of 65,535 bytes. Text past that is cut; anything
// else that large can't be cut sensibly, so it isn't saved. Used by the server and by direct writes.
const MAX_CELL_BYTES = 65_000;
const bytes = (text: string) => new TextEncoder().encode(text).length;

export type CellFit =
	| { fits: true; json: string; clipped: boolean; value: unknown }
	| { fits: false };

export function fitCell(value: unknown): CellFit {
	const json = JSON.stringify(value ?? null);
	const size = bytes(json);
	if (size <= MAX_CELL_BYTES)
		return { fits: true, json, clipped: false, value };
	if (typeof value !== "string") return { fits: false };
	let cut = Math.floor((value.length * MAX_CELL_BYTES) / size);
	let next = JSON.stringify(value.slice(0, cut));
	while (bytes(next) > MAX_CELL_BYTES) {
		cut = Math.floor(cut * 0.98);
		next = JSON.stringify(value.slice(0, cut));
	}
	const clipped = value.slice(0, cut);
	return { fits: true, json: next, clipped: true, value: clipped };
}
