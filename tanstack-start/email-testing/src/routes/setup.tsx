import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Icon, Logo, Spinner } from "#/components/icons";
import { fetchSetupView, runSetupStep, submitClaim } from "#/functions/setup";
import { clock } from "#/lib/format";
import type { SetupLogLine, SetupStep, SetupView } from "#/lib/setup-types";

export const Route = createFileRoute("/setup")({
	loader: async () => {
		const view = await fetchSetupView();
		if (view.view === "done")
			throw redirect({ to: view.signedIn ? "/inbox" : "/login" });
		return view;
	},
	head: () => ({ meta: [{ title: "Setup · Catchall" }] }),
	component: SetupPage,
});

function SetupPage() {
	const initial = Route.useLoaderData();
	const [view, setView] = useState<SetupView>(initial);
	useEffect(() => setView(initial), [initial]);

	switch (view.view) {
		case "not-cloud":
			return <NotCloud endpoint={view.endpoint} />;
		case "no-key":
			return <NoKey />;
		case "missing-scopes":
			return <MissingScopes view={view} />;
		case "in-progress":
			return <InProgress />;
		case "claim":
			return <Claim onDone={setView} />;
		case "provision":
			return <Provision view={view} onChange={setView} />;
		case "complete":
			return <Complete view={view} />;
		default:
			return null;
	}
}

// ---------- layout ----------

function Frame({
	stage,
	children,
	side,
}: {
	stage: "before" | "admin" | "create" | "done";
	children: ReactNode;
	side: ReactNode;
}) {
	return (
		<div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,600px)]">
			<div className="px-6 pb-16 pt-6 sm:px-[72px] sm:pt-[26px]">
				<header className="flex items-center gap-2.5">
					<Logo />
					<span className="text-[17px] font-semibold tracking-tight">
						Catchall
					</span>
					<span className="text-pencil">/</span>
					<span className="text-pencil">Setup</span>
				</header>
				<Stepper stage={stage} />
				<div className="mt-14 max-w-[560px] sm:mt-[92px]">{children}</div>
			</div>
			<aside className="relative border-rule bg-wash lg:border-l">
				<div
					className="dither-band absolute inset-x-0 top-0 h-[160px]"
					aria-hidden="true"
				/>
				<div className="relative px-6 pb-16 pt-10 sm:px-16 lg:pt-[218px]">
					{side}
				</div>
			</aside>
		</div>
	);
}

function Stepper({ stage }: { stage: "before" | "admin" | "create" | "done" }) {
	if (stage === "before") {
		return (
			<div className="mt-[76px] text-sm font-medium text-graphite">
				Before you start
			</div>
		);
	}
	const adminDone = stage !== "admin";
	const createDone = stage === "done";
	return (
		<ol className="mt-[76px] flex items-center gap-5 text-sm">
			<StepDot n={1} label="Admin" state={adminDone ? "done" : "active"} />
			<li className="h-px w-5 bg-ink opacity-60" aria-hidden="true" />
			<StepDot
				n={2}
				label="Create"
				state={createDone ? "done" : stage === "create" ? "active" : "todo"}
			/>
		</ol>
	);
}

function StepDot({
	n,
	label,
	state,
}: {
	n: number;
	label: string;
	state: "done" | "active" | "todo";
}) {
	return (
		<li className="flex items-center gap-2">
			<span
				className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
					state === "todo"
						? "border border-rule-strong text-pencil"
						: "bg-button text-button-ink"
				}`}
			>
				{state === "done" ? <Icon name="check" size={12} strokeWidth={3} /> : n}
			</span>
			<span
				className={
					state === "active"
						? "font-semibold"
						: state === "done"
							? "text-graphite"
							: "text-pencil"
				}
			>
				{label}
			</span>
		</li>
	);
}

function Heading({
	children,
	intro,
}: {
	children: ReactNode;
	intro?: ReactNode;
}) {
	return (
		<>
			<h1 className="text-[36px] font-semibold leading-[40px] tracking-display sm:text-[44px] sm:leading-[46px]">
				{children}
			</h1>
			{intro ? (
				<p className="mt-4 text-[17px] leading-[26px] text-graphite">{intro}</p>
			) : null}
		</>
	);
}

function SideTitle({ title, intro }: { title: string; intro?: ReactNode }) {
	return (
		<div className="border-b border-rule-strong pb-4">
			<h2 className="text-[15px] font-semibold">{title}</h2>
			{intro ? (
				<p className="mt-1.5 text-[13px] leading-[18px] text-graphite">
					{intro}
				</p>
			) : null}
		</div>
	);
}

// ---------- 00c: not on Cloud ----------

function NotCloud({ endpoint }: { endpoint: string }) {
	return (
		<Frame
			stage="before"
			side={
				<>
					<SideTitle title="Why Cloud" />
					<p className="mt-4 text-[14px] leading-[22px] text-graphite">
						Catchall receives mail through Appwrite Function email triggers.
						Appwrite Cloud runs the mail servers for{" "}
						<span className="mono">*.appwrite.email</span>. Self-hosted Appwrite
						doesn't have them yet.
					</p>
				</>
			}
		>
			<Heading intro="Setup stopped before creating anything, so there's nothing to clean up.">
				Email triggers need Appwrite Cloud
			</Heading>
			<div className="card mt-8 p-5">
				<div className="text-[13px] text-pencil">This site talks to</div>
				<div className="mono mt-1 break-all">
					{endpoint || "no endpoint set"}
				</div>
			</div>
			<p className="mt-6 text-[15px] leading-[22px] text-graphite">
				Deploy this template to a project on{" "}
				<a
					className="link text-ink"
					href="https://cloud.appwrite.io"
					target="_blank"
					rel="noreferrer"
				>
					Appwrite Cloud
				</a>
				, then open <span className="mono">/setup</span> there.
			</p>
		</Frame>
	);
}

function NoKey() {
	return (
		<Frame
			stage="before"
			side={
				<SideTitle
					title="Running locally"
					intro="Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY in .env to try the app against a Cloud project."
				/>
			}
		>
			<Heading intro="Appwrite Sites gives this site a key on every request. Locally there's no key, so setup can't run.">
				Deploy this site on Appwrite Sites
			</Heading>
		</Frame>
	);
}

// ---------- 00a: missing scopes ----------

function MissingScopes({
	view,
}: {
	view: Extract<SetupView, { view: "missing-scopes" }>;
}) {
	const router = useRouter();
	const [checking, setChecking] = useState(false);
	const products = [
		{
			product: "Auth",
			why: "Checks whether an admin already exists.",
			tag: "Given back",
		},
		{
			product: "Databases",
			why: "Creates the database and its 3 tables.",
			tag: "Rows kept",
		},
		{
			product: "Storage",
			why: "Creates the attachments bucket.",
			tag: "Files kept",
		},
		{
			product: "Functions",
			why: "Deploys the function that receives mail and turns on its email trigger.",
			tag: "Given back",
		},
		{
			product: "Sites",
			why: "Gives back setup permissions at the end.",
			tag: "Given back",
		},
	];
	return (
		<Frame
			stage="before"
			side={
				<>
					<SideTitle
						title="What setup uses them for"
						intro={`Setup needs ${view.total} permissions. When it finishes, the site gives back ${view.total - view.keptCount} and keeps the ${view.keptCount} it needs to run.`}
					/>
					<ul>
						{products.map((p) => (
							<li
								key={p.product}
								className="grid grid-cols-[100px_1fr_auto] items-center gap-3 border-b border-rule py-3.5"
							>
								<span className="text-[15px] font-medium">{p.product}</span>
								<span className="text-[13px] leading-[18px] text-graphite">
									{p.why}
								</span>
								<span
									className={`tag ${p.tag === "Given back" ? "tag-outline" : ""}`}
								>
									{p.tag}
								</span>
							</li>
						))}
					</ul>
					<p className="mt-6 text-[13px] text-pencil">
						Add only these. Setup never asks you to paste a key.
					</p>
				</>
			}
		>
			<Heading intro="It was deployed without the scopes Catchall asks for. Add the missing ones to this site in the Console, then check again. No redeploy needed.">
				This site needs these permissions to set itself up
			</Heading>
			<div className="card mt-8">
				<div className="flex items-center justify-between border-b border-rule px-[18px] py-3">
					<span className="font-medium">Missing</span>
					<span className="mono text-[12px] text-graphite">
						{view.missingCount} of {view.total}
					</span>
				</div>
				<ul className="px-[18px]">
					{view.missing.map((group) => (
						<li
							key={group.product}
							className="grid grid-cols-[112px_1fr] gap-3 border-b border-rule py-3 last:border-0"
						>
							<span className="pt-0.5 text-[15px]">{group.product}</span>
							<span className="flex flex-wrap gap-1.5">
								{group.scopes.map((s) => (
									<span key={s} className="scope">
										{s}
									</span>
								))}
							</span>
						</li>
					))}
				</ul>
			</div>
			<div className="mt-7 flex flex-wrap gap-2.5">
				<a
					className="btn btn-primary btn-lg"
					href={view.consoleUrl}
					target="_blank"
					rel="noreferrer"
				>
					Open Settings → Scopes <Icon name="external" size={15} />
				</a>
				<button
					type="button"
					className="btn btn-lg"
					disabled={checking}
					onClick={async () => {
						setChecking(true);
						await router.invalidate();
						setChecking(false);
					}}
				>
					{checking ? <Spinner size={15} /> : <Icon name="refresh" size={15} />}{" "}
					Check again
				</button>
			</div>
			<p className="mt-3.5 text-[13px] text-pencil">
				Console → Sites → {view.siteName || "your site"} → Settings → Build →
				Scopes
			</p>
		</Frame>
	);
}

// ---------- 02d: someone else is setting up ----------

function InProgress() {
	return (
		<Frame
			stage="before"
			side={
				<SideTitle
					title="Nothing to do here"
					intro="When setup finishes, this page sends you to sign in."
				/>
			}
		>
			<Heading intro="Someone is setting up this inbox. Check back in a few minutes.">
				Setup in progress
			</Heading>
			<p className="mt-8 text-[14px] text-graphite">
				Started this setup?{" "}
				<Link to="/login" className="link text-ink">
					Sign in to continue
				</Link>
			</p>
		</Frame>
	);
}

// ---------- 01: create the admin ----------

const PLAN = [
	"Team with you as admin",
	"Database and 3 tables",
	"Storage bucket for attachments",
	"Function that receives mail, with its code",
	"Email trigger and nightly cleanup",
	"Sign-in for AI agents",
	"Remove setup permissions",
];

function Claim({ onDone }: { onDone: (view: SetupView) => void }) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		setBusy(true);
		setError(null);
		try {
			onDone(
				await submitClaim({
					data: {
						name: String(form.get("name") || ""),
						email: String(form.get("email") || ""),
						password: String(form.get("password") || ""),
					},
				}),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<Frame
			stage="admin"
			side={
				<>
					<SideTitle
						title="What setup creates"
						intro="In your Appwrite project, with this site's own key. It takes about a minute."
					/>
					<ol className="mt-1">
						{PLAN.map((item, i) => (
							<li
								key={item}
								className="flex items-center gap-3 border-b border-rule py-3 text-[14px]"
							>
								<span className="mono w-5 text-[12px] text-pencil">
									{String(i + 1).padStart(2, "0")}
								</span>
								{item}
							</li>
						))}
					</ol>
				</>
			}
		>
			<Heading intro="The first person to finish this becomes the admin. You can invite your team once the inbox is ready.">
				Create the admin account
			</Heading>
			<form className="mt-9 max-w-[440px] space-y-4" onSubmit={submit}>
				<div>
					<label className="label" htmlFor="name">
						Name
					</label>
					<input
						className="input"
						id="name"
						name="name"
						autoComplete="name"
						required
						maxLength={128}
					/>
				</div>
				<div>
					<label className="label" htmlFor="email">
						Email
					</label>
					<input
						className="input"
						id="email"
						name="email"
						type="email"
						autoComplete="email"
						required
					/>
				</div>
				<div>
					<label className="label" htmlFor="password">
						Password
					</label>
					<input
						className="input"
						id="password"
						name="password"
						type="password"
						autoComplete="new-password"
						minLength={8}
						required
					/>
					<p className="mt-1.5 text-[13px] text-pencil">
						At least 8 characters.
					</p>
				</div>
				{error ? (
					<p
						className="rounded-md bg-red-soft px-3 py-2.5 text-[14px] text-red"
						role="alert"
					>
						{error}
					</p>
				) : null}
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy}
				>
					{busy ? <Spinner size={15} /> : null} Create admin and set up
				</button>
			</form>
		</Frame>
	);
}

// ---------- 02a/b/c: provisioning ----------

function Provision({
	view,
	onChange,
}: {
	view: Extract<SetupView, { view: "provision" }>;
	onChange: (view: SetupView) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const doneCount = view.steps.filter((s) => s.status === "done").length;
	const next = view.steps.find((s) => s.status !== "done");

	const run = async (step: SetupStep) => {
		setBusy(true);
		setError(null);
		try {
			onChange(await runSetupStep({ data: { step: step.id } }));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	// Runs the next step on its own. A failed step waits for Retry.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run only when the view or busy state changes
	useEffect(() => {
		if (busy || error || !next || next.status === "failed") return;
		const timer = setTimeout(
			() => run(next),
			next.status === "running" ? 3000 : 150,
		);
		return () => clearTimeout(timer);
	}, [view, busy, error]);

	const failed = view.steps.find((s) => s.status === "failed");

	return (
		<Frame stage="create" side={<Log log={view.log} running={Boolean(next)} />}>
			<Heading>{failed ? "A step failed" : "Creating your inbox"}</Heading>
			<div className="mt-5 flex items-center gap-3">
				<div className="progress-track w-[200px]">
					<div
						className="progress-fill"
						style={{ width: `${(doneCount / view.steps.length) * 100}%` }}
					/>
				</div>
				<span className="text-[15px] text-graphite">
					{doneCount} of {view.steps.length} done
				</span>
			</div>
			{view.resumed ? (
				<p className="mt-6 rounded-md bg-hl-soft px-4 py-3 text-[14px] leading-[20px]">
					Setup paused after {view.resumed.doneCount} of {view.steps.length}{" "}
					steps and picked up at {view.resumed.nextLabel} when you reopened this
					page.
				</p>
			) : null}
			<ol className="mt-7 border-t border-rule">
				{view.steps.map((step) => (
					<StepRow
						key={step.id}
						step={step}
						active={step.id === next?.id}
						onRetry={() => run(step)}
						busy={busy}
					/>
				))}
			</ol>
			{error ? (
				<div
					className="mt-5 rounded-md bg-red-soft px-4 py-3 text-[14px] text-red"
					role="alert"
				>
					{error}{" "}
					<button
						type="button"
						className="link font-medium"
						onClick={() => setError(null)}
					>
						Try again
					</button>
				</div>
			) : null}
		</Frame>
	);
}

function StepRow({
	step,
	active,
	onRetry,
	busy,
}: {
	step: SetupStep;
	active: boolean;
	onRetry: () => void;
	busy: boolean;
}) {
	const highlighted = active && step.status !== "failed";
	return (
		<li
			className={`border-b border-rule px-2.5 ${highlighted ? "rounded-md border-transparent bg-wash-2 py-1" : ""} ${step.status === "failed" ? "bg-red-soft" : ""}`}
		>
			<div className="flex h-[47px] items-center gap-3">
				<StatusIcon status={step.status} active={active} />
				<span
					className={`flex-1 text-[15px] ${active ? "font-semibold" : ""} ${step.status === "pending" && !active ? "text-graphite" : ""}`}
				>
					{step.label}
				</span>
				<span className="mono hidden max-w-[260px] truncate text-[12px] text-graphite sm:inline">
					{step.detail}
				</span>
				<span className="mono w-12 text-right text-[12px] text-graphite">
					{step.durationMs !== undefined ? formatDuration(step.durationMs) : ""}
				</span>
			</div>
			{step.status === "failed" ? (
				<div className="pb-4 pl-8">
					<p className="whitespace-pre-wrap text-[14px] leading-[20px] text-red">
						{step.error}
					</p>
					<p className="mt-2 text-[13px] text-graphite">
						Retry checks the last build first and only starts a new one if it
						failed. Finished steps aren't repeated.
					</p>
					<button
						type="button"
						className="btn btn-sm mt-3"
						onClick={onRetry}
						disabled={busy}
					>
						{busy ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}{" "}
						Retry
					</button>
				</div>
			) : null}
			{highlighted && step.note ? (
				<p className="pb-3 pl-8 text-[14px] leading-[20px] text-graphite">
					{step.note}
				</p>
			) : null}
		</li>
	);
}

function StatusIcon({
	status,
	active,
}: {
	status: SetupStep["status"];
	active: boolean;
}) {
	if (status === "done") {
		return (
			<span className="flex size-5 items-center justify-center rounded-full bg-button text-button-ink">
				<Icon name="check" size={12} strokeWidth={3} />
			</span>
		);
	}
	if (status === "failed") {
		return (
			<span className="flex size-5 items-center justify-center rounded-full bg-red text-paper">
				<Icon name="x" size={12} strokeWidth={3} />
			</span>
		);
	}
	if (active || status === "running") return <Spinner size={20} />;
	return (
		<span className="size-5 rounded-full border border-dashed border-rule-strong" />
	);
}

function formatDuration(ms: number) {
	return ms < 10_000
		? `${(ms / 1000).toFixed(1)} s`
		: `${Math.round(ms / 1000)} s`;
}

function Log({ log, running }: { log: SetupLogLine[]; running: boolean }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running]);
	const start = log[0] ? Date.parse(log[0].t) : now;
	const elapsed = Math.max(0, Math.floor((now - start) / 1000));
	return (
		<>
			<div className="flex items-baseline justify-between">
				<h2 className="text-[15px] font-semibold">Log</h2>
				{log.length ? (
					<span className="mono text-[12px] text-graphite">
						{String(Math.floor(elapsed / 60)).padStart(2, "0")}:
						{String(elapsed % 60).padStart(2, "0")} elapsed
					</span>
				) : null}
			</div>
			<div className="card mono mt-3 space-y-1.5 overflow-hidden p-[18px] text-[12px] leading-[18px]">
				{log.length === 0 ? (
					<div className="text-graphite">Waiting for the first step…</div>
				) : null}
				{log.map((line) =>
					line.kind === "pause" ? (
						<div
							key={`${line.t}-pause`}
							className="my-2 flex items-center gap-2 text-pencil"
						>
							<span className="h-px flex-1 bg-rule" />
							<span suppressHydrationWarning>
								{`paused ${clock(line.t)} · resumed ${line.resumedAt ? clock(line.resumedAt) : ""}`}
							</span>
							<span className="h-px flex-1 bg-rule" />
						</div>
					) : (
						<div key={`${line.t}-${line.text}`} className="flex gap-3">
							<span className="shrink-0 text-pencil" suppressHydrationWarning>
								{clock(line.t)}
							</span>
							<span
								className={`break-all ${line.text.includes("failed") ? "text-red" : ""}`}
							>
								{line.text}
							</span>
						</div>
					),
				)}
			</div>
			<p className="mt-3 text-[13px] text-pencil">
				Closing this tab is safe. Reopen /setup to continue.
			</p>
		</>
	);
}

// ---------- 03a: done ----------

function Complete({
	view,
}: {
	view: Extract<SetupView, { view: "complete" }>;
}) {
	return (
		<Frame
			stage="done"
			side={
				<>
					<SideTitle
						title="Permissions given back"
						intro={`The site went from ${view.scopes.before} scopes to ${view.scopes.after}. It keeps only what it needs to run.`}
					/>
					<div className="mt-4 text-[13px] font-medium text-graphite">
						Given back
					</div>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{view.scopes.givenBack.map((s) => (
							<li
								key={s}
								className="mono rounded bg-wash-2 px-1.5 py-0.5 text-[12px] text-pencil line-through"
							>
								{s}
							</li>
						))}
					</ul>
					<div className="mt-5 text-[13px] font-medium text-graphite">Kept</div>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{view.scopes.kept.map((s) => (
							<li
								key={s}
								className="mono rounded border border-rule-strong px-1.5 py-0.5 text-[12px]"
							>
								{s}
							</li>
						))}
					</ul>
				</>
			}
		>
			<Heading intro="Send mail to any name at this domain. Each address works the moment you use it.">
				Your inbox is ready
			</Heading>
			<div className="card mt-8 p-5">
				<div className="text-[13px] text-pencil">For example</div>
				<div className="mono mt-1.5 break-all text-[15px]">
					<span className="bg-hl text-[#0e0e0e]">hello</span>@{view.domain}
				</div>
			</div>
			<a href="/inbox" className="btn btn-primary btn-lg mt-7">
				Open the inbox <Icon name="arrowRight" size={15} />
			</a>
		</Frame>
	);
}
