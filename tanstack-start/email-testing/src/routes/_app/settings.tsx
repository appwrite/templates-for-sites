import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { CodeTabs } from "#/components/code-tabs";
import { CopyButton } from "#/components/copy-button";
import { Icon, Spinner } from "#/components/icons";
import { TwoStepSettings } from "#/components/two-step-settings";
import { fetchInbox } from "#/functions/inbox";
import {
	changeRole,
	clearInbox,
	dropMember,
	fetchSettings,
	fetchTokens,
	saveRetention,
	sendInvite,
} from "#/functions/settings";
import { fetchTwoStep } from "#/functions/two-step";
import { ago, initials } from "#/lib/format";
import type { MemberInfo } from "#/lib/types";

const RETENTION = [1, 3, 7, 14, 30];

export const Route = createFileRoute("/_app/settings")({
	loader: async () => {
		const [settings, tokens, inbox, twoStep] = await Promise.all([
			fetchSettings(),
			fetchTokens(),
			fetchInbox({ data: { limit: 1 } }),
			fetchTwoStep(),
		]);
		return {
			...settings,
			tokens: tokens.tokens,
			messageCount: inbox.total,
			twoStep,
		};
	},
	head: () => ({ meta: [{ title: "Settings · Catchall" }] }),
	component: SettingsPage,
});

function SettingsPage() {
	const data = Route.useLoaderData();
	const isAdmin = data.role === "admin";
	const activeTokens = data.tokens.filter(
		(t) => Date.parse(t.expiresAt) > Date.now(),
	);
	const lastUsed = activeTokens
		.map((t) => t.lastUsedAt)
		.filter((d): d is string => Boolean(d))
		.sort()
		.at(-1);

	return (
		<div>
			<header className="flex flex-wrap items-baseline gap-3 border-b border-rule px-10 py-[19px]">
				<h1 className="text-[20px] font-semibold tracking-tight">Settings</h1>
				<span className="text-[13px] text-graphite">
					Shared by everyone on this inbox
				</span>
			</header>
			<div className="max-w-[920px] px-6 sm:px-10">
				<Row
					title="Receiving address"
					intro="Every name before the @ works on this domain. Nothing to create per address."
				>
					<div className="card flex items-center gap-3 px-4 py-3.5">
						<span className="min-w-0 flex-1">
							<span className="block text-[12px] text-graphite">
								Built-in domain
							</span>
							<span className="mono block break-all">*@{data.domain}</span>
						</span>
						<span className="flex items-center gap-1.5 text-[13px] text-signal">
							<span className="live-dot" /> Receiving
						</span>
						<CopyButton value={data.domain} />
					</div>
				</Row>

				<Row
					title="Retention"
					intro="Test mail piles up fast. Old messages and their attachments are deleted every night."
				>
					<Retention days={data.retentionDays} disabled={!isAdmin} />
				</Row>

				<Row
					title="Members"
					intro="Everyone here sees all mail. Admins can change settings and manage members."
				>
					<Members members={data.members} isAdmin={isAdmin} />
				</Row>

				<Row
					title="Security"
					intro="Just for your account. Two-step sign-in asks for a code from an authenticator app after your password."
				>
					<TwoStepSettings
						enabled={data.twoStep.enabled}
						email={data.members.find((m) => m.you)?.email ?? ""}
					/>
				</Row>

				<Row title="API tokens" intro="Read-only tokens for test runners.">
					<Link
						to="/tests"
						className="card flex items-center gap-3 px-4 py-3.5 hover:bg-wash"
					>
						<span className="flex-1" suppressHydrationWarning>
							{`${activeTokens.length} active token${activeTokens.length === 1 ? "" : "s"}${lastUsed ? `, last used ${ago(lastUsed)}` : ""}`}
						</span>
						<span className="flex items-center gap-1.5 font-medium">
							Manage in Tests & API <Icon name="arrowRight" size={14} />
						</span>
					</Link>
				</Row>

				<Row
					title="Connect an AI agent"
					intro="Let Claude Code, Cursor or Codex read this inbox over MCP. Each person signs in with their own account."
				>
					<AgentConnect
						url={data.mcpUrl}
						status={data.agents?.status ?? null}
						elsewhere={
							data.agents?.status === "elsewhere"
								? data.agents.authorizationUrl
								: null
						}
						consentUrl={data.mcpUrl.replace(/\/mcp$/, "/consent")}
					/>
				</Row>

				<Row
					title="Permissions"
					intro="What this site can do in your Appwrite project. Read-only here."
				>
					<Permissions permissions={data.permissions} />
				</Row>

				{isAdmin ? (
					<Row
						title="Empty the inbox"
						intro="Delete every message and attachment now. Addresses keep working."
						last
					>
						<EmptyInbox count={data.messageCount} />
					</Row>
				) : null}
			</div>
		</div>
	);
}

function Row({
	title,
	intro,
	children,
	last = false,
}: {
	title: string;
	intro: string;
	children: ReactNode;
	last?: boolean;
}) {
	return (
		<section
			className={`grid gap-6 py-8 md:grid-cols-[256px_minmax(0,1fr)] md:gap-10 ${last ? "" : "border-b border-rule"}`}
		>
			<div>
				<h2 className="text-[15px] font-semibold">{title}</h2>
				<p className="mt-1.5 text-[13px] leading-[19px] text-graphite">
					{intro}
				</p>
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

function Retention({ days, disabled }: { days: number; disabled: boolean }) {
	const router = useRouter();
	const [value, setValue] = useState(days);
	const [saving, setSaving] = useState(false);
	return (
		<div>
			<div className="text-[13px] font-medium">Keep messages for</div>
			<div className="segmented mt-2.5">
				{RETENTION.map((d) => (
					<button
						key={d}
						type="button"
						data-active={value === d}
						disabled={disabled || saving}
						onClick={async () => {
							setValue(d);
							setSaving(true);
							try {
								await saveRetention({ data: { days: d } });
								await router.invalidate();
							} finally {
								setSaving(false);
							}
						}}
					>
						{d} day{d === 1 ? "" : "s"}
					</button>
				))}
			</div>
			<p className="mt-3 flex items-center gap-1.5 text-[13px] text-graphite">
				<Icon name="clock" size={14} /> Runs daily at 03:00 UTC.
				{disabled ? " Only admins can change this." : ""}
			</p>
		</div>
	);
}

function Members({
	members,
	isAdmin,
}: {
	members: MemberInfo[];
	isAdmin: boolean;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState<string | null>(null);

	const invite = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formEl = e.currentTarget;
		const form = new FormData(formEl);
		const email = String(form.get("email") || "");
		setBusy(true);
		setError(null);
		setSent(null);
		try {
			await sendInvite({
				data: {
					email,
					name: "",
					role: form.get("role") === "admin" ? "admin" : "member",
				},
			});
			setSent(email);
			formEl.reset();
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			{isAdmin ? (
				<form className="flex flex-wrap gap-2" onSubmit={invite}>
					<input
						className="input !h-9 min-w-[200px] flex-1 !text-[14px]"
						name="email"
						type="email"
						placeholder="teammate@example.com"
						required
						aria-label="Email to invite"
					/>
					<select
						name="role"
						className="input !h-9 !w-auto !pr-8 !text-[14px]"
						aria-label="Role"
						defaultValue="member"
					>
						<option value="member">Member</option>
						<option value="admin">Admin</option>
					</select>
					<button
						className="btn btn-primary !h-9"
						type="submit"
						disabled={busy}
					>
						{busy ? <Spinner size={14} /> : null} Invite
					</button>
				</form>
			) : null}
			{error ? <p className="mt-2 text-[13px] text-red">{error}</p> : null}
			{sent ? (
				<p className="mt-2 text-[13px] text-signal">
					Invite sent to {sent}. The link in the email opens this site.
				</p>
			) : null}
			<ul className="mt-3 divide-y divide-rule">
				{members.map((m) => (
					<li key={m.membershipId} className="flex items-center gap-3 py-3">
						<span
							className={`flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
								m.confirmed
									? m.you
										? "bg-button text-button-ink"
										: "bg-wash-2"
									: "border border-dashed border-rule-strong text-graphite"
							}`}
						>
							{initials(m.name, m.email)}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block truncate">
								{m.name || m.email}{" "}
								{m.you ? <span className="text-graphite">(you)</span> : null}
							</span>
							<span
								className="block truncate text-[13px] text-graphite"
								suppressHydrationWarning
							>
								{m.confirmed ? m.email : `Invited ${ago(m.joinedAt)}`}
							</span>
						</span>
						{isAdmin && !m.you ? (
							<>
								<select
									className="input !h-8 !w-auto !pr-7 !text-[13px]"
									value={m.role}
									aria-label={`Role for ${m.email}`}
									onChange={async (e) => {
										await changeRole({
											data: {
												membershipId: m.membershipId,
												role: e.target.value === "admin" ? "admin" : "member",
											},
										});
										await router.invalidate();
									}}
								>
									<option value="member">Member</option>
									<option value="admin">Admin</option>
								</select>
								<button
									type="button"
									className="btn btn-ghost btn-sm"
									onClick={async () => {
										if (
											!confirm(
												`Remove ${m.email}? They lose access right away.`,
											)
										)
											return;
										await dropMember({
											data: { membershipId: m.membershipId },
										});
										await router.invalidate();
									}}
								>
									Remove
								</button>
							</>
						) : (
							<span className="w-20 text-[14px] text-graphite">
								{m.role === "admin" ? "Admin" : "Member"}
							</span>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function Permissions({
	permissions,
}: {
	permissions: {
		rows: { scope: string; why: string; state: string }[];
		known: boolean;
	};
}) {
	const leftover = permissions.rows.filter(
		(r) => r.state === "setup" || r.state === "extra",
	).length;
	const missing = permissions.rows.filter((r) => r.state === "missing").length;
	const kept = permissions.rows.filter((r) => r.state === "kept").length;
	return (
		<div className="card overflow-hidden">
			<div className="flex items-center gap-2 border-b border-rule px-4 py-3">
				<Icon
					name="shieldCheck"
					size={16}
					className={leftover || missing ? "text-red" : "text-signal"}
				/>
				<span className="flex-1">
					{!permissions.known
						? "Scopes unknown: this request didn't come through Appwrite Sites"
						: leftover
							? `${leftover} scope${leftover === 1 ? "" : "s"} more than the app needs`
							: missing
								? `${missing} scope${missing === 1 ? "" : "s"} missing`
								: `${kept} scopes, only what the app needs to run`}
				</span>
			</div>
			<ul className="divide-y divide-rule">
				{permissions.rows.map((r) => {
					const fine = r.state === "kept" || r.state === "platform";
					return (
						<li
							key={r.scope}
							className="grid grid-cols-[minmax(130px,auto)_1fr_auto] items-center gap-4 px-4 py-2.5"
						>
							<span
								className={`mono font-medium ${fine ? "" : "text-red"} ${r.state === "platform" ? "text-graphite" : ""}`}
							>
								{r.scope}
							</span>
							<span className="text-[13px] text-graphite">{r.why}</span>
							{fine ? (
								r.state === "platform" ? (
									<span className="tag tag-outline">Appwrite</span>
								) : null
							) : (
								<span className="tag tag-outline !text-red">
									{r.state === "missing"
										? "Missing"
										: r.state === "setup"
											? "Setup only"
											: "Not used"}
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<div className="bg-wash px-4 py-3.5 text-[13px] leading-[19px] text-graphite">
				Read live from the site on every request. Change them in the Console
				under Sites → your site → Settings → Build → Scopes.
			</div>
		</div>
	);
}

function EmptyInbox({ count }: { count: number }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	return (
		<div>
			<button
				type="button"
				className="btn btn-danger"
				disabled={busy || count === 0}
				onClick={async () => {
					if (
						!confirm(
							`Delete all ${count} messages and their attachments? This can't be undone.`,
						)
					)
						return;
					setBusy(true);
					try {
						const { removed } = await clearInbox();
						setResult(`Deleted ${removed} message${removed === 1 ? "" : "s"}.`);
						await router.invalidate();
					} finally {
						setBusy(false);
					}
				}}
			>
				{busy ? <Spinner size={14} /> : <Icon name="trash" size={15} />} Delete{" "}
				{count} message{count === 1 ? "" : "s"}
			</button>
			{result ? (
				<p className="mt-2 text-[13px] text-graphite">{result}</p>
			) : null}
		</div>
	);
}

const AGENT_TOOLS = [
	["wait_for_message", "Waits for mail to an address and returns it"],
	["get_latest_code", "The newest code and action link for an address"],
	["list_messages", "Recent mail, filtered by address and time"],
	["get_message", "One message in full: bodies, links, checks"],
];

function agentTabs(url: string) {
	return [
		{
			id: "claude",
			label: "Claude Code",
			files: [
				{
					path: "Terminal",
					code: `claude mcp add --transport http catchall ${url}`,
				},
			],
			note: (
				<>
					Then run <span className="mono text-white">/mcp</span> in Claude Code,
					pick catchall and choose Authenticate. A browser opens to sign in.
				</>
			),
		},
		{
			id: "cursor",
			label: "Cursor",
			files: [
				{
					path: "~/.cursor/mcp.json",
					code: JSON.stringify({ mcpServers: { catchall: { url } } }, null, 2),
				},
			],
			note: "Cursor lists catchall under Settings → MCP with a Connect button. Click it to sign in.",
		},
		{
			id: "codex",
			label: "Codex",
			files: [
				{
					path: "~/.codex/config.toml",
					code: `[mcp_servers.catchall]\nurl = "${url}"`,
				},
				{ path: "Terminal", code: "codex mcp login catchall" },
			],
			note: "The login command opens a browser to sign in.",
		},
		{
			id: "other",
			label: "Other clients",
			files: [{ path: "MCP server URL", code: url }],
			note: (
				<>
					Streamable HTTP with OAuth 2.1. Clients find the sign-in details on
					their own from the 401 response. Scope:{" "}
					<span className="mono text-white">catchall.read</span>.
				</>
			),
		},
	];
}

function AgentConnect({
	url,
	status,
	elsewhere,
	consentUrl,
}: {
	url: string;
	status: "ready" | "elsewhere" | null;
	elsewhere: string | null;
	consentUrl: string;
}) {
	return (
		<div className="space-y-4">
			<div className="card flex items-center gap-3 px-4 py-3.5">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-graphite">
					<Icon name="plug" size={17} />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2 text-[12px] text-graphite">
						MCP server
						{status === "ready" ? (
							<span className="flex items-center gap-1.5 text-signal sm:hidden">
								<span className="live-dot" /> Sign-in on
							</span>
						) : null}
					</span>
					<span className="mono block break-all">{url}</span>
				</span>
				{status === "ready" ? (
					<span className="hidden items-center gap-1.5 text-[13px] text-signal sm:flex">
						<span className="live-dot" /> Sign-in on
					</span>
				) : null}
				<CopyButton value={url} />
			</div>

			{status === "elsewhere" && elsewhere ? (
				<Callout title="Agents can't sign in here yet">
					This project's OAuth server already sends people to{" "}
					<span className="mono text-ink">{elsewhere}</span>, so setup left it
					alone. To use it for Catchall, set its authorization URL to{" "}
					<span className="mono text-ink">{consentUrl}</span> in the Appwrite
					Console. That stops the other app's sign-in.
				</Callout>
			) : null}
			{status === null ? (
				<Callout title="Agent sign-in isn't set up">
					This inbox was set up before agents could connect. Turn on the
					project's OAuth server in the Appwrite Console with the authorization
					URL <span className="mono text-ink">{consentUrl}</span> and the scope{" "}
					<span className="mono text-ink">catchall.read</span>.
				</Callout>
			) : null}

			<CodeTabs tabs={agentTabs(url)} />

			<div className="card divide-y divide-rule">
				<div className="flex items-center justify-between px-4 py-3">
					<span className="text-[13px] font-medium">What agents can do</span>
					<span className="flex items-center gap-1.5 text-[12px] text-graphite">
						<Icon name="lock" size={13} /> Read-only
					</span>
				</div>
				{AGENT_TOOLS.map(([name, what]) => (
					<div
						key={name}
						className="grid gap-1 px-4 py-2.5 sm:grid-cols-[176px_1fr] sm:gap-4"
					>
						<span className="mono text-[13px]">{name}</span>
						<span className="text-[13px] text-graphite">{what}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function Callout({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex gap-3 rounded-[10px] border border-rule-strong bg-wash px-4 py-3.5">
			<Icon name="alert" size={16} className="mt-0.5 shrink-0 text-red" />
			<div className="text-[13px] leading-[20px] text-graphite">
				<div className="mb-0.5 text-[14px] font-medium text-ink">{title}</div>
				{children}
			</div>
		</div>
	);
}
