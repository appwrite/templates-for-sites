import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { CopyButton } from "#/components/copy-button";
import { Icon, Spinner } from "#/components/icons";
import { addToken, deleteToken, fetchTokens } from "#/functions/settings";
import { ago, daysLeft, shortDate } from "#/lib/format";

export const Route = createFileRoute("/_app/tests")({
	loader: () => fetchTokens(),
	head: () => ({ meta: [{ title: "Tests & API · Catchall" }] }),
	component: TestsPage,
});

function TestsPage() {
	const { tokens, origin, domain } = Route.useLoaderData();
	const router = useRouter();
	const [created, setCreated] = useState<{
		token: string;
		name: string;
		expiresAt: string;
	} | null>(null);
	const [naming, setNaming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const create = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const name = String(new FormData(e.currentTarget).get("name") || "");
		setBusy(true);
		setError(null);
		try {
			const result = await addToken({ data: { name } });
			setCreated({
				token: result.token,
				name: result.info.name,
				expiresAt: result.info.expiresAt,
			});
			setNaming(false);
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<header className="flex flex-wrap items-baseline gap-3 border-b border-rule px-10 py-[19px]">
				<h1 className="text-[20px] font-semibold tracking-tight">
					Tests & API
				</h1>
				<span className="text-[13px] text-graphite">
					Wait for an email from Playwright, Vitest or any HTTP client
				</span>
			</header>
			<div className="grid gap-12 px-6 py-10 sm:px-10 xl:grid-cols-[minmax(0,632px)_minmax(0,420px)]">
				<div className="min-w-0">
					<Section n="01" title="Create a token for your test runner">
						<p className="text-[14px] leading-[21px] text-graphite">
							Tokens can read every message in this inbox, and nothing else.
							Each one expires after 90 days. Store one as a secret in CI, for
							example <span className="mono text-ink">CATCHALL_TOKEN</span>.
						</p>
						{created ? (
							<div className="mt-5 rounded-[10px] border border-[var(--hl-ring)] bg-hl-soft p-4">
								<p className="text-[13px]">
									<span className="font-semibold">{created.name}</span> is
									ready. Copy it now, it won't be shown again. Expires{" "}
									{shortDate(created.expiresAt)}.
								</p>
								<div className="mt-2.5 flex gap-2">
									<input
										className="input mono !h-9 !text-[13px]"
										readOnly
										value={created.token}
										onFocus={(e) => e.currentTarget.select()}
										aria-label="New token"
									/>
									<CopyButton
										value={created.token}
										label="Copy"
										className="btn btn-primary !h-9 !text-button-ink"
									/>
								</div>
							</div>
						) : null}
						{tokens.length ? (
							<ul className="mt-4 divide-y divide-rule rounded-[10px] border border-rule">
								{tokens.map((t) => {
									const left = daysLeft(t.expiresAt);
									return (
										<li
											key={t.id}
											className="flex items-center gap-4 px-4 py-2.5"
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[15px]">
													{t.name}
												</span>
												<span className="mono block text-[12px] text-graphite">
													{t.prefix}
													{t.mine ? "" : ` · ${t.createdByName}`}
												</span>
											</span>
											<span className="text-right text-[13px] leading-[18px] text-graphite">
												<span className="block" suppressHydrationWarning>
													{t.lastUsedAt
														? `Used ${ago(t.lastUsedAt)}`
														: `Created ${ago(t.createdAt)}`}
												</span>
												<span
													className={`block ${left <= 7 ? "text-red" : ""}`}
												>
													{left > 0
														? `${left} day${left === 1 ? "" : "s"} left`
														: "Expired"}
												</span>
											</span>
											<button
												type="button"
												className="btn btn-ghost btn-sm"
												onClick={async () => {
													if (
														!confirm(
															`Revoke ${t.name}? Test runs that use it will get 401.`,
														)
													)
														return;
													await deleteToken({ data: { id: t.id } });
													await router.invalidate();
												}}
											>
												Revoke
											</button>
										</li>
									);
								})}
							</ul>
						) : null}
						{naming ? (
							<form className="mt-3 flex gap-2" onSubmit={create}>
								<input
									className="input !h-9 !text-[14px]"
									name="name"
									placeholder="github-actions"
									maxLength={64}
									required
									// biome-ignore lint/a11y/noAutofocus: the field appears because the person asked for it
									autoFocus
									aria-label="Token name"
								/>
								<button
									className="btn btn-primary"
									type="submit"
									disabled={busy}
								>
									{busy ? <Spinner size={14} /> : null} Create
								</button>
								<button
									className="btn btn-ghost"
									type="button"
									onClick={() => setNaming(false)}
								>
									Cancel
								</button>
							</form>
						) : (
							<button
								type="button"
								className="btn mt-3"
								onClick={() => setNaming(true)}
							>
								<Icon name="plus" size={15} /> New token
							</button>
						)}
						{error ? (
							<p className="mt-2 text-[13px] text-red">{error}</p>
						) : null}
					</Section>

					<Section n="02" title="Drop it into your tests" className="mt-12">
						<p className="text-[14px] leading-[21px] text-graphite">
							One small helper. Every test invents its own address, so tests
							never read each other's mail.
						</p>
						<Snippets domain={domain} />
						<div className="mt-6 text-[13px] text-graphite">
							Environment variables for your runner
						</div>
						<div className="mt-2 divide-y divide-rule rounded-[10px] border border-rule">
							<div className="grid grid-cols-[160px_1fr_auto] items-center gap-3 px-4 py-3">
								<span className="mono font-semibold">CATCHALL_URL</span>
								<span className="mono truncate text-[13px] text-graphite">
									{origin}
								</span>
								<CopyButton value={origin} />
							</div>
							<div className="grid grid-cols-[160px_1fr_auto] items-center gap-3 px-4 py-3">
								<span className="mono font-semibold">CATCHALL_TOKEN</span>
								<span className="text-[13px] text-graphite">
									Your token from step 01
								</span>
								<span />
							</div>
						</div>
					</Section>
				</div>

				<aside className="min-w-0">
					<h2 className="text-[17px] font-semibold">Wait endpoint reference</h2>
					<p className="mt-2 text-[14px] leading-[21px] text-graphite">
						Holds the request open until mail for the address arrives, then
						returns the newest message with its code and links already pulled
						out.
					</p>
					<div className="mt-4 flex items-center gap-2.5 rounded-lg border border-rule-strong px-2 py-2">
						<span className="rounded bg-button px-1.5 py-0.5 font-mono text-[11px] font-semibold text-button-ink">
							GET
						</span>
						<span className="mono min-w-0 flex-1 truncate text-[13px]">
							/api/messages/wait
							<span className="text-graphite">?to=…&amp;timeout=20</span>
						</span>
						<CopyButton value={`${origin}/api/messages/wait?to=&timeout=20`} />
					</div>
					<dl className="mt-4 divide-y divide-rule text-[14px]">
						<Param name="to">
							Required. The full address, or only the part before the @.
						</Param>
						<Param name="timeout">
							Seconds to wait, up to 25. Defaults to 20.
						</Param>
						<Param name="since">
							Ignore mail received before this ISO time. Useful when an address
							is reused.
						</Param>
						<div className="grid grid-cols-[84px_1fr] gap-3 py-3">
							<dt className="text-[13px] text-graphite">Returns</dt>
							<dd>
								<span className="mono">200</span> with the message,{" "}
								<span className="mono">404</span> if nothing arrived in time,{" "}
								<span className="mono">401</span> for a bad token.
							</dd>
						</div>
					</dl>
					<div className="mt-3 text-[13px] text-graphite">Response</div>
					<ResponseSample domain={domain} />
					<p className="mt-4 text-[13px] leading-[19px] text-graphite">
						Also: <span className="mono text-ink">GET /api/messages?to=</span>{" "}
						returns the latest message without waiting, and attachment URLs in
						the response download with the same token.
					</p>
				</aside>
			</div>
		</div>
	);
}

function Section({
	n,
	title,
	children,
	className = "",
}: {
	n: string;
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`grid grid-cols-[28px_1fr] ${className}`}>
			<span className="mono pt-1 text-[12px] text-graphite">{n}</span>
			<div className="min-w-0">
				<h2 className="mb-1.5 text-[17px] font-semibold">{title}</h2>
				{children}
			</div>
		</section>
	);
}

function Param({ name, children }: { name: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[84px_1fr] gap-3 py-3">
			<dt className="mono font-semibold">{name}</dt>
			<dd className="leading-[20px] text-graphite">{children}</dd>
		</div>
	);
}

function snippets(
	domain: string,
): { id: string; label: string; files: { path: string; code: string }[] }[] {
	return [
		{
			id: "playwright",
			label: "Playwright",
			files: [
				{
					path: "tests/helpers/wait-for-email.ts",
					code: `const { CATCHALL_URL, CATCHALL_TOKEN } = process.env;

export async function waitForEmail(to: string, timeout = 20) {
  const url = new URL('/api/messages/wait', CATCHALL_URL);
  url.searchParams.set('to', to);
  url.searchParams.set('timeout', String(timeout));

  const res = await fetch(url, {
    headers: { Authorization: \`Bearer \${CATCHALL_TOKEN}\` },
  });
  if (!res.ok) throw new Error(\`Wait failed for \${to}: \${res.status}\`);
  return res.json(); // { subject, codes, links, html, text }
}`,
				},
				{
					path: "tests/signup.spec.ts",
					code: `import { test, expect } from '@playwright/test';
import { waitForEmail } from './helpers/wait-for-email';

const DOMAIN = '${domain}';

test('signs up with the emailed code', async ({ page }) => {
  test.setTimeout(60_000);
  const to = \`signup-\${Date.now()}@\${DOMAIN}\`;

  await page.goto('/signup');
  await page.getByLabel('Email').fill(to);
  await page.getByRole('button', { name: 'Continue' }).click();

  const email = await waitForEmail(to);
  await page.getByLabel('Code').fill(email.codes[0]);
  await expect(page).toHaveURL('/welcome');
});`,
				},
			],
		},
		{
			id: "vitest",
			label: "Vitest",
			files: [
				{
					path: "test/reset-password.test.ts",
					code: `import { expect, test } from 'vitest';

const { CATCHALL_URL, CATCHALL_TOKEN } = process.env;
const DOMAIN = '${domain}';

test('sends a reset link', async () => {
  const to = \`reset-\${Date.now()}@\${DOMAIN}\`;
  await requestPasswordReset(to); // your app's code

  const url = new URL('/api/messages/wait', CATCHALL_URL);
  url.searchParams.set('to', to);
  const res = await fetch(url, {
    headers: { Authorization: \`Bearer \${CATCHALL_TOKEN}\` },
  });

  expect(res.status).toBe(200);
  const email = await res.json();
  expect(email.links.some((l) => l.url.includes('/reset'))).toBe(true);
}, 30_000);`,
				},
			],
		},
		{
			id: "curl",
			label: "cURL",
			files: [
				{
					path: "terminal",
					code: `curl -sf "$CATCHALL_URL/api/messages/wait?to=signup-123@${domain}&timeout=20" \\
  -H "Authorization: Bearer $CATCHALL_TOKEN" | jq '.codes[0]'`,
				},
			],
		},
	];
}

function Snippets({ domain }: { domain: string }) {
	const all = snippets(domain);
	const [active, setActive] = useState(all[0].id);
	const current = all.find((s) => s.id === active) || all[0];
	return (
		<div className="mt-5 overflow-hidden rounded-[10px] bg-[var(--code-bg)] text-[var(--code-ink)]">
			<div className="flex gap-5 border-b border-white/10 px-4">
				{all.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => setActive(s.id)}
						className={`-mb-px h-11 border-b-2 text-[14px] ${s.id === active ? "border-[var(--hl)] font-medium text-white" : "border-transparent text-white/60 hover:text-white"}`}
					>
						{s.label}
					</button>
				))}
			</div>
			{current.files.map((file) => (
				<div key={file.path} className="border-b border-white/10 last:border-0">
					<div className="flex items-center justify-between px-5 pt-4">
						<span className="mono text-[12px] text-white/50">{file.path}</span>
						<CopyButton
							value={file.code}
							label="Copy"
							className="!text-white/60 text-[12px] hover:!text-white"
							size={13}
						/>
					</div>
					<pre className="mono overflow-x-auto px-5 pb-5 pt-3 text-[13px] leading-[22px]">
						{file.code}
					</pre>
				</div>
			))}
		</div>
	);
}

function ResponseSample({ domain }: { domain: string }) {
	const short = domain.replace(/^(inbox-.{4}).*(\.appwrite\.email)$/, "$1…$2");
	const lines: [string, ReactNode][] = [
		["id", <S key="id">"6727a1f0002b5c9e41d3"</S>],
		[
			"to",
			<>
				[<S key="to">"signup-8f3a@{short}"</S>]
			</>,
		],
		["from", <S key="from">"Kestrel &lt;no-reply@kestrel.dev&gt;"</S>],
		["subject", <S key="s">"Your Kestrel verification code"</S>],
		["receivedAt", <S key="r">"2026-11-02T14:32:09.418Z"</S>],
		[
			"codes",
			<>
				[<S key="c">"482913"</S>]
			</>,
		],
		[
			"links",
			<>
				[{"{"} <K>"text"</K>: <S>"Verify email"</S>, <K>"url"</K>:{" "}
				<S>"https://…"</S> {"}"}]
			</>,
		],
		[
			"spam",
			<>
				{"{"} <K>"score"</K>: <N>0.02</N>, <K>"verdict"</K>: <S>"ham"</S> {"}"}
			</>,
		],
		["text", <S key="t">"Confirm your email…"</S>],
		["html", <S key="h">"&lt;!doctype html&gt;…"</S>],
		["attachments", <>[]</>],
	];
	return (
		<pre className="json-light mono mt-2 whitespace-pre-wrap break-words rounded-[10px] border border-rule bg-wash p-4 text-[12px] leading-[20px]">
			{"{\n"}
			{lines.map(([key, value], i) => (
				<span key={key}>
					{"  "}
					<K>"{key}"</K>: {value}
					{i < lines.length - 1 ? ",\n" : "\n"}
				</span>
			))}
			{"}"}
		</pre>
	);
}

const S = ({ children }: { children: ReactNode }) => (
	<span className="json-string">{children}</span>
);
const N = ({ children }: { children: ReactNode }) => (
	<span className="json-number">{children}</span>
);
const K = ({ children }: { children: ReactNode }) => (
	<span className="json-key">{children}</span>
);
