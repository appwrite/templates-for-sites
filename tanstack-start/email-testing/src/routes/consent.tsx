import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { AuthFrame, FormError } from "#/components/auth-frame";
import { Icon, Logo, Spinner } from "#/components/icons";
import { type SecondFactors, SignIn } from "#/components/sign-in-form";
import {
	type ConsentView,
	fetchConsent,
	submitConsent,
} from "#/functions/consent";
import { submitSignOut } from "#/functions/session";

// The page the project's Appwrite OAuth server sends people to when an AI agent asks for access
// (its authorizationUrl). Sign in, see what the agent asks for, then allow or deny.
export const Route = createFileRoute("/consent")({
	loader: ({ location }) =>
		fetchConsent({ data: { query: location.searchStr } }),
	// Never inside another site's frame, so nobody can trick a click on Allow.
	headers: () => ({
		"x-frame-options": "DENY",
		"content-security-policy": "frame-ancestors 'none'",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store",
	}),
	head: () => ({ meta: [{ title: "Connect an agent · Catchall" }] }),
	component: ConsentPage,
});

const SCOPES: Record<string, { title: string; detail?: string }> = {
	"catchall.read": {
		title: "Read every message in this inbox",
		detail:
			"Subjects, bodies, codes, links and attachment names, for any address.",
	},
	openid: { title: "Know your account ID" },
	profile: { title: "See your name" },
	email: { title: "See your email address" },
	phone: { title: "See your phone number" },
};

function useHost() {
	const [host, setHost] = useState("");
	useEffect(() => setHost(window.location.host), []);
	return host;
}

function ConsentPage() {
	const view = Route.useLoaderData();
	const host = useHost();
	switch (view.view) {
		case "sign-in":
			return (
				<SignInStep
					clientHint={view.clientHint}
					factors={view.factors}
					host={host}
				/>
			);
		case "no-team":
			return <NoTeam view={view} host={host} />;
		case "redirect":
			return <Returning url={view.url} name="your agent" host={host} />;
		case "consent":
			return <Consent view={view} host={host} />;
		default:
			return (
				<AuthFrame
					title="This link doesn't work"
					intro={view.message}
					host={host}
				>
					<Link to="/inbox" className="btn btn-lg w-full">
						Go to the inbox
					</Link>
				</AuthFrame>
			);
	}
}

function SignInStep({
	clientHint,
	factors,
	host,
}: {
	clientHint: string | null;
	factors: SecondFactors | null;
	host: string;
}) {
	const router = useRouter();
	return (
		<SignIn
			title="Sign in to connect an agent"
			intro={
				<>
					{clientHint ? (
						<span className="mono text-[14px] text-ink">{clientHint}</span>
					) : (
						"An AI agent"
					)}{" "}
					wants to read this inbox. Sign in to see what it asks for before you
					decide.
				</>
			}
			host={host}
			factors={factors}
			submitLabel="Continue"
			onSignedIn={async () => {
				await router.invalidate();
			}}
		/>
	);
}

function Monogram({ name }: { name: string }) {
	const letters = name
		.replace(/^https?:\/\//, "")
		.split(/[\s.\-_/]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase())
		.join("");
	return (
		<span className="flex size-12 items-center justify-center rounded-[12px] border border-rule-strong bg-wash text-[17px] font-semibold tracking-tight">
			{letters || "?"}
		</span>
	);
}

function Pair({ name }: { name: string }) {
	return (
		<div className="mb-7 flex items-center gap-3" aria-hidden="true">
			<Monogram name={name} />
			<span className="flex items-center gap-1 text-pencil">
				<span className="size-1 rounded-full bg-current" />
				<span className="size-1 rounded-full bg-current" />
				<span className="size-1 rounded-full bg-current" />
			</span>
			<span className="flex size-12 overflow-hidden rounded-[12px] [&>span]:!rounded-none">
				<Logo size={48} />
			</span>
		</div>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-4 py-2">
			<dt className="w-[84px] shrink-0 text-graphite">{label}</dt>
			<dd className="mono min-w-0 flex-1 truncate text-ink">{children}</dd>
		</div>
	);
}

function hostOf(url: string) {
	try {
		const u = new URL(url);
		return u.host || `${u.protocol}//`;
	} catch {
		return url;
	}
}

function Consent({
	view,
	host,
}: {
	view: Extract<ConsentView, { view: "consent" }>;
	host: string;
}) {
	const { grant, user, problems } = view;
	const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [returning, setReturning] = useState<string | null>(null);
	const name = grant.client.name;
	const scopes = grant.scopes.filter((s) => s in SCOPES);
	const unknown = grant.scopes.filter((s) => !(s in SCOPES));

	const decide = async (approve: boolean) => {
		setBusy(approve ? "allow" : "deny");
		setError(null);
		try {
			const { redirectUrl } = await submitConsent({
				data: { grantId: grant.grantId, approve },
			});
			setReturning(redirectUrl);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	};

	if (returning) return <Returning url={returning} name={name} host={host} />;

	return (
		<AuthFrame
			title={`Connect ${name}`}
			intro={
				<>
					<span className="text-ink">{name}</span> wants to read this inbox as{" "}
					<span className="text-ink">{user.name || user.email}</span>.
				</>
			}
			host={host}
			top={<Pair name={name} />}
		>
			<p className="label mb-2">It will be able to</p>
			<ul className="space-y-3">
				{scopes.map((scope) => (
					<li key={scope} className="flex gap-3">
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-hl text-[#0e0e0e]">
							<Icon name="check" size={12} />
						</span>
						<span className="text-[15px] leading-[22px]">
							{SCOPES[scope].title}
							{SCOPES[scope].detail ? (
								<span className="block text-[13px] leading-[19px] text-graphite">
									{SCOPES[scope].detail}
								</span>
							) : null}
						</span>
					</li>
				))}
				{unknown.map((scope) => (
					<li key={scope} className="flex gap-3">
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-rule-strong">
							<Icon name="check" size={12} />
						</span>
						<span className="mono text-[13px] leading-[22px]">{scope}</span>
					</li>
				))}
				<li className="flex gap-3 text-graphite">
					<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-rule">
						<Icon name="x" size={11} />
					</span>
					<span className="text-[14px] leading-[22px]">
						It can't send, change or delete mail.
					</span>
				</li>
			</ul>

			<dl className="mt-6 divide-y divide-rule rounded-[10px] border border-rule px-3.5 text-[12.5px]">
				<Detail label="Signed in as">
					{user.email}{" "}
					<button
						type="button"
						className="link font-sans text-graphite"
						onClick={async () => {
							await submitSignOut();
							window.location.reload();
						}}
					>
						Not you?
					</button>
				</Detail>
				<Detail label="Server">
					{grant.resources.length
						? grant.resources
								.map((r) => r.replace(/^https?:\/\//, ""))
								.join(", ")
						: "Not named"}
				</Detail>
				<Detail label="Returns to">{hostOf(grant.redirectUri)}</Detail>
				{grant.client.metadataUrl ? (
					<Detail label="Client">
						{grant.client.metadataUrl.replace(/^https:\/\//, "")}
					</Detail>
				) : null}
			</dl>

			{problems.length ? (
				<div className="mt-5 space-y-2">
					{problems.map((p) => (
						<FormError key={p}>{p}</FormError>
					))}
				</div>
			) : null}
			{error ? (
				<div className="mt-5">
					<FormError>{error}</FormError>
				</div>
			) : null}

			<div className="mt-6 grid grid-cols-2 gap-3">
				<button
					type="button"
					className="btn btn-lg w-full"
					disabled={busy !== null}
					onClick={() => decide(false)}
				>
					{busy === "deny" ? <Spinner size={15} /> : null} Deny
				</button>
				<button
					type="button"
					className="btn btn-primary btn-lg w-full"
					disabled={busy !== null || problems.length > 0}
					onClick={() => decide(true)}
				>
					{busy === "allow" ? <Spinner size={15} /> : null} Allow
				</button>
			</div>
			<p className="mt-4 text-[13px] leading-[19px] text-pencil">
				Only allow agents you started yourself. An admin removing you from the
				team cuts off every agent you connected.
			</p>
		</AuthFrame>
	);
}

function NoTeam({
	view,
	host,
}: {
	view: Extract<ConsentView, { view: "no-team" }>;
	host: string;
}) {
	const [busy, setBusy] = useState(false);
	const [returning, setReturning] = useState<string | null>(null);
	if (returning)
		return (
			<Returning
				url={returning}
				name={view.client?.name || "the agent"}
				host={host}
			/>
		);
	return (
		<AuthFrame
			title="No access"
			intro={`You're signed in as ${view.email}, but you're not on this inbox's team, so you can't connect an agent to it.`}
			host={host}
		>
			<div className="space-y-3">
				{view.grantId ? (
					<button
						type="button"
						className="btn btn-primary btn-lg w-full"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							const { redirectUrl } = await submitConsent({
								data: { grantId: view.grantId as string, approve: false },
							});
							setReturning(redirectUrl);
						}}
					>
						{busy ? <Spinner size={15} /> : null} Tell the agent no
					</button>
				) : null}
				<button
					type="button"
					className="btn btn-lg w-full"
					onClick={async () => {
						await submitSignOut();
						window.location.reload();
					}}
				>
					Sign in as someone else
				</button>
			</div>
		</AuthFrame>
	);
}

// Sends the browser back to the agent. A loopback or custom-scheme redirect may leave this tab
// open, so it says what happened.
function Returning({
	url,
	name,
	host,
}: {
	url: string;
	name: string;
	host: string;
}) {
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		window.location.assign(url);
		const timer = setTimeout(() => setSlow(true), 2500);
		return () => clearTimeout(timer);
	}, [url]);
	const denied = /[?&#]error=access_denied/.test(url);
	return (
		<AuthFrame
			title={denied ? "Access denied" : "Connected"}
			intro={
				denied
					? `${name} won't get access. You can close this tab.`
					: `Sending you back to ${name}. It can read this inbox now.`
			}
			host={host}
		>
			<div className="flex items-center gap-3 rounded-[10px] border border-rule px-4 py-3.5 text-[14px] text-graphite">
				{slow ? (
					<Icon name={denied ? "x" : "check"} size={16} />
				) : (
					<Spinner size={16} />
				)}
				{slow ? "You can close this tab." : `Returning to ${hostOf(url)}…`}
			</div>
		</AuthFrame>
	);
}
