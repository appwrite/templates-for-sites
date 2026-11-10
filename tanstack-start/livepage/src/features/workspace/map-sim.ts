// A small force-directed layout. Typed arrays and all-pairs repulsion: 500 nodes cost about a
// millisecond per tick, so a plain simulation runs comfortably inside a frame, and it stops
// doing work once the layout settles.

export type SimNode = { id: string; weight?: number };
export type SimEdge = { source: number; target: number; strength?: number };

export class Simulation {
	readonly x: Float32Array;
	readonly y: Float32Array;
	readonly vx: Float32Array;
	readonly vy: Float32Array;
	readonly pinned: Uint8Array;
	readonly count: number;
	alpha = 1;

	constructor(
		readonly nodes: SimNode[],
		readonly edges: SimEdge[],
		seed = 7,
	) {
		this.count = nodes.length;
		this.x = new Float32Array(this.count);
		this.y = new Float32Array(this.count);
		this.vx = new Float32Array(this.count);
		this.vy = new Float32Array(this.count);
		this.pinned = new Uint8Array(this.count);
		let rand = seed;
		const next = () => {
			rand = (rand * 9301 + 49297) % 233280;
			return rand / 233280;
		};
		const radius = 40 * Math.sqrt(this.count + 1);
		for (let i = 0; i < this.count; i++) {
			const angle = next() * Math.PI * 2;
			const r = Math.sqrt(next()) * radius;
			this.x[i] = Math.cos(angle) * r;
			this.y[i] = Math.sin(angle) * r;
		}
	}

	reheat(alpha = 0.6) {
		this.alpha = Math.max(this.alpha, alpha);
	}

	get settled() {
		return this.alpha < 0.002;
	}

	step() {
		const { x, y, vx, vy, pinned, count, edges } = this;
		const repulsion = -2600 * this.alpha;
		for (let i = 0; i < count; i++) {
			for (let j = i + 1; j < count; j++) {
				let dx = x[j] - x[i];
				let dy = y[j] - y[i];
				let d2 = dx * dx + dy * dy;
				if (d2 < 1) {
					dx = (i - j) * 0.5 + 0.1;
					dy = (j - i) * 0.5 + 0.1;
					d2 = dx * dx + dy * dy;
				}
				if (d2 > 250_000) continue;
				const force = repulsion / d2;
				vx[i] += force * dx;
				vy[i] += force * dy;
				vx[j] -= force * dx;
				vy[j] -= force * dy;
			}
		}
		const k = 0.08 * this.alpha;
		for (const edge of edges) {
			const dx = x[edge.target] - x[edge.source];
			const dy = y[edge.target] - y[edge.source];
			const d = Math.sqrt(dx * dx + dy * dy) || 1;
			const stretch = ((d - 90) / d) * k * (edge.strength ?? 1);
			const fx = dx * stretch;
			const fy = dy * stretch;
			vx[edge.source] += fx;
			vy[edge.source] += fy;
			vx[edge.target] -= fx;
			vy[edge.target] -= fy;
		}
		const gravity = 0.05 * this.alpha;
		for (let i = 0; i < count; i++) {
			vx[i] -= x[i] * gravity;
			vy[i] -= y[i] * gravity;
			vx[i] *= 0.82;
			vy[i] *= 0.82;
			if (pinned[i]) {
				vx[i] = 0;
				vy[i] = 0;
			} else {
				x[i] += Math.max(-60, Math.min(60, vx[i]));
				y[i] += Math.max(-60, Math.min(60, vy[i]));
			}
		}
		this.alpha *= 0.985;
	}

	// Runs without drawing, so the first paint is already a readable layout.
	settle(ticks = 180) {
		for (let i = 0; i < ticks && !this.settled; i++) this.step();
	}
}

// Everything within `depth` links of a node, as a set of node indexes.
export function neighborhood(
	adjacency: number[][],
	start: number,
	depth: number,
) {
	const seen = new Set<number>([start]);
	let frontier = [start];
	for (let d = 0; d < depth; d++) {
		const next: number[] = [];
		for (const node of frontier)
			for (const other of adjacency[node])
				if (!seen.has(other)) {
					seen.add(other);
					next.push(other);
				}
		frontier = next;
	}
	return seen;
}
