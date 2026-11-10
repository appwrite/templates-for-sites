// Ask your workspace (boards 13 and 71). Answers stream from /api/ai/ask, which retrieves with the
// person's own session, so sources are only ever pages they can open.

import { Link, useNavigate } from "@tanstack/react-router";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { TopBarActions } from "#/components/shell/top-bar";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Spinner, useToast } from "#/components/ui";
import { randomId } from "#/lib/browser";
import { BlockList } from "./blocks";
import {
	AiClientError,
	type AiStatus,
	type AskSourceView,
	streamAi,
	useAiStatus,
} from "./client";
import { type Block, parseMarkdown } from "./markdown";
import { Spark } from "./spark";

type Turn = {
	id: string;
	question: string;
	answer: string;
	blocks: Block[];
	sources: AskSourceView[];
	status: "searching" | "streaming" | "done" | "error";
	error?: string;
	cut?: boolean;
};

const FOCUSABLE =
	"button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

// A run that was cut short keeps what it wrote; one that wrote nothing can be tried again.
function settle(turn: Turn): Turn {
	if (turn.status !== "searching" && turn.status !== "streaming") return turn;
	return turn.answer
		? { ...turn, status: "done" }
		: { ...turn, status: "error", error: "Stopped." };
}

function askable(status: AiStatus) {
	return status.state === "ready" && status.ask;
}

function citedSources(turn: Turn) {
	const used = new Set<number>();
	for (const match of turn.answer.matchAll(/\[(\d+)\]/g))
		used.add(Number(match[1]));
	return turn.sources.filter((s) => used.has(s.n));
}

export function AskHost() {
	const { workspace, activePageId, pages, createPage } = useWorkspace();
	const status = useAiStatus(workspace.id);
	const statusRef = useRef(status);
	statusRef.current = status;
	const toast = useToast();
	const [saving, setSaving] = useState(false);
	const [open, setOpen] = useState(false);
	const [turns, setTurns] = useState<Turn[]>([]);
	const [input, setInput] = useState("");
	const turnsRef = useRef<Turn[]>([]);
	turnsRef.current = turns;
	const abortRef = useRef<AbortController | null>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const activePage = pages.find((p) => p.id === activePageId) ?? null;
	const canAddTo = activePage && activePage.kind !== "database";

	const ask = useCallback(
		(question: string) => {
			const text = question.trim();
			if (!text) return;
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;
			const id = randomId();
			const previous = turnsRef.current;
			setTurns((current) => [
				...current.map(settle),
				{
					id,
					question: text,
					answer: "",
					blocks: [],
					sources: [],
					status: "searching",
				},
			]);
			setInput("");
			const update = (patch: (t: Turn) => Turn) =>
				setTurns((current) => current.map((t) => (t.id === id ? patch(t) : t)));
			const history = previous
				.filter((t) => t.status === "done")
				.map((t) => ({ question: t.question, answer: t.answer }));
			let answer = "";
			streamAi(
				"/api/ai/ask",
				{ workspaceId: workspace.id, question: text, history },
				(event) => {
					if ("sources" in event)
						update((t) => ({
							...t,
							sources: event.sources,
							status: "streaming",
						}));
					else if ("delta" in event) {
						answer += event.delta;
						update((t) => ({
							...t,
							answer,
							blocks: parseMarkdown(answer),
							status: "streaming",
						}));
					} else if ("error" in event) {
						update((t) => ({
							...t,
							status: "error",
							error: event.error.message,
							cut: Boolean(event.partial),
						}));
					}
				},
				ctrl.signal,
			)
				.then(() =>
					update((t) => (t.status === "error" ? t : { ...t, status: "done" })),
				)
				.catch((err) => {
					if (ctrl.signal.aborted) return;
					update((t) => ({
						...t,
						status: "error",
						error:
							err instanceof AiClientError
								? err.message
								: "Lost the connection. Try again.",
					}));
				});
		},
		[workspace.id],
	);

	useEffect(() => {
		const onEvent = (e: Event) => {
			const query = (e as CustomEvent<{ query?: string }>).detail?.query;
			setOpen(true);
			const off = statusRef.current && !askable(statusRef.current);
			if (query?.trim() && !off) ask(query);
		};
		window.addEventListener("livepage:ask", onEvent);
		return () => window.removeEventListener("livepage:ask", onEvent);
	}, [ask]);

	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolls whenever the answer grows
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
	}, [turns]);

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		return () => previous?.focus();
	}, [open]);

	const stop = () => {
		abortRef.current?.abort();
		abortRef.current = null;
		setTurns((current) => current.map(settle));
	};

	const close = () => {
		stop();
		setOpen(false);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
			return;
		}
		if (e.key !== "Tab" || !panelRef.current) return;
		const nodes = [
			...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
		];
		if (!nodes.length) return;
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		ask(input);
	};

	const lastTurn = turns[turns.length - 1];
	const busy =
		lastTurn &&
		(lastTurn.status === "searching" || lastTurn.status === "streaming");

	const saveAsPage = async (turn: Turn) => {
		if (saving) return;
		setSaving(true);
		const page = await createPage({
			title: turn.question.slice(0, 120),
		}).catch(() => null);
		setSaving(false);
		if (!page) {
			toast.show("Couldn't create the page. Try again.", { tone: "error" });
			return;
		}
		const markdown = answerMarkdown(turn);
		try {
			sessionStorage.setItem(`livepage:pending-ai:${page.id}`, markdown);
		} catch {
			// Storage blocked. The page is still created, just empty.
		}
		close();
		navigate({ to: "/p/$pageId", params: { pageId: page.id } });
	};

	const addToPage = (turn: Turn) => {
		if (!activePage) return;
		window.dispatchEvent(
			new CustomEvent("livepage:ai-insert", {
				detail: { pageId: activePage.id, markdown: answerMarkdown(turn) },
			}),
		);
		close();
	};

	return (
		<>
			{status?.state === "ready" && status.ask && (
				<TopBarActions>
					<button
						type="button"
						aria-label="Ask your workspace"
						onClick={() => setOpen(true)}
						className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-graphite hover:bg-wash hover:text-ink max-md:hidden"
					>
						<span className="text-link">
							<Spark size={13} />
						</span>
						Ask
					</button>
				</TopBarActions>
			)}
			{open &&
				createPortal(
					// biome-ignore lint/a11y/noStaticElementInteractions: the overlay only catches outside clicks and keys
					<div
						className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh] max-md:p-0"
						onMouseDown={(e) => e.target === e.currentTarget && close()}
						onKeyDown={onKeyDown}
					>
						<div
							ref={panelRef}
							role="dialog"
							aria-modal="true"
							aria-label="Ask your workspace"
							className="flex max-h-[84vh] w-full max-w-[760px] flex-col rounded-[14px] bg-paper shadow-[0_24px_70px_-20px_rgb(0_0_0/0.45)] max-md:h-dvh max-md:max-h-none max-md:rounded-none max-md:pt-safe"
						>
							<div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-6 sm:px-10 sm:pt-9 max-md:h-[52px] max-md:border-b max-md:border-rule max-md:px-2.5 max-md:pb-0 max-md:pt-0">
								<button
									type="button"
									aria-label="Close"
									className="flex size-10 items-center justify-center rounded-md text-ink hover:bg-wash md:hidden"
									onClick={close}
								>
									<svg
										width="16"
										height="16"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										aria-hidden="true"
									>
										<path d="M3 3l10 10M13 3 3 13" />
									</svg>
								</button>
								<span className="text-link">
									<Spark size={14} />
								</span>
								<span className="flex-1 text-sm text-graphite max-md:font-medium max-md:text-link">
									<span className="max-md:hidden">Ask your workspace</span>
									<span className="md:hidden">Ask AI</span>
								</span>
								{turns.length > 0 && (
									<button
										type="button"
										className="mr-3 text-sm text-pencil hover:text-ink coarse:h-10 coarse:px-1 max-md:mr-1"
										onClick={() => {
											abortRef.current?.abort();
											setTurns([]);
											setInput("");
											inputRef.current?.focus();
										}}
									>
										New question
									</button>
								)}
								<button
									type="button"
									className="text-sm text-pencil hover:text-ink max-md:hidden"
									onClick={close}
								>
									Esc
								</button>
							</div>
							<div
								ref={scrollRef}
								className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-10"
							>
								{turns.length === 0 && status && !askable(status) ? (
									<div className="pb-6 pt-2 max-md:pt-5">
										<p className="text-base leading-6 text-ink">
											{status.state === "ready"
												? "Answers across the workspace are turned off."
												: status.state === "broken"
													? "AI is off for now."
													: "AI isn't set up in this workspace yet."}
										</p>
										{status.canManage ? (
											<Link
												to="/w/$workspaceId/settings/$section"
												params={{ workspaceId: workspace.id, section: "ai" }}
												onClick={close}
												className="mt-3 inline-block rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper"
											>
												Open AI settings
											</Link>
										) : (
											<p className="mt-1 text-sm leading-5 text-graphite">
												Your workspace owner can turn it on.
											</p>
										)}
									</div>
								) : (
									turns.length === 0 && (
										<p className="pb-4 pt-2 text-base leading-6 text-graphite max-md:pt-5">
											Ask anything about the pages and databases you can open.
											Answers link back to their sources.
										</p>
									)
								)}
								{turns.map((turn, index) => (
									<TurnView
										key={turn.id}
										turn={turn}
										first={index === 0}
										onClose={close}
										saving={saving}
										onSave={() => saveAsPage(turn)}
										onAdd={
											canAddTo && turn.status === "done"
												? () => addToPage(turn)
												: undefined
										}
										addTarget={activePage?.title ?? ""}
										onRetry={
											turn.status === "error"
												? () => {
														setTurns((current) =>
															current.filter((t) => t.id !== turn.id),
														);
														ask(turn.question);
													}
												: undefined
										}
									/>
								))}
							</div>
							{(!status || askable(status) || turns.length > 0) && (
								<form
									onSubmit={submit}
									className="shrink-0 px-5 pb-6 pt-5 sm:px-10 sm:pb-9 max-md:px-4 max-md:pb-[max(12px,env(safe-area-inset-bottom))] max-md:pt-3 max-md:border-t max-md:border-rule"
								>
									<div className="flex items-end gap-2 rounded-lg border border-rule-strong px-3.5 py-2.5 focus-within:border-link max-md:rounded-[10px] max-md:border-rule max-md:bg-wash max-md:py-2 max-md:pl-3.5 max-md:pr-1.5">
										<textarea
											ref={inputRef}
											rows={1}
											value={input}
											onChange={(e) => setInput(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !e.shiftKey) {
													e.preventDefault();
													ask(input);
												}
											}}
											placeholder={
												turns.length ? "Ask a follow-up" : "Ask your workspace"
											}
											aria-label={
												turns.length ? "Ask a follow-up" : "Ask your workspace"
											}
											className="max-h-32 min-w-0 flex-1 resize-none bg-transparent text-base leading-[22px] text-ink outline-none placeholder:text-pencil"
										/>
										{busy ? (
											<Button variant="ghost" size="sm" onClick={stop}>
												Stop
											</Button>
										) : (
											<Button
												variant="primary"
												size="sm"
												type="submit"
												disabled={!input.trim()}
												aria-label="Ask"
												className="max-md:size-10 max-md:bg-accent max-md:p-0 max-md:text-white"
											>
												<span className="max-md:hidden">Ask</span>
												<svg
													width="16"
													height="16"
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													strokeWidth="1.6"
													strokeLinecap="round"
													strokeLinejoin="round"
													aria-hidden="true"
													className="md:hidden"
												>
													<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
												</svg>
											</Button>
										)}
									</div>
									<p className="mt-3 text-sm leading-4 text-pencil max-md:hidden">
										AI only reads pages you already have access to.
									</p>
								</form>
							)}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}

function answerMarkdown(turn: Turn) {
	const cited = citedSources(turn);
	const sources = cited.length
		? `\n\nSources:\n${cited.map((s) => `${s.n}. ${s.title}`).join("\n")}`
		: "";
	return `${turn.answer}${sources}`;
}

function TurnView({
	turn,
	first,
	saving,
	onClose,
	onSave,
	onAdd,
	addTarget,
	onRetry,
}: {
	turn: Turn;
	first: boolean;
	saving: boolean;
	onClose: () => void;
	onSave: () => void;
	onAdd?: () => void;
	addTarget: string;
	onRetry?: () => void;
}) {
	const sources = citedSources(turn);
	const sourceList = sources.length
		? sources
		: turn.status !== "error"
			? []
			: [];
	const count =
		sources.length || (turn.status === "done" ? turn.sources.length : 0);
	const done = turn.status === "done";

	return (
		<section className={first ? "pb-1" : "mt-8 border-t border-rule pt-6"}>
			<h2
				className={`font-serif font-medium tracking-[-0.02em] text-ink max-md:mt-5 max-md:font-sans max-md:text-[20px]! max-md:leading-7! max-md:font-semibold max-md:tracking-[-0.01em] ${first ? "mb-5 text-[30px] leading-[36px] sm:text-[40px] sm:leading-[46px]" : "mb-3 text-[26px] leading-[32px]"}`}
			>
				{turn.question}
			</h2>
			{turn.status === "searching" && (
				<p className="flex items-center gap-2 text-sm text-graphite">
					<Spinner size={12} /> Reading your pages
				</p>
			)}
			{(turn.status === "streaming" || done || turn.status === "error") &&
				count > 0 && (
					<p className="mb-3 flex items-center gap-2 text-sm text-graphite">
						<span className="text-link">
							<Spark size={12} />
						</span>
						Answered from {count} {count === 1 ? "page" : "pages"} you can open
					</p>
				)}
			<div className="space-y-3 text-md leading-[26px] text-ink">
				{turn.blocks.length > 0 && <Citations turn={turn} onClose={onClose} />}
			</div>
			{turn.status === "error" && (
				<p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
					<span className="text-ink">
						{turn.cut ? "AI stopped before finishing." : turn.error}
					</span>
					{onRetry && (
						<button type="button" className="text-link" onClick={onRetry}>
							Try again
						</button>
					)}
				</p>
			)}
			{sourceList.length > 0 && (
				<div className="mt-5 border-t border-rule">
					{sourceList.map((source) => (
						<div
							key={source.id}
							className="flex items-center gap-3.5 border-b border-rule py-2.5 text-[15px] leading-5"
						>
							<span className="w-3.5 shrink-0 font-medium text-link">
								{source.n}
							</span>
							<Link
								to="/p/$pageId"
								params={{ pageId: source.id }}
								onClick={onClose}
								className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
							>
								{source.title}
							</Link>
							{source.parent && (
								<span className="shrink-0 text-sm text-graphite">
									{source.parent}
								</span>
							)}
						</div>
					))}
				</div>
			)}
			{done && turn.answer && (
				<div className="mt-4 flex flex-wrap gap-4 text-[15px]">
					<button
						type="button"
						className="font-medium text-link hover:underline disabled:opacity-60"
						disabled={saving}
						onClick={onSave}
					>
						{saving ? "Saving" : "Save as a page"}
					</button>
					{onAdd && (
						<button
							type="button"
							className="text-graphite hover:text-ink"
							onClick={onAdd}
						>
							Add to {addTarget || "this page"}
						</button>
					)}
				</div>
			)}
		</section>
	);
}

// Renders the answer with [n] as links. Only numbers from the real source list become links.
function Citations({ turn, onClose }: { turn: Turn; onClose: () => void }) {
	const byNumber = new Map(turn.sources.map((s) => [s.n, s]));
	const decorated = turn.blocks.map((block) =>
		linkify(block, byNumber, onClose),
	);
	return <BlockList blocks={decorated as Block[]} />;
}

type InlineWithRender = {
	type: "text";
	text: string;
	marks?: { type: string }[];
	render?: ReactNode;
};

function linkify(
	block: Block,
	sources: Map<number, AskSourceView>,
	onClose: () => void,
): Block {
	if (!("content" in block) || !block.content) return block;
	const first = block.content[0] as { type?: string } | undefined;
	if (first?.type !== "text") {
		return {
			...block,
			content: (block.content as Block[]).map((c) =>
				linkify(c, sources, onClose),
			),
		} as Block;
	}
	const out: InlineWithRender[] = [];
	for (const node of block.content as InlineWithRender[]) {
		const parts = node.text.split(/(\[\d+\])/g);
		for (const part of parts) {
			const match = part.match(/^\[(\d+)\]$/);
			const source = match ? sources.get(Number(match[1])) : undefined;
			if (source) {
				out.push({
					type: "text",
					text: part,
					marks: node.marks,
					render: (
						<Link
							to="/p/$pageId"
							params={{ pageId: source.id }}
							onClick={onClose}
							className="text-link"
							aria-label={`Source ${source.n}: ${source.title}`}
						>
							{part}
						</Link>
					),
				});
			} else if (part) {
				out.push({ ...node, text: part });
			}
		}
	}
	return { ...block, content: out } as Block;
}
