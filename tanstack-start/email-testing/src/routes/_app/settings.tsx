import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { CopyButton } from "#/components/copy-button";
import { Icon, Spinner } from "#/components/icons";
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
import { ago, initials } from "#/lib/format";
import type { MemberInfo } from "#/lib/types";

const RETENTION = [1, 3, 7, 14, 30];

export const Route = createFileRoute("/_app/settings")({
	loader: async () => {
		const [settings, tokens, inbox] = await Promise.all([
			fetchSettings(),
			fetchTokens(),
			fetchInbox({ data: { limit: 1 } }),
		]);
		return { ...settings, tokens: tokens.tokens, messageCount: inbox.total };
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
