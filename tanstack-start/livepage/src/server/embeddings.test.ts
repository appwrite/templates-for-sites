import { describe, expect, it } from "vitest";
import { closeMatches } from "./embeddings";

const hits = (pairs: [string, number][]) =>
	pairs.map(([$id, $distance]) => ({ $id, $distance }));
const ids = (docs: { $id: string }[]) => docs.map((d) => d.$id);

// Distances measured on a deployed Site, OpenAI text-embedding-3-small and Appwrite's built-in model.
describe("closeMatches", () => {
	it("keeps related pages and drops the rest (OpenAI)", () => {
		const parcels = hits([
			["courier", 0.469],
			["driver", 0.524],
			["hiking", 0.874],
			["projects", 0.898],
			["wiki", 0.952],
			["start", 0.984],
			["backup", 0.998],
		]);
		expect(ids(closeMatches(parcels))).toEqual(["courier", "driver"]);
	});

	it("keeps related pages and drops the rest (built-in)", () => {
		const dataLoss = hits([
			["backup", 0.369],
			["hiking", 0.529],
			["wiki", 0.534],
			["courier", 0.623],
			["projects", 0.625],
			["driver", 0.655],
		]);
		expect(ids(closeMatches(dataLoss))).toEqual(["backup"]);
	});

	it("returns nothing when no page stands out", () => {
		const budget = hits([
			["projects", 0.772],
			["backup", 0.79],
			["courier", 0.831],
			["driver", 0.852],
			["wiki", 0.89],
			["hiking", 0.892],
			["start", 0.963],
		]);
		expect(closeMatches(budget)).toEqual([]);
	});

	it("keeps everything without distances", () => {
		const old: { $id: string; $distance?: number }[] = [
			{ $id: "a" },
			{ $id: "b" },
			{ $id: "c" },
		];
		expect(closeMatches(old)).toEqual(old);
	});
});
