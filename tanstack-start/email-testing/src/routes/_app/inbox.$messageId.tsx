import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CopyButton, useCopy } from "#/components/copy-button";
import { Icon } from "#/components/icons";
import { useInbox } from "#/components/inbox-context";
import { fetchMessage, removeMessage } from "#/functions/inbox";
import { bytes, clock, longDate } from "#/lib/format";
import type { Check, MessageDetail } from "#/lib/types";

export const Route = createFileRoute("/_app/inbox/$messageId")({
	loader: ({ params }) => fetchMessage({ data: { id: params.messageId } }),
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.subject || "Message"} · Catchall` }],
	}),
	component: MessageView,
});

type Tab = "html" | "text" | "headers" | "attachments" | "checks";

function MessageView() {
	const message = Route.useLoaderData();
	const { messages, total, search, markRead, remove, domain } = useInbox();
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>(message.html ? "html" : "text");
	const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
	const { copied, copy } = useCopy();

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opened message
	useEffect(() => {
		setTab(message.html ? "html" : "text");
		markRead(message.id);
	}, [message.id]);

	const index = messages.findIndex((m) => m.id === message.id);
	const prev = index > 0 ? messages[index - 1] : null;
	const next =
		index >= 0 && index < messages.length - 1 ? messages[index + 1] : null;
	const go = (id: string | undefined) =>
		id &&
		navigate({ to: "/inbox/$messageId", params: { messageId: id }, search });

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				e.metaKey ||
				e.ctrlKey
			)
				return;
			if (e.key === "c" && message.code) copy(message.code, "code");
			if (e.key === "k" || e.key === "ArrowUp") go(prev?.id);
			if (e.key === "j" || e.key === "ArrowDown") go(next?.id);
			if (e.key === "Escape") navigate({ to: "/inbox", search });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const issues = message.checks.filter((c) => c.status !== "pass").length;
	const failing = message.checks.some((c) => c.status === "fail");

	return (
		<div>
			<div className="sticky top-0 z-10 flex h-16 items-center gap-2 border-b border-rule bg-paper px-6">
				<Link
					to="/inbox"
					search={search}
					className="btn size-9 !p-0 md:hidden"
					aria-label="Back to inbox"
				>
					<Icon name="left" size={16} />
				</Link>
				<button
					type="button"
					className="btn size-9 !p-0"
					disabled={!prev}
					onClick={() => go(prev?.id)}
					aria-label="Newer message"
				>
					<Icon name="up" size={16} />
				</button>
				<button
					type="button"
					className="btn size-9 !p-0"
					disabled={!next}
					onClick={() => go(next?.id)}
					aria-label="Older message"
				>
					<Icon name="down" size={16} />
				</button>
				<span className="ml-1.5 text-[13px] text-graphite">
					{index >= 0 ? `${index + 1} of ${total}` : ""}
				</span>
				<button
					type="button"
					className="btn btn-ghost ml-auto"
					onClick={() => copy(message.rawJson, "json")}
				>
					<Icon name={copied === "json" ? "check" : "braces"} size={15} />{" "}
					{copied === "json" ? "Copied" : "Copy as JSON"}
				</button>
				<button
					type="button"
					className="btn btn-ghost size-9 !p-0"
					aria-label="Delete message"
					onClick={async () => {
						if (!confirm("Delete this message and its attachments?")) return;
						await removeMessage({ data: { id: message.id } });
						remove(message.id);
						if (next || prev) go((next || prev)?.id);
						else navigate({ to: "/inbox", search });
					}}
				>
					<Icon name="trash" size={16} />
				</button>
			</div>

			<section className="px-8 pb-6 pt-8">
				<h1 className="text-[26px] font-semibold leading-[32px] tracking-tight">
					{message.subject || "(no subject)"}
				</h1>
				<dl className="mt-4 grid grid-cols-[52px_1fr] gap-x-4 gap-y-1.5 text-[14px]">
					<dt className="text-graphite">From</dt>
					<dd className="min-w-0 truncate">
						{message.fromName ? (
							<span className="font-semibold">{message.fromName} </span>
						) : null}
						<span className="mono text-[13px] text-graphite">
							{message.fromAddress}
						</span>
					</dd>
					<dt className="text-graphite">To</dt>
					<dd className="mono min-w-0 break-all text-[13px]">
						<span className="font-semibold">{message.mailbox}</span>
						<span className="text-graphite">
							@{message.recipient.split("@")[1] || domain}
						</span>
					</dd>
					<dt className="text-graphite">Date</dt>
					<dd>
						{/* Server and browser can sit in different time zones. */}
						<span suppressHydrationWarning>
							{longDate(message.date || message.receivedAt)}
						</span>
						<span className="text-graphite" suppressHydrationWarning>
							{` · Received ${clock(message.receivedAt)}`}
						</span>
					</dd>
				</dl>
				<div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
					{message.transport ? (
						<span className="flex items-center gap-1.5">
							<Icon
								name="lock"
								size={14}
								className={message.transport.tls ? "text-signal" : "text-red"}
							/>
							{message.transport.tls
								? "Received over TLS"
								: "Received without TLS"}
						</span>
					) : null}
					{message.spamVerdict ? (
						<span className="flex items-center gap-1.5">
							<Icon name="shield" size={14} className="text-graphite" />
							Spam score {message.spamScore?.toFixed(2)}{" "}
							<span className="text-graphite">
								{message.spamVerdict === "ham"
									? "not spam"
									: message.spamVerdict}
							</span>
						</span>
					) : null}
					{message.transport?.helo ? (
						<span className="flex min-w-0 items-center gap-1.5 text-graphite">
							<Icon name="server" size={14} />
							HELO{" "}
							<span className="mono truncate text-[12px] text-ink">
								{message.transport.helo}
							</span>
							{message.transport.remoteIp ? (
								<span className="mono text-[12px]">
									· {message.transport.remoteIp}
								</span>
							) : null}
						</span>
					) : null}
				</div>
			</section>

			<ExtractedBand
				message={message}
				copied={copied === "code"}
				onCopy={() => message.code && copy(message.code, "code")}
			/>

			<div className="flex flex-wrap items-center gap-x-6 border-b border-rule px-8">
				<TabButton
					active={tab === "html"}
					onClick={() => setTab("html")}
					disabled={!message.html}
				>
					HTML
				</TabButton>
				<TabButton active={tab === "text"} onClick={() => setTab("text")}>
					Text
				</TabButton>
				<TabButton active={tab === "headers"} onClick={() => setTab("headers")}>
					Headers
				</TabButton>
				<TabButton
					active={tab === "attachments"}
					onClick={() => setTab("attachments")}
				>
					Attachments{" "}
					<span className="mono text-[12px] text-graphite">
						{message.attachments.length}
					</span>
				</TabButton>
				<TabButton active={tab === "checks"} onClick={() => setTab("checks")}>
					Checks
					{issues ? (
						<span
							className={`flex size-[18px] items-center justify-center rounded-full text-[11px] font-semibold text-paper ${failing ? "bg-red" : "bg-graphite"}`}
						>
							{issues}
						</span>
					) : null}
				</TabButton>
				{tab === "html" ? (
					<div className="ml-auto flex items-center gap-2 py-2">
						<div className="segmented">
							<button
								type="button"
								data-active={device === "desktop"}
								onClick={() => setDevice("desktop")}
								className="flex items-center gap-1.5"
							>
								<Icon name="monitor" size={14} /> Desktop
							</button>
							<button
								type="button"
								data-active={device === "mobile"}
								onClick={() => setDevice("mobile")}
								className="flex items-center gap-1.5"
							>
								<Icon name="phone" size={14} /> Mobile
							</button>
						</div>
						<a
							className="flex size-9 items-center justify-center rounded-md text-graphite hover:bg-wash hover:text-ink"
							href={`/api/preview/${message.id}`}
							target="_blank"
							rel="noreferrer"
							aria-label="Open the HTML in a new tab"
						>
							<Icon name="external" size={16} />
						</a>
					</div>
				) : null}
			</div>

			{tab === "html" ? (
				<HtmlPreview html={message.html} device={device} />
			) : null}
			{tab === "text" ? <TextBody text={message.text} /> : null}
			{tab === "headers" ? <Headers headers={message.headers} /> : null}
			{tab === "attachments" ? <Attachments message={message} /> : null}
			{tab === "checks" ? <Checks checks={message.checks} /> : null}
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
	disabled,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`-mb-px flex h-12 items-center gap-1.5 border-b-2 text-[15px] disabled:opacity-40 ${active ? "border-ink font-semibold" : "border-transparent text-graphite hover:text-ink"}`}
		>
			{children}
		</button>
	);
}

function ExtractedBand({
	message,
	copied,
	onCopy,
}: {
	message: MessageDetail;
	copied: boolean;
	onCopy: () => void;
}) {
	if (!message.code && message.links.length === 0) return null;
	return (
		<section className="grid border-y border-rule md:grid-cols-[auto_1fr]">
			{message.code ? (
				<div className="border-rule px-8 py-6 md:border-r">
					<div className="text-[13px] text-graphite">Verification code</div>
					<div className="mt-2.5 flex items-center gap-3">
						<span className="rounded-md bg-hl px-3 py-1 font-mono text-[34px] font-semibold leading-[42px] tracking-[0.12em] text-[#0e0e0e] shadow-[inset_0_0_0_1px_var(--hl-ring)]">
							{message.code}
						</span>
						<button
							type="button"
							className="btn size-9 !p-0"
							onClick={onCopy}
							aria-label="Copy code"
						>
							<Icon name={copied ? "check" : "copy"} size={16} />
						</button>
					</div>
					<div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-pencil">
						Press <span className="kbd">C</span> to copy
					</div>
				</div>
			) : null}
			{message.links.length ? (
				<div className={`min-w-0 py-5 ${message.code ? "px-6" : "px-8"}`}>
					<div className="text-[13px] text-graphite">
						Links{" "}
						<span className="mono text-[12px]">{message.links.length}</span>
					</div>
					<ul className="mt-2">
						{message.links.slice(0, 8).map((link) => (
							<li
								key={link.url}
								className="grid h-[34px] grid-cols-[minmax(90px,150px)_minmax(0,1fr)_auto] items-center gap-3 text-[14px]"
							>
								<span className="truncate">{link.label || "Link"}</span>
								<span className="flex min-w-0 items-center gap-2">
									<span
										className="mono truncate text-[12px] text-graphite"
										title={link.url}
									>
										{link.url}
									</span>
									{link.local ? (
										<span className="flex shrink-0 items-center gap-1 rounded bg-red-soft px-1.5 text-[12px] leading-[20px] text-red">
											<Icon name="alert" size={12} /> local
										</span>
									) : null}
								</span>
								<span className="flex items-center gap-1">
									<CopyButton
										value={link.url}
										className="size-8 justify-center rounded-md hover:bg-wash"
									/>
									<a
										className="flex size-8 items-center justify-center rounded-md text-graphite hover:bg-wash hover:text-ink"
										href={link.url}
										target="_blank"
										rel="noreferrer noopener"
										aria-label="Open link"
									>
										<Icon name="external" size={14} />
									</a>
								</span>
							</li>
						))}
					</ul>
					{message.links.length > 8 ? (
						<div className="mt-1 text-[12px] text-pencil">
							{message.links.length - 8} more in the Text and HTML tabs
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}

function HtmlPreview({
	html,
	device,
}: {
	html: string;
	device: "desktop" | "mobile";
}) {
	// No scripts and no same-origin: the email can't touch this page or its cookies.
	const doc = useMemo(
		() =>
			`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0}</style>${html}`,
		[html],
	);
	return (
		<div className="bg-wash px-4 py-7 sm:px-8">
			<iframe
				title="HTML preview"
				sandbox="allow-popups allow-popups-to-escape-sandbox"
				srcDoc={doc}
				className="mx-auto block h-[760px] rounded-[10px] border border-rule bg-white"
				style={{
					width: device === "mobile" ? 390 : "100%",
					maxWidth: device === "mobile" ? 390 : 900,
				}}
			/>
		</div>
	);
}

function TextBody({ text }: { text: string }) {
	if (!text)
		return (
			<p className="px-8 py-8 text-graphite">
				This message has no plain-text part.
			</p>
		);
	return (
		<pre className="mono whitespace-pre-wrap break-words px-8 py-7 text-[13px] leading-[20px]">
			{text}
		</pre>
	);
}

function Headers({ headers }: { headers: [string, string][] }) {
	return (
		<table className="mx-8 my-6 w-[calc(100%-4rem)] table-fixed text-[13px]">
			<tbody>
				{headers.map(([name, value], i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: headers repeat, and the list never reorders
					<tr key={`${name}-${i}`} className="border-b border-rule align-top">
						<td className="mono w-[200px] py-2 pr-4 text-graphite">{name}</td>
						<td className="mono break-all py-2">{value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Attachments({ message }: { message: MessageDetail }) {
	if (!message.attachments.length)
		return <p className="px-8 py-8 text-graphite">No attachments.</p>;
	return (
		<ul className="mx-8 my-6 divide-y divide-rule rounded-[10px] border border-rule">
			{message.attachments.map((a, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: two attachments can share a name
					key={`${a.name}-${i}`}
					className="flex items-center gap-4 px-4 py-3"
				>
					{a.fileId &&
					a.contentType.startsWith("image/") &&
					a.contentType !== "image/svg+xml" ? (
						<img
							src={`/api/attachments/${a.fileId}?inline`}
							alt=""
							className="size-12 rounded border border-rule object-cover"
						/>
					) : (
						<span className="flex size-12 items-center justify-center rounded border border-rule text-graphite">
							<Icon name="file" size={20} />
						</span>
					)}
					<span className="min-w-0 flex-1">
						<span className="block truncate font-medium">{a.name}</span>
						<span className="mono block text-[12px] text-graphite">
							{a.contentType} · {bytes(a.size)}
							{a.disposition === "inline" ? " · inline" : ""}
						</span>
						{a.error ? (
							<span className="block text-[13px] text-red">
								Not saved: {a.error}
							</span>
						) : null}
					</span>
					{a.fileId ? (
						<a className="btn btn-sm" href={`/api/attachments/${a.fileId}`}>
							<Icon name="download" size={13} /> Download
						</a>
					) : null}
				</li>
			))}
		</ul>
	);
}

function Checks({ checks }: { checks: Check[] }) {
	return (
		<ul className="mx-8 my-6 divide-y divide-rule rounded-[10px] border border-rule">
			{checks.map((c) => (
				<li key={c.id} className="flex gap-3 px-4 py-3.5">
					<span
						className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
							c.status === "pass"
								? "bg-signal text-paper"
								: c.status === "warn"
									? "bg-hl text-[#0e0e0e]"
									: "bg-red text-paper"
						}`}
					>
						<Icon
							name={
								c.status === "pass"
									? "check"
									: c.status === "warn"
										? "alert"
										: "x"
							}
							size={12}
							strokeWidth={2.5}
						/>
					</span>
					<span className="min-w-0">
						<span className="block font-medium">{c.title}</span>
						<span className="block whitespace-pre-wrap break-all text-[13px] text-graphite">
							{c.detail}
						</span>
					</span>
				</li>
			))}
		</ul>
	);
}
