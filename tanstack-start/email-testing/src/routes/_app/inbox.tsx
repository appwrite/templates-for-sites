import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useParams,
	useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CopyButton, useCopy } from "#/components/copy-button";
import { Icon } from "#/components/icons";
import {
	InboxContext,
	type InboxSearch,
	type InboxState,
	useInbox,
} from "#/components/inbox-context";
import { fetchInbox } from "#/functions/inbox";
import { randomMailbox, relativeTime } from "#/lib/format";
import type { InboxFilter, MessageSummary } from "#/lib/types";

const FILTERS: { id: InboxFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "code", label: "Has code" },
	{ id: "link", label: "Has link" },
	{ id: "attachments", label: "Attachments" },
	{ id: "unread", label: "Unread" },
];

export const Route = createFileRoute("/_app/inbox")({
	validateSearch: (search: Record<string, unknown>): InboxSearch => ({
		filter:
			FILTERS.some((f) => f.id === search.filter) && search.filter !== "all"
				? (search.filter as InboxFilter)
				: undefined,
		q: typeof search.q === "string" && search.q ? search.q : undefined,
		mailbox:
			typeof search.mailbox === "string" && search.mailbox
				? search.mailbox
				: undefined,
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) =>
		fetchInbox({
			data: {
				filter: deps.filter || "all",
				search: deps.q,
				mailbox: deps.mailbox,
				limit: 100,
				withCounts: true,
			},
		}),
	head: () => ({ meta: [{ title: "Inbox · Catchall" }] }),
	component: InboxLayout,
});

function InboxLayout() {
	const loaded = Route.useLoaderData();
	const search = Route.useSearch();
	const router = useRouter();
	const [data, setData] = useState(loaded);
	const [now, setNow] = useState(() => Date.parse(loaded.now));
	useEffect(() => {
		setData(loaded);
		setNow(Date.parse(loaded.now));
	}, [loaded]);

	// Polls for new mail every 4 seconds while the tab is visible.
	const latest = useRef(loaded.messages[0]?.id);
	useEffect(() => {
		let ticks = 0;
		const timer = setInterval(async () => {
			setNow(Date.now());
			if (document.visibilityState !== "visible") return;
			ticks++;
			try {
				const next = await fetchInbox({
					data: {
						filter: search.filter || "all",
						search: search.q,
						mailbox: search.mailbox,
						limit: 100,
						withCounts: ticks % 4 === 0,
					},
				});
				setData((prev) => ({
					...next,
					counts: next.counts || prev.counts,
					mailboxes: next.mailboxes || prev.mailboxes,
					retentionDays: next.retentionDays ?? prev.retentionDays,
				}));
				if (next.messages[0]?.id !== latest.current) {
					latest.current = next.messages[0]?.id;
					router.invalidate({ filter: (match) => match.routeId === "/_app" });
				}
			} catch {
				// Try again on the next tick.
			}
		}, 4000);
		return () => clearInterval(timer);
	}, [search.filter, search.q, search.mailbox, router]);

	const params = useParams({ strict: false }) as { messageId?: string };
	// Local overlays, so a poll or a loader refresh can't undo what this tab just did.
	const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
	const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
	const messages = data.messages
		.filter((m) => !removedIds.has(m.id))
		.map((m) => (readIds.has(m.id) && !m.read ? { ...m, read: true } : m));
	const state: InboxState = {
		messages,
		total: data.total - (data.messages.length - messages.length),
		counts: data.counts,
		retentionDays: data.retentionDays,
		domain: data.domain,
		now,
		search,
		markRead: (id) =>
			setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
		remove: (id) => setRemovedIds((prev) => new Set(prev).add(id)),
	};

	return (
		<InboxContext.Provider value={state}>
			{params.messageId ? (
				<div className="flex h-[calc(100vh-57px)] lg:h-screen">
					<NarrowList activeId={params.messageId} />
					<div className="min-w-0 flex-1 overflow-y-auto">
						<Outlet />
					</div>
				</div>
			) : (
				<WideList />
			)}
		</InboxContext.Provider>
	);
}

// ---------- shared bits ----------

function Extracted({
	message,
	compact = false,
}: {
	message: MessageSummary;
	compact?: boolean;
}) {
	if (message.code) {
		return (
			<span className="code-chip">
				{message.code}
				<CopyButton
					value={message.code}
					className="!text-[#0e0e0e]"
					size={13}
				/>
			</span>
		);
	}
	if (message.firstLink) {
		const extra = message.linkCount - 1;
		const label = message.firstLink.label || hostname(message.firstLink.url);
		return (
			<span className="flex min-w-0 items-center gap-2">
				{compact ? (
					<span
						className="chip h-[22px] min-w-0 text-[12px]"
						title={message.firstLink.url}
					>
						<Icon name="link" size={12} />
						<span className="truncate">{label}</span>
					</span>
				) : (
					<a
						className="chip min-w-0"
						href={message.firstLink.url}
						target="_blank"
						rel="noreferrer noopener"
						onClick={(e) => e.stopPropagation()}
						title={message.firstLink.url}
					>
						<Icon name="link" size={13} />
						<span className="truncate">{label}</span>
					</a>
				)}
				{extra > 0 ? (
					<span className="mono text-[12px] text-graphite">+{extra}</span>
				) : null}
				{message.attachmentCount ? (
					<span className="mono flex items-center gap-0.5 text-[12px] text-graphite">
						<Icon name="clip" size={12} />
						{message.attachmentCount}
					</span>
				) : null}
			</span>
		);
	}
	if (message.attachmentCount) {
		return (
			<span className="mono flex items-center gap-1 text-[12px] text-graphite">
				<Icon name="clip" size={13} />
				{message.attachmentCount}
			</span>
		);
	}
	return <span className="text-pencil">—</span>;
}

function hostname(url: string) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function SpamTag({ message }: { message: MessageSummary }) {
	if (message.spamVerdict !== "spam" && message.spamVerdict !== "unsure")
		return null;
	if (message.spamVerdict === "unsure" && (message.spamScore ?? 0) < 0.8)
		return null;
	return (
		<span className="ml-2 shrink-0 rounded border border-red px-1 text-[12px] leading-[18px] text-red">
			Spam {message.spamScore?.toFixed(2)}
		</span>
	);
}

function SearchBox({ compact = false }: { compact?: boolean }) {
	const { search } = useInbox();
	const navigate = useNavigate();
	const [value, setValue] = useState(search.q || "");
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => setValue(search.q || ""), [search.q]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.key === "/" &&
				!(
					e.target instanceof HTMLInputElement ||
					e.target instanceof HTMLTextAreaElement
				)
			) {
				e.preventDefault();
				input.current?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	return (
		<form
			className={`relative ${compact ? "w-full" : "w-full sm:w-[320px]"}`}
			onSubmit={(e) => {
				e.preventDefault();
				navigate({
					to: "/inbox",
					search: (prev: InboxSearch) => ({
						...prev,
						q: value.trim() || undefined,
					}),
				});
			}}
		>
			<Icon
				name="search"
				size={15}
				className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite"
			/>
			<input
				ref={input}
				className="input !h-9 !pl-9 !pr-9 !text-[14px]"
				placeholder="Search address, subject, code…"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				aria-label="Search"
			/>
			<span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
		</form>
	);
}

function GetAddress({
	children,
}: {
	children: (open: () => void) => ReactNode;
}) {
	const { domain } = useInbox();
	const [open, setOpen] = useState(false);
	const [mailbox, setMailbox] = useState(() => randomMailbox());
	const { copied, copy } = useCopy();
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [open]);
	const address = `${mailbox}@${domain}`;
	return (
		<div ref={ref} className="relative">
			{children(() => {
				setMailbox(randomMailbox());
				setOpen((o) => !o);
			})}
			{open ? (
				<div className="absolute right-0 top-full z-20 mt-2 w-[min(420px,90vw)] rounded-[10px] border border-rule bg-paper p-4 shadow-xl">
					<div className="text-[13px] font-medium">A fresh address</div>
					<p className="mt-1 text-[13px] text-graphite">
						Any name works. Mail shows up here as soon as it arrives.
					</p>
					<div className="mt-3 flex items-center gap-2 rounded-md border border-rule-strong px-3 py-2.5">
						<span className="mono min-w-0 flex-1 break-all text-[13px]">
							<input
								className="w-[9ch] min-w-0 bg-hl-soft font-mono outline-none"
								value={mailbox}
								onChange={(e) =>
									setMailbox(
										e.target.value.toLowerCase().replace(/[^a-z0-9._+-]/g, ""),
									)
								}
								aria-label="Name before the @"
								style={{ width: `${Math.max(mailbox.length, 3) + 1}ch` }}
							/>
							@{domain}
						</span>
					</div>
					<div className="mt-3 flex gap-2">
						<button
							type="button"
							className="btn btn-primary btn-sm"
							onClick={() => copy(address)}
						>
							<Icon name={copied ? "check" : "copy"} size={13} />{" "}
							{copied ? "Copied" : "Copy address"}
						</button>
						<button
							type="button"
							className="btn btn-sm"
							onClick={() => setMailbox(randomMailbox())}
						>
							<Icon name="refresh" size={13} /> New name
						</button>
						<Link
							to="/inbox"
							search={{ mailbox }}
							className="btn btn-sm btn-ghost ml-auto"
							onClick={() => setOpen(false)}
						>
							Watch it
						</Link>
					</div>
				</div>
			) : null}
		</div>
	);
}

// ---------- 03: wide list ----------

function WideList() {
	const { messages, total, counts, retentionDays, now, search, domain } =
		useInbox();
	const navigate = useNavigate();
	const filtered = Boolean(search.q || search.mailbox || search.filter);

	return (
		<div>
			<header className="flex flex-wrap items-center gap-3 border-b border-rule px-7 py-[15px]">
				<h1 className="text-[20px] font-semibold tracking-tight">Inbox</h1>
				<span className="text-[13px] text-graphite">
					{total} message{total === 1 ? "" : "s"}
					{retentionDays
						? `, kept for ${retentionDays} day${retentionDays === 1 ? "" : "s"}`
						: ""}
				</span>
				<div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
					<SearchBox />
					<GetAddress>
						{(open) => (
							<button type="button" className="btn btn-primary" onClick={open}>
								<Icon name="plus" size={15} /> Get address
							</button>
						)}
					</GetAddress>
				</div>
			</header>
			<div className="flex flex-wrap items-center gap-1.5 px-7 py-3">
				{FILTERS.map((f) => (
					<button
						key={f.id}
						type="button"
						className="pill"
						data-active={(search.filter || "all") === f.id}
						onClick={() =>
							navigate({
								to: "/inbox",
								search: (prev: InboxSearch) => ({
									...prev,
									filter: f.id === "all" ? undefined : f.id,
								}),
							})
						}
					>
						{f.label}
						{f.id !== "all" && counts ? (
							<span className="count">{counts[f.id]}</span>
						) : null}
					</button>
				))}
				{search.mailbox ? (
					<Link
						to="/inbox"
						search={(prev: InboxSearch) => ({ ...prev, mailbox: undefined })}
						className="pill"
					>
						<span className="mono text-[12px]">{search.mailbox}</span>
						<Icon name="x" size={12} />
					</Link>
				) : null}
				<span className="ml-auto flex items-center gap-2 text-[13px] text-graphite">
					<span className="live-dot" /> Live
				</span>
			</div>
			{messages.length === 0 ? (
				filtered ? (
					<NoResults />
				) : (
					<EmptyInbox domain={domain} />
				)
			) : (
				<table className="w-full table-fixed border-t border-rule text-[14px]">
					<thead>
						<tr className="text-left text-[12px] text-graphite">
							<th className="w-[44px]" />
							<th className="w-[180px] py-2 font-medium">To</th>
							<th className="hidden w-[176px] py-2 font-medium md:table-cell">
								From
							</th>
							<th className="py-2 font-medium">Subject</th>
							<th className="hidden w-[210px] py-2 font-medium lg:table-cell">
								Extracted
							</th>
							<th className="w-[96px] py-2 pr-6 text-right font-medium">
								Received
							</th>
						</tr>
					</thead>
					<tbody>
						{messages.map((m, i) => (
							<tr
								key={m.id}
								className={`h-12 cursor-pointer border-t border-rule hover:bg-wash ${i === 0 && now - Date.parse(m.receivedAt) < 60_000 ? "bg-hl-soft" : ""}`}
								onClick={() =>
									navigate({
										to: "/inbox/$messageId",
										params: { messageId: m.id },
										search,
									})
								}
							>
								<td className="pl-7">
									{m.read ? null : (
										<span className="block size-1.5 rounded-full bg-ink">
											<span className="sr-only">Unread</span>
										</span>
									)}
								</td>
								<td
									className={`mono truncate text-[13px] ${m.read ? "text-graphite" : ""}`}
								>
									{m.mailbox}
								</td>
								<td
									className={`hidden truncate pr-4 md:table-cell ${m.read ? "text-graphite" : "font-semibold"}`}
								>
									{m.fromName || m.fromAddress}
								</td>
								<td className="pr-4">
									<Link
										to="/inbox/$messageId"
										params={{ messageId: m.id }}
										search={search}
										className="flex min-w-0 items-center"
										onClick={(e) => e.stopPropagation()}
									>
										<span className="truncate">
											<span className={m.read ? "" : "font-semibold"}>
												{m.subject || "(no subject)"}
											</span>{" "}
											<span className="text-graphite">{m.preview}</span>
										</span>
										<SpamTag message={m} />
									</Link>
								</td>
								<td className="hidden pr-4 lg:table-cell">
									<Extracted message={m} />
								</td>
								<td
									className={`pr-6 text-right ${m.read ? "text-graphite" : "font-semibold"}`}
								>
									{relativeTime(m.receivedAt, now)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

function NoResults() {
	const { search } = useInbox();
	return (
		<div className="border-t border-rule px-7 py-20 text-center">
			<div className="text-[17px] font-semibold">No messages match</div>
			<p className="mt-1.5 text-graphite">
				{search.q ? (
					<>
						Nothing for <span className="mono text-ink">{search.q}</span>
						{search.mailbox ? ` in ${search.mailbox}` : ""}. Search looks at
						addresses, subjects, senders and codes.
					</>
				) : (
					"Try another filter, or wait for new mail."
				)}
			</p>
			<Link to="/inbox" search={{}} className="btn mt-5">
				Clear filters
			</Link>
		</div>
	);
}

// ---------- 07: empty first run ----------

function EmptyInbox({ domain }: { domain: string }) {
	const [mailbox] = useState(() => randomMailbox("hello"));
	const address = `${mailbox}@${domain}`;
	return (
		<div className="border-t border-rule px-7 py-20">
			<div className="mx-auto max-w-[560px] text-center">
				<div className="mx-auto flex w-fit items-center gap-2 text-[13px] text-graphite">
					<span className="live-dot" /> Waiting for mail
				</div>
				<h2 className="mt-4 text-[28px] font-semibold leading-[34px] tracking-display">
					Your address is ready
				</h2>
				<p className="mt-2 text-[15px] text-graphite">
					Send anything to any name at this domain. It appears here within
					seconds.
				</p>
				<div className="mx-auto mt-7 flex max-w-[560px] items-center gap-3 rounded-[10px] border border-rule-strong px-4 py-3.5 text-left">
					<span className="mono min-w-0 flex-1 break-all text-[14px]">
						<span className="bg-hl text-[#0e0e0e]">{mailbox}</span>@{domain}
					</span>
					<CopyButton
						value={address}
						label="Copy"
						className="btn btn-sm !text-ink"
					/>
				</div>
				<p className="mt-5 text-[13px] text-pencil">
					Testing from CI?{" "}
					<Link to="/tests" className="link text-graphite">
						Create an API token
					</Link>
				</p>
			</div>
		</div>
	);
}

// ---------- 04: narrow list next to a message ----------

function NarrowList({ activeId }: { activeId: string }) {
	const { messages, now, search } = useInbox();
	const [searching, setSearching] = useState(Boolean(search.q));
	return (
		<div className="hidden w-[360px] shrink-0 flex-col border-r border-rule md:flex">
			<header className="flex h-16 items-center gap-2 border-b border-rule px-5">
				{searching ? (
					<SearchBox compact />
				) : (
					<>
						<Link
							to="/inbox"
							search={search}
							className="text-[20px] font-semibold tracking-tight"
						>
							Inbox
						</Link>
						<span className="ml-1 flex items-center gap-1.5 text-[13px] text-graphite">
							<span className="live-dot" /> Live
						</span>
						<button
							type="button"
							className="ml-auto flex size-9 items-center justify-center rounded-md hover:bg-wash"
							onClick={() => setSearching(true)}
							aria-label="Search"
						>
							<Icon name="search" size={16} />
						</button>
					</>
				)}
				<GetAddress>
					{(open) => (
						<button
							type="button"
							className="btn size-9 !p-0"
							onClick={open}
							aria-label="Get address"
						>
							<Icon name="plus" size={16} />
						</button>
					)}
				</GetAddress>
			</header>
			<ul className="flex-1 overflow-y-auto">
				{messages.map((m) => {
					const active = m.id === activeId;
					return (
						<li key={m.id}>
							<Link
								to="/inbox/$messageId"
								params={{ messageId: m.id }}
								search={search}
								className={`block border-b border-rule py-3.5 pl-[38px] pr-5 ${active ? "border-l-2 border-l-ink bg-wash !pl-9" : "hover:bg-wash"}`}
							>
								<div className="relative flex items-baseline justify-between gap-3">
									{m.read ? null : (
										<span className="absolute -left-[19px] top-[7px] size-1.5 rounded-full bg-ink" />
									)}
									<span
										className={`truncate text-[15px] ${m.read ? "" : "font-semibold"}`}
									>
										{m.fromName || m.fromAddress}
									</span>
									<span className="shrink-0 text-[12px] text-graphite">
										{relativeTime(m.receivedAt, now)}
									</span>
								</div>
								<div className="mt-0.5 flex items-center">
									<span
										className={`truncate text-[15px] ${m.read ? "text-graphite" : "font-medium"}`}
									>
										{m.subject || "(no subject)"}
									</span>
									<SpamTag message={m} />
								</div>
								<div className="mt-2 flex items-center justify-between gap-3">
									<span className="mono truncate text-[13px] text-graphite">
										{m.mailbox}
									</span>
									<span className="shrink-0">
										<Extracted message={m} compact />
									</span>
								</div>
							</Link>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
