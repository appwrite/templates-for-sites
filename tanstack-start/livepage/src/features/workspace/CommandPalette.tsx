// ⌘K: search, recent pages and commands in one list, driven entirely from the keyboard.
import { useRouter } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	MoonIcon,
	PageIcon,
	SearchIcon,
	SparkleFilled,
	TableIcon,
} from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { useAiStatus, useVectorRefresh } from "#/features/ai/client";
import { type SearchHit, searchMeaning, searchPages } from "#/functions/search";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import { applyTheme, isDark } from "#/lib/theme";
import type { Page, PageKind } from "#/lib/types";
import { useExtras } from "./extras";
import { firstName, joinNames } from "./format";

type Row = {
	id: string;
	section: string;
	label: string;
	icon: ReactNode;
	hint?: ReactNode;
	snippet?: string | null;
	accent?: boolean;
	run: () => void;
};

const SEARCH_DELAY = 140;
const MEANING_DELAY = 450;

function pageGlyph(kind: PageKind, icon: string | null) {
	if (icon && !icon.startsWith("file:"))
		return <span className="text-sm leading-none">{icon}</span>;
	return kind === "database" ? <TableIcon size={15} /> : <PageIcon size={15} />;
}

export function CommandPalette() {
	const { workspace, pages, peers, viewer } = useWorkspace();
	const { recents, favorites } = useExtras();
	const ai = useAiStatus(workspace.id);
	// The palette is mounted on every workspace screen, so meaning search gets its catch-up here.
	useVectorRefresh(workspace.id, ai);
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [meaning, setMeaning] = useState<SearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const previous = useRef<HTMLElement | null>(null);
	const term = query.trim();

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
		setHits([]);
		setMeaning([]);
		setError(null);
		previous.current?.focus();
	}, []);

	const show = useCallback(() => {
		previous.current = document.activeElement as HTMLElement | null;
		setOpen(true);
		setActive(0);
	}, []);

	useEffect(() => {
		const onCommand = () => show();
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.metaKey || e.ctrlKey) &&
				!e.shiftKey &&
				!e.altKey &&
				e.key.toLowerCase() === "k"
			) {
				e.preventDefault();
				setOpen((was) => {
					if (was) {
						setQuery("");
						return false;
					}
					previous.current = document.activeElement as HTMLElement | null;
					setActive(0);
					return true;
				});
			}
		};
		window.addEventListener("livepage:command", onCommand);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("livepage:command", onCommand);
			window.removeEventListener("keydown", onKey);
		};
	}, [show]);

	useEffect(() => {
		if (open) requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	// Keyword search: the results for the newest query always win.
	useEffect(() => {
		if (!open) return;
		if (term.length < 2) {
			setHits([]);
			setLoading(false);
			return;
		}
		let live = true;
		setLoading(true);
		const timer = setTimeout(() => {
			searchPages({ data: { workspaceId: workspace.id, query: term } })
				.then((found) => {
					if (!live) return;
					setHits(found);
					setError(null);
				})
				.catch((err) => live && setError(errorText(err)))
				.finally(() => live && setLoading(false));
		}, SEARCH_DELAY);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [open, term, workspace.id]);

	const canAsk = ai?.state === "ready" && ai.ask;
	const vectors = Boolean(ai?.vectors && ai.state === "ready");
	const hitIds = useMemo(() => hits.map((h) => h.id).join(","), [hits]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: hitIds stands for hits
	useEffect(() => {
		if (!open || !vectors || term.length < 3) {
			setMeaning([]);
			return;
		}
		let live = true;
		const timer = setTimeout(() => {
			searchMeaning({
				data: {
					workspaceId: workspace.id,
					query: term,
					exclude: hits.map((h) => h.id),
				},
			})
				.then((found) => live && setMeaning(found))
				.catch(() => live && setMeaning([]));
		}, MEANING_DELAY);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [open, vectors, term, workspace.id, hitIds]);

	const go = useCallback(
		(to: string, params: Record<string, string> = {}) => {
			close();
			router.navigate({ to, params } as never);
		},
		[close, router],
	);

	const rows = useMemo(() => {
		const result: Row[] = [];
		const openPage = (id: string) => () => go("/p/$pageId", { pageId: id });
		const fromPage = (page: Page, section: string): Row => ({
			id: `${section}-${page.id}`,
			section,
			label: displayName(page),
			icon: pageGlyph(page.kind, page.icon),
			hint: hereHint(page.id),
			run: openPage(page.id),
		});
		function hereHint(pageId: string) {
			const here = peers.filter((p) => p.pageId === pageId);
			if (!here.length) return undefined;
			return (
				<span className="text-green">
					{joinNames(here.map((p) => firstName(p.name)))} here
				</span>
			);
		}

		if (term && canAsk) {
			result.push({
				id: "ask",
				section: "",
				label: `Ask AI about "${term}"`,
				icon: <SparkleFilled size={15} />,
				hint: <span className="font-mono text-xs">Tab</span>,
				accent: true,
				run: () => {
					close();
					window.dispatchEvent(
						new CustomEvent("livepage:ask", { detail: { query: term } }),
					);
				},
			});
		}

		if (term.length >= 2) {
			for (const hit of hits)
				result.push({
					id: `hit-${hit.id}`,
					section: "Pages",
					label: hit.title || "Untitled",
					icon: pageGlyph(hit.kind, hit.icon),
					snippet: hit.snippet,
					hint: hereHint(hit.id),
					run: openPage(hit.id),
				});
			for (const hit of meaning)
				result.push({
					id: `meaning-${hit.id}`,
					section: "By meaning",
					label: hit.title || "Untitled",
					icon: pageGlyph(hit.kind, hit.icon),
					run: openPage(hit.id),
				});
		} else {
			const shown = new Set<string>();
			const add = (id: string) => {
				const page = pages.find((p) => p.id === id);
				if (page && !shown.has(id) && shown.size < 6) {
					shown.add(id);
					result.push(fromPage(page, "Recent"));
				}
			};
			for (const visit of recents) add(visit.pageId);
			for (const id of favorites) add(id);
		}

		const commands: Row[] = [
			{
				id: "new",
				section: "Commands",
				label: "New page",
				icon: <PageIcon size={15} />,
				run: () => go("/w/$workspaceId/new", { workspaceId: workspace.id }),
			},
			{
				id: "home",
				section: "Commands",
				label: "Go to Home",
				icon: <PageIcon size={15} />,
				run: () => go("/w/$workspaceId", { workspaceId: workspace.id }),
			},
			{
				id: "inbox",
				section: "Commands",
				label: "Go to Inbox",
				icon: <PageIcon size={15} />,
				run: () => go("/w/$workspaceId/inbox", { workspaceId: workspace.id }),
			},
			{
				id: "map",
				section: "Commands",
				label: "Open the map",
				icon: <PageIcon size={15} />,
				run: () => go("/w/$workspaceId/map", { workspaceId: workspace.id }),
			},
			{
				id: "comments",
				section: "Commands",
				label: "All comments",
				icon: <PageIcon size={15} />,
				run: () =>
					go("/w/$workspaceId/comments", { workspaceId: workspace.id }),
			},
			{
				id: "templates",
				section: "Commands",
				label: "Browse templates",
				icon: <PageIcon size={15} />,
				run: () =>
					go("/w/$workspaceId/templates", { workspaceId: workspace.id }),
			},
			{
				id: "settings",
				section: "Commands",
				label: "Settings",
				icon: <PageIcon size={15} />,
				run: () =>
					go("/w/$workspaceId/settings/$section", {
						workspaceId: workspace.id,
						section: "general",
					}),
			},
			{
				id: "theme",
				section: "Commands",
				label: "Switch light or dark",
				icon: <MoonIcon size={15} />,
				run: () => {
					close();
					applyTheme(isDark() ? "light" : "dark");
				},
			},
		];
		for (const peer of peers) {
			if (!peer.pageId || peer.userId === viewer.userId) continue;
			const pageId = peer.pageId;
			commands.push({
				id: `peer-${peer.userId}`,
				section: "Commands",
				label: `Go to ${firstName(peer.name)}'s page`,
				icon: <PageIcon size={15} />,
				run: openPage(pageId),
			});
		}
		const lower = term.toLowerCase();
		result.push(
			...(term
				? commands.filter((c) => c.label.toLowerCase().includes(lower))
				: commands),
		);
		return result;
	}, [
		term,
		hits,
		meaning,
		recents,
		favorites,
		pages,
		peers,
		canAsk,
		workspace.id,
		viewer.userId,
		go,
		close,
	]);

	// Enter opens the best page. The "Ask AI" row sits above the results but belongs to Tab.
	const firstHit = rows[0]?.id === "ask" && rows.length > 1 ? 1 : 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: start over whenever the results change
	useEffect(() => setActive(firstHit), [firstHit, hitIds, term]);

	useEffect(() => {
		setActive((i) => Math.min(i, Math.max(rows.length - 1, 0)));
	}, [rows.length]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the highlight moves
	useEffect(() => {
		listRef.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	if (!open) return null;

	const onKey = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			rows[active]?.run();
		} else if (e.key === "Tab" && rows[0]?.id === "ask") {
			e.preventDefault();
			rows[0].run();
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	};

	let lastSection = "";
	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) close();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search and commands"
				className="flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[12px] border border-rule bg-paper shadow-[0_20px_60px_rgb(0_0_0/0.18)]"
			>
				<div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-rule px-4">
					<SearchIcon size={16} className="text-pencil" />
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKey}
						role="combobox"
						aria-expanded="true"
						aria-controls="palette-list"
						aria-label={canAsk ? "Search or ask" : "Search"}
						placeholder={canAsk ? "Search or ask" : "Search"}
						className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-pencil"
					/>
					{loading && <span className="text-xs text-pencil">Searching</span>}
				</div>
				<div
					id="palette-list"
					ref={listRef}
					role="listbox"
					aria-label="Results"
					className="overflow-auto p-[6px]"
				>
					{error && (
						<p className="px-[10px] py-2 text-sm text-coral">{error}</p>
					)}
					{term.length >= 2 &&
						!loading &&
						!hits.length &&
						!meaning.length &&
						!error && (
							<p className="px-[10px] py-2 text-sm text-pencil">
								No pages match "{term}".
							</p>
						)}
					{rows.map((row, index) => {
						const heading =
							row.section && row.section !== lastSection ? row.section : null;
						lastSection = row.section || lastSection;
						return (
							<div key={row.id}>
								{heading && (
									<div className="flex items-baseline justify-between px-[10px] pb-1 pt-[10px] text-xs font-medium text-pencil">
										{heading}
										{heading === "By meaning" && (
											<span className="font-normal">
												Matched on meaning, not your exact words
											</span>
										)}
									</div>
								)}
								<div
									role="option"
									tabIndex={-1}
									aria-selected={index === active}
									onMouseMove={() => setActive(index)}
									onClick={row.run}
									onKeyDown={onKey}
									className={`flex cursor-pointer items-center gap-3 rounded-md px-[10px] ${row.snippet ? "py-1.5" : row.accent ? "h-[40px]" : "h-[36px]"} ${
										row.accent ? "font-medium text-link" : "text-ink"
									} ${index === active ? (row.accent ? "bg-link-soft" : "bg-wash-2") : row.accent ? "bg-link-soft" : ""}`}
								>
									<span className="flex size-[15px] shrink-0 items-center justify-center text-graphite">
										{row.icon}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-base">
											{row.label}
										</span>
										{row.snippet && (
											<span className="block truncate text-xs text-pencil">
												{row.snippet}
											</span>
										)}
									</span>
									{row.hint && (
										<span className="shrink-0 text-sm text-pencil">
											{row.hint}
										</span>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>,
		document.body,
	);
}
