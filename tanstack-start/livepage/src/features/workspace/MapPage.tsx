// The knowledge map: every page and database, with lines for page links and parent/child.
// A canvas, redrawn only when something changes, so 500 nodes stay smooth.
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import {
	Avatar,
	Button,
	Menu,
	Skeleton,
	Switch,
	useMenu,
	useToast,
} from "#/components/ui";
import { useAiStatus } from "#/features/ai/client";
import { fetchRelated, type SearchHit } from "#/functions/search";
import { fetchFeatures } from "#/functions/settings";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import type { Page } from "#/lib/types";
import { fetchMapLinks } from "./functions";
import { pagePath } from "./HomePage";
import { neighborhood, type SimEdge, Simulation } from "./map-sim";

type Kind = "everything" | "page" | "database";
const DEPTHS = [1, 2, 3, 0] as const;
const depthLabel = (d: number) =>
	d === 0 ? "All links" : `${d} ${d === 1 ? "link" : "links"} deep`;

type Graph = {
	pages: Page[];
	sim: Simulation;
	adjacency: number[][];
	index: Map<string, number>;
	links: { source: number; target: number; kind: "link" | "tree" }[];
};

function buildGraph(
	pages: Page[],
	rawLinks: { sourceId: string; targetId: string }[],
): Graph {
	const index = new Map(pages.map((p, i) => [p.id, i]));
	const links: Graph["links"] = [];
	const seen = new Set<string>();
	const add = (source: number, target: number, kind: "link" | "tree") => {
		const key = source < target ? `${source}:${target}` : `${target}:${source}`;
		if (seen.has(key)) return;
		seen.add(key);
		links.push({ source, target, kind });
	};
	for (const link of rawLinks) {
		const s = index.get(link.sourceId);
		const t = index.get(link.targetId);
		if (s !== undefined && t !== undefined && s !== t) add(s, t, "link");
	}
	pages.forEach((page, i) => {
		const parent = page.parentId ? index.get(page.parentId) : undefined;
		if (parent !== undefined) add(i, parent, "tree");
	});
	const adjacency: number[][] = pages.map(() => []);
	for (const link of links) {
		adjacency[link.source].push(link.target);
		adjacency[link.target].push(link.source);
	}
	const edges: SimEdge[] = links.map((l) => ({
		source: l.source,
		target: l.target,
		strength: l.kind === "link" ? 1 : 0.6,
	}));
	const sim = new Simulation(
		pages.map((p) => ({ id: p.id })),
		edges,
	);
	sim.settle(pages.length > 300 ? 120 : 200);
	return { pages, sim, adjacency, index, links };
}

function cssVar(name: string) {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

export function MapPage() {
	const { workspace, pages, pagesLoading, peers } = useWorkspace();
	const router = useRouter();
	const toast = useToast();
	const ai = useAiStatus(workspace.id);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const [links, setLinks] = useState<
		{ sourceId: string; targetId: string }[] | null
	>(null);
	const [kind, setKind] = useState<Kind>("everything");
	const [depth, setDepth] = useState<number>(2);
	const [selected, setSelected] = useState<string | null>(null);
	const [hover, setHover] = useState<number | null>(null);
	const kindMenu = useMenu();
	const depthMenu = useMenu();

	const related = ai?.vectors === true && ai.state === "ready";
	const [showRelated, setShowRelated] = useState(false);
	const [relatedHits, setRelatedHits] = useState<SearchHit[]>([]);
	// Only someone who can act on it, on a project where it can be turned on, is told about it.
	const [canTurnOnRelated, setCanTurnOnRelated] = useState(false);
	useEffect(() => {
		if (related || !ai?.canManage) {
			setCanTurnOnRelated(false);
			return;
		}
		let live = true;
		fetchFeatures({ data: { workspaceId: workspace.id } })
			.then((f) => {
				if (live)
					setCanTurnOnRelated(
						f.canChange &&
							["off", "self-on", "needs-scopes"].includes(f.vectors.kind),
					);
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [related, ai?.canManage, workspace.id]);

	useEffect(() => {
		let live = true;
		fetchMapLinks({ data: { workspaceId: workspace.id } })
			.then((rows) => live && setLinks(rows))
			.catch((err) => {
				if (live) {
					setLinks([]);
					toast.show(errorText(err), { tone: "error" });
				}
			});
		return () => {
			live = false;
		};
	}, [workspace.id, toast]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the layout only rebuilds when the set of pages changes, not on every edit
	const graph = useMemo(() => {
		if (!links) return null;
		return buildGraph(pages, links);
	}, [links, pages.map((p) => p.id).join(",")]);

	const peerPages = useMemo(() => {
		const map = new Map<string, { id: string; name: string }[]>();
		for (const peer of peers) {
			if (!peer.pageId) continue;
			map.set(peer.pageId, [
				...(map.get(peer.pageId) ?? []),
				{ id: peer.userId, name: peer.name },
			]);
		}
		return map;
	}, [peers]);

	// Everything below uses refs so wheel and drag handlers don't re-render React each frame.
	const view = useRef({ scale: 1, x: 0, y: 0 });
	const interaction = useRef<{
		mode: "none" | "pan" | "drag";
		node: number | null;
		lastX: number;
		lastY: number;
		moved: boolean;
	}>({ mode: "none", node: null, lastX: 0, lastY: 0, moved: false });
	const size = useRef({ w: 0, h: 0, dpr: 1 });
	const frame = useRef(0);
	const needsDraw = useRef(false);
	const visibleRef = useRef<Set<number> | null>(null);

	const selectedIndex =
		selected && graph ? (graph.index.get(selected) ?? null) : null;

	const visible = useMemo(() => {
		if (!graph) return null;
		const allowed = new Set<number>();
		graph.pages.forEach((p, i) => {
			if (kind === "everything" || p.kind === kind) allowed.add(i);
		});
		if (selectedIndex === null || depth === 0) return allowed;
		const near = neighborhood(graph.adjacency, selectedIndex, depth);
		for (const i of allowed) if (!near.has(i)) allowed.delete(i);
		allowed.add(selectedIndex);
		return allowed;
	}, [graph, kind, depth, selectedIndex]);
	visibleRef.current = visible;

	const selectedTitle = pages.find((p) => p.id === selected)?.title ?? "";
	useEffect(() => {
		setRelatedHits([]);
		if (!related || !showRelated || !selected) return;
		let live = true;
		fetchRelated({
			data: {
				workspaceId: workspace.id,
				pageId: selected,
				title: selectedTitle,
			},
		})
			.then((hits) => live && setRelatedHits(hits))
			.catch(() => live && setRelatedHits([]));
		return () => {
			live = false;
		};
	}, [related, showRelated, selected, selectedTitle, workspace.id]);

	const relatedRef = useRef<number[]>([]);
	relatedRef.current = graph
		? relatedHits.flatMap((hit) => graph.index.get(hit.id) ?? [])
		: [];

	const hoverRef = useRef(hover);
	hoverRef.current = hover;
	const selectedRef = useRef(selectedIndex);
	selectedRef.current = selectedIndex;

	const toWorld = useCallback((sx: number, sy: number) => {
		const { x, y, scale } = view.current;
		return { x: (sx - x) / scale, y: (sy - y) / scale };
	}, []);

	const pick = useCallback(
		(sx: number, sy: number) => {
			if (!graph) return null;
			const world = toWorld(sx, sy);
			const threshold = 14 / Math.max(view.current.scale, 0.35);
			let best: number | null = null;
			let bestDist = threshold * threshold;
			for (let i = 0; i < graph.sim.count; i++) {
				if (visibleRef.current && !visibleRef.current.has(i)) continue;
				const dx = graph.sim.x[i] - world.x;
				const dy = graph.sim.y[i] - world.y;
				const d = dx * dx + dy * dy;
				if (d < bestDist) {
					bestDist = d;
					best = i;
				}
			}
			return best;
		},
		[graph, toWorld],
	);

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas || !graph) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const { w, h, dpr } = size.current;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const { x: tx, y: ty, scale } = view.current;
		ctx.translate(tx, ty);
		ctx.scale(scale, scale);

		const ink = cssVar("--color-ink");
		const rule = cssVar("--color-rule-strong");
		const link = cssVar("--color-link");
		const paper = cssVar("--color-paper");
		const pencil = cssVar("--color-pencil");

		const sim = graph.sim;
		const shown = visibleRef.current;
		const hoverIndex = hoverRef.current;
		const selectedI = selectedRef.current;
		const focus = hoverIndex ?? selectedI;
		const focusSet =
			focus !== null ? new Set([focus, ...graph.adjacency[focus]]) : null;

		for (const edge of graph.links) {
			if (shown && (!shown.has(edge.source) || !shown.has(edge.target)))
				continue;
			const active =
				focusSet && (edge.source === focus || edge.target === focus);
			ctx.beginPath();
			ctx.moveTo(sim.x[edge.source], sim.y[edge.source]);
			ctx.lineTo(sim.x[edge.target], sim.y[edge.target]);
			ctx.strokeStyle = active ? ink : rule;
			ctx.lineWidth = (active ? 1.5 : 1) / scale;
			if (focusSet && !active) ctx.globalAlpha = 0.25;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		if (selectedI !== null) {
			ctx.setLineDash([5 / scale, 5 / scale]);
			ctx.strokeStyle = link;
			ctx.lineWidth = 1.2 / scale;
			for (const other of relatedRef.current) {
				ctx.beginPath();
				ctx.moveTo(sim.x[selectedI], sim.y[selectedI]);
				ctx.lineTo(sim.x[other], sim.y[other]);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		}

		for (let i = 0; i < sim.count; i++) {
			if (shown && !shown.has(i) && !relatedRef.current.includes(i)) continue;
			const page = graph.pages[i];
			const x = sim.x[i];
			const y = sim.y[i];
			const inFocus = focusSet ? focusSet.has(i) : true;
			const isCore = i === selectedI || i === hoverIndex;
			const important = graph.adjacency[i].length >= 3 || isCore;
			// Zoomed out to fit a phone, nodes and labels keep their on-screen size.
			const keep = 1 / Math.min(1, scale);
			const r = (isCore ? 11 : important ? 8 : 6) * Math.min(keep, 1.9);
			ctx.globalAlpha = focusSet && !inFocus ? 0.3 : 1;
			if (i === selectedI) {
				ctx.beginPath();
				ctx.fillStyle = cssVar("--color-link-soft");
				ctx.arc(x, y, r + 8, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.beginPath();
			const color = i === selectedI ? link : ink;
			if (page.kind === "database") {
				const half = r - 1;
				roundRect(ctx, x - half, y - half, half * 2, half * 2, 3);
			} else {
				ctx.arc(x, y, r, 0, Math.PI * 2);
			}
			if (important || i === selectedI) {
				ctx.fillStyle = color;
				ctx.fill();
			} else {
				ctx.fillStyle = paper;
				ctx.fill();
				ctx.strokeStyle = pencil;
				ctx.lineWidth = 1.2 / scale;
				ctx.stroke();
			}
			const showLabel =
				isCore ||
				important ||
				scale > 0.9 ||
				sim.count <= 60 ||
				focusSet?.has(i);
			if (showLabel) {
				const fontSize = (isCore ? 13 : 12) * Math.min(keep, 2.1);
				ctx.font = `${isCore || important ? 500 : 400} ${fontSize}px Geist, sans-serif`;
				ctx.fillStyle = isCore ? ink : pencil;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				const label = displayName(page);
				ctx.fillText(
					label.length > 28 ? `${label.slice(0, 27)}…` : label,
					x,
					y + r + 6 / scale,
				);
			}
			const peersHere = peerPages.get(page.id);
			if (peersHere?.length) {
				ctx.beginPath();
				ctx.fillStyle = cssVar("--color-green");
				ctx.arc(x + r + 3, y - r, 4, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}
	}, [graph, peerPages]);

	// One animation loop: simulate while the layout is warm, draw when something changed.
	const graphRef = useRef(graph);
	graphRef.current = graph;
	useEffect(() => {
		if (!graph) return;
		let stopped = false;
		const tick = () => {
			if (stopped) return;
			const current = graphRef.current;
			if (current && !current.sim.settled) {
				current.sim.step();
				needsDraw.current = true;
			}
			if (needsDraw.current) {
				needsDraw.current = false;
				draw();
			}
			frame.current = requestAnimationFrame(tick);
		};
		frame.current = requestAnimationFrame(tick);
		return () => {
			stopped = true;
			cancelAnimationFrame(frame.current);
		};
	}, [graph, draw]);

	const invalidate = useCallback(() => {
		needsDraw.current = true;
	}, []);

	useEffect(invalidate, [invalidate]);

	// Colors come from the theme, so a switch needs a redraw.
	useEffect(() => {
		const observer = new MutationObserver(invalidate);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, [invalidate]);

	// Fit to the window, and center the layout once.
	const fitted = useRef(false);
	useEffect(() => {
		const canvas = canvasRef.current;
		const wrap = wrapRef.current;
		if (!canvas || !wrap) return;
		const resize = () => {
			const rect = wrap.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			size.current = { w: rect.width, h: rect.height, dpr };
			canvas.width = Math.round(rect.width * dpr);
			canvas.height = Math.round(rect.height * dpr);
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			if (!fitted.current) {
				view.current = { scale: 1, x: rect.width / 2, y: rect.height / 2 };
				fitted.current = true;
			}
			needsDraw.current = true;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(wrap);
		return () => observer.disconnect();
	}, []);

	const fitView = useCallback(() => {
		if (!graph || !wrapRef.current) return;
		const rect = wrapRef.current.getBoundingClientRect();
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (let i = 0; i < graph.sim.count; i++) {
			minX = Math.min(minX, graph.sim.x[i]);
			maxX = Math.max(maxX, graph.sim.x[i]);
			minY = Math.min(minY, graph.sim.y[i]);
			maxY = Math.max(maxY, graph.sim.y[i]);
		}
		if (minX === Infinity) return;
		const scale = Math.min(
			1.2,
			Math.max(
				0.3,
				Math.min(
					rect.width / (maxX - minX + 180),
					rect.height / (maxY - minY + 180),
				),
			),
		);
		view.current = {
			scale,
			x: rect.width / 2 - ((minX + maxX) / 2) * scale,
			y: rect.height / 2 - ((minY + maxY) / 2) * scale,
		};
		fitted.current = true;
		needsDraw.current = true;
	}, [graph]);

	useEffect(() => {
		fitted.current = false;
		fitView();
	}, [fitView]);

	const zoomBy = (factor: number) => {
		const { w, h } = size.current;
		const { x, y, scale } = view.current;
		const nextScale = Math.max(0.15, Math.min(4, scale * factor));
		view.current = {
			scale: nextScale,
			x: w / 2 - ((w / 2 - x) / scale) * nextScale,
			y: h / 2 - ((h / 2 - y) / scale) * nextScale,
		};
		needsDraw.current = true;
	};

	// Escape lets go of the selected page and brings the whole map back.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelected(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const eventPoint = (e: { clientX: number; clientY: number }) => {
		const rect = canvasRef.current?.getBoundingClientRect();
		return {
			x: e.clientX - (rect?.left ?? 0),
			y: e.clientY - (rect?.top ?? 0),
		};
	};

	const onPointerDown = (e: React.PointerEvent) => {
		const p = eventPoint(e);
		const node = pick(p.x, p.y);
		interaction.current = {
			mode: node !== null ? "drag" : "pan",
			node,
			lastX: p.x,
			lastY: p.y,
			moved: false,
		};
		canvasRef.current?.setPointerCapture(e.pointerId);
		if (node !== null && graph) graph.sim.pinned[node] = 1;
	};

	const onPointerMove = (e: React.PointerEvent) => {
		const p = eventPoint(e);
		const state = interaction.current;
		if (state.mode === "none") {
			const node = pick(p.x, p.y);
			if (node !== hoverRef.current) setHover(node);
			if (canvasRef.current)
				canvasRef.current.style.cursor = node !== null ? "pointer" : "grab";
			return;
		}
		const dx = p.x - state.lastX;
		const dy = p.y - state.lastY;
		if (Math.abs(dx) + Math.abs(dy) > 1) state.moved = true;
		state.lastX = p.x;
		state.lastY = p.y;
		if (state.mode === "pan") {
			view.current.x += dx;
			view.current.y += dy;
			invalidate();
		} else if (state.mode === "drag" && state.node !== null && graph) {
			const world = toWorld(p.x, p.y);
			graph.sim.x[state.node] = world.x;
			graph.sim.y[state.node] = world.y;
			graph.sim.reheat(0.25);
			invalidate();
		}
	};

	const onPointerUp = (e: React.PointerEvent) => {
		const state = interaction.current;
		canvasRef.current?.releasePointerCapture(e.pointerId);
		if (state.mode === "drag" && graph && state.node !== null) {
			graph.sim.pinned[state.node] = 0;
			if (!state.moved) {
				const page = graph.pages[state.node];
				setSelected(page.id);
			}
		} else if (state.mode === "pan" && !state.moved) {
			setSelected(null);
		}
		interaction.current = {
			mode: "none",
			node: null,
			lastX: 0,
			lastY: 0,
			moved: false,
		};
	};

	const onDoubleClick = (e: React.MouseEvent) => {
		const p = eventPoint(e);
		const node = pick(p.x, p.y);
		if (node !== null && graph) open(graph.pages[node].id);
	};

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const factor = Math.exp(-e.deltaY * 0.0015);
			const { x, y, scale } = view.current;
			const nextScale = Math.max(0.15, Math.min(4, scale * factor));
			view.current = {
				scale: nextScale,
				x: px - ((px - x) / scale) * nextScale,
				y: py - ((py - y) / scale) * nextScale,
			};
			needsDraw.current = true;
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
	}, []);

	const open = useCallback(
		(pageId: string) =>
			router.navigate({ to: "/p/$pageId", params: { pageId } }),
		[router],
	);

	const page = selected ? pages.find((p) => p.id === selected) : undefined;
	const linked = useMemo(() => {
		if (!graph || selectedIndex === null) return [];
		return graph.adjacency[selectedIndex].map((i) => graph.pages[i]);
	}, [graph, selectedIndex]);
	const hereNow = selected ? (peerPages.get(selected) ?? []) : [];

	const kindItems = (["everything", "page", "database"] as Kind[]).map((k) => ({
		id: k,
		label:
			k === "everything" ? "Everything" : k === "page" ? "Pages" : "Databases",
		hint: k === kind ? "✓" : undefined,
		onSelect: () => setKind(k),
	}));
	const depthItems = DEPTHS.map((d) => ({
		id: String(d),
		label: depthLabel(d),
		hint: d === depth ? "✓" : undefined,
		onSelect: () => setDepth(d),
	}));

	return (
		<div className="flex h-full min-h-0 flex-col md:flex-row">
			<TopBarActions>
				<button
					ref={kindMenu.anchor}
					type="button"
					aria-haspopup="menu"
					onClick={kindMenu.toggle}
					className="text-sm text-graphite hover:text-ink coarse:h-10 max-md:hidden"
				>
					{kindItems.find((i) => i.id === kind)?.label}
				</button>
				<Menu
					anchor={kindMenu.anchor}
					open={kindMenu.open}
					onClose={kindMenu.close}
					items={kindItems}
					align="end"
				/>
				<button
					ref={depthMenu.anchor}
					type="button"
					aria-haspopup="menu"
					disabled={!selected}
					title={selected ? undefined : "Pick a page on the map first"}
					onClick={depthMenu.toggle}
					className="text-sm text-graphite hover:text-ink disabled:cursor-not-allowed disabled:text-pencil disabled:hover:text-pencil coarse:h-10 max-md:hidden"
				>
					{depthLabel(depth)}
				</button>
				<Menu
					anchor={depthMenu.anchor}
					open={depthMenu.open}
					onClose={depthMenu.close}
					items={depthItems}
					align="end"
				/>
				{related && (
					<div className="flex items-center gap-2 text-sm text-link max-md:text-[13px]">
						Related by meaning
						<Switch
							checked={showRelated}
							onChange={setShowRelated}
							label="Related by meaning"
						/>
					</div>
				)}
			</TopBarActions>
			<div
				ref={wrapRef}
				className="relative min-h-[300px] min-w-0 flex-1 overflow-hidden"
			>
				{(pagesLoading || links === null) && (
					<div className="absolute inset-0 z-10 p-6">
						<Skeleton className="h-full" />
					</div>
				)}
				<canvas
					ref={canvasRef}
					className="block touch-none"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerLeave={() => setHover(null)}
					onDoubleClick={onDoubleClick}
				/>
				{graph && !graph.pages.length && (
					<p className="absolute left-6 top-6 text-sm text-pencil">
						Link some pages and they'll show up here.
					</p>
				)}
				{graph && graph.pages.length > 0 && visible?.size === 0 && (
					<p className="absolute left-6 top-6 text-sm text-pencil">
						No {kind === "database" ? "databases" : "pages"} yet.
					</p>
				)}
				<div className="absolute bottom-20 right-3 flex flex-col overflow-hidden rounded-md border border-rule bg-paper shadow-[0_2px_8px_rgb(0_0_0/0.08)] md:bottom-4 md:right-4">
					{(
						[
							["Zoom in", "+", () => zoomBy(1.3)],
							["Zoom out", "−", () => zoomBy(1 / 1.3)],
							["Fit to window", "⤢", fitView],
						] as const
					).map(([label, glyph, run]) => (
						<button
							key={label}
							type="button"
							aria-label={label}
							title={label}
							onClick={run}
							className="flex size-8 items-center justify-center border-b border-rule text-md text-graphite last:border-b-0 hover:bg-wash hover:text-ink coarse:size-10"
						>
							{glyph}
						</button>
					))}
				</div>
				<div className="pointer-events-none absolute bottom-7 left-5 flex items-center gap-4 text-[13px] text-graphite max-md:gap-3 md:bottom-4 md:left-6 md:gap-5 md:text-sm">
					<span className="flex items-center gap-2">
						<span className="h-[2px] w-5 bg-ink" />
						Linked
					</span>
					{related && showRelated && (
						<span className="flex items-center gap-2">
							<span className="w-5 border-t-2 border-dotted border-link" />
							Related by meaning
						</span>
					)}
					<span className="flex items-center gap-2">
						<span className="size-2 rounded-full bg-ink" />
						Page
					</span>
					<span className="flex items-center gap-2">
						<span className="size-2 rounded-[2px] bg-ink" />
						Database
					</span>
				</div>
			</div>
			<aside className="flex w-full shrink-0 flex-col border-rule p-5 max-md:relative max-md:z-10 max-md:-mt-4 max-md:max-h-[52%] max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-t max-md:bg-paper max-md:px-5 max-md:pb-[max(16px,env(safe-area-inset-bottom))] max-md:pt-6 max-md:shadow-[0_-8px_24px_rgb(0_0_0/0.08)] md:w-[320px] md:border-l">
				<div
					aria-hidden="true"
					className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-rule-strong md:hidden"
				/>
				{page ? (
					<>
						<h2 className="font-serif text-[28px] font-medium leading-8 tracking-[-0.02em] text-ink max-md:text-[24px]">
							{displayName(page)}
						</h2>
						<p className="mt-2 text-sm leading-[18px] text-graphite">
							{page.kind === "database" ? "Database" : "Page"} in{" "}
							{pagePath(page, pages, workspace.sections) || workspace.name}
							{hereNow.length > 0 && (
								<>
									. {hereNow.map((p) => p.name.split(" ")[0]).join(" and ")}{" "}
									{hereNow.length === 1 ? "is" : "are"} here
								</>
							)}
							.
						</p>
						{hereNow.length > 0 && (
							<div className="mt-3 flex gap-1">
								{hereNow.slice(0, 5).map((person) => (
									<Avatar
										key={person.id}
										id={person.id}
										name={person.name}
										size={24}
									/>
								))}
							</div>
						)}
						<h3 className="mt-6 text-sm font-semibold text-ink">
							Linked, {linked.length}
						</h3>
						<div className="mt-2 flex max-h-[320px] flex-col gap-2.5 overflow-auto coarse:gap-0">
							{linked.length === 0 ? (
								<p className="text-sm text-pencil">Nothing links here yet.</p>
							) : (
								linked.map((other) => (
									<button
										key={other.id}
										type="button"
										onClick={() => setSelected(other.id)}
										className="truncate text-left text-base leading-[18px] text-ink hover:text-link coarse:h-10"
									>
										{displayName(other)}
									</button>
								))
							)}
						</div>
						{related && showRelated && (
							<>
								<h3 className="mt-6 text-sm font-semibold text-ink">
									Related by meaning, {relatedHits.length}
								</h3>
								<div className="mt-2 flex max-h-[200px] flex-col gap-2.5 overflow-auto">
									{relatedHits.map((hit) => (
										<button
											key={hit.id}
											type="button"
											onClick={() => setSelected(hit.id)}
											className="truncate text-left text-base leading-[18px] text-link hover:underline coarse:h-10"
										>
											{hit.title || "Untitled"}
										</button>
									))}
								</div>
							</>
						)}

						{canTurnOnRelated && (
							<p className="mt-6 border-t border-rule pt-4 text-sm leading-[18px] text-graphite">
								Turn on search by meaning in Settings to see related pages
								nobody has linked yet.
							</p>
						)}
						<Button
							variant="primary"
							className="mt-6 h-9 w-full"
							onClick={() => open(page.id)}
						>
							Open page
						</Button>
					</>
				) : (
					<>
						<h2 className="font-serif text-[28px] font-medium leading-8 tracking-[-0.02em] text-ink">
							{workspace.name}
						</h2>
						<p className="mt-2 text-sm text-graphite">
							{pages.length} {pages.length === 1 ? "page" : "pages"}. Tap or
							click one to see what it's connected to.
						</p>
					</>
				)}
			</aside>
		</div>
	);
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
) {
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
