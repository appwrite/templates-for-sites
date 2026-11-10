import { describe, expect, it } from "vitest";
import { neighborhood, Simulation } from "./map-sim";

describe("Simulation", () => {
	const nodes = Array.from({ length: 40 }, (_, i) => ({ id: String(i) }));
	const edges = nodes.slice(1).map((_, i) => ({ source: i, target: i + 1 }));

	it("settles and stops needing work", () => {
		const sim = new Simulation(nodes, edges);
		for (let i = 0; i < 2000 && !sim.settled; i++) sim.step();
		expect(sim.settled).toBe(true);
	});

	it("gives the same layout for the same graph", () => {
		const a = new Simulation(nodes, edges);
		const b = new Simulation(nodes, edges);
		a.settle(50);
		b.settle(50);
		expect(Array.from(a.x)).toEqual(Array.from(b.x));
	});

	it("keeps a pinned node where it was put", () => {
		const sim = new Simulation(nodes, edges);
		sim.pinned[3] = 1;
		sim.x[3] = 500;
		sim.y[3] = -500;
		sim.settle(30);
		expect([sim.x[3], sim.y[3]]).toEqual([500, -500]);
	});

	it("pulls linked nodes closer than unlinked ones", () => {
		const sim = new Simulation(nodes, edges);
		sim.settle(400);
		const distance = (a: number, b: number) =>
			Math.hypot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b]);
		expect(distance(0, 1)).toBeLessThan(distance(0, 39));
	});
});

describe("neighborhood", () => {
	const adjacency = [[1], [0, 2], [1, 3], [2], []];

	it("includes the start", () => {
		expect([...neighborhood(adjacency, 0, 0)]).toEqual([0]);
	});

	it("follows links up to the depth", () => {
		expect([...neighborhood(adjacency, 0, 2)].sort()).toEqual([0, 1, 2]);
	});

	it("leaves unconnected nodes out", () => {
		expect(neighborhood(adjacency, 0, 9).has(4)).toBe(false);
	});
});
