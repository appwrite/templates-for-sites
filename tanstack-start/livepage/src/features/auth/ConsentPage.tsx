import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Avatar } from "#/components/ui";
import type { LoginState } from "#/functions/auth";
import { type ConsentView, submitConsent } from "#/functions/consent";
import { submitSignOut } from "#/functions/session";
import { errorText } from "#/lib/errors";
import { AuthFrame, FormError, SubmitButton } from "./frame";
import { SignInForm } from "./LoginPage";

const routeApi = getRouteApi("/consent");
const MCP_SCOPE = "livepage.workspace";

const SCOPES: Record<string, { title: string; detail?: string }> = {
	"livepage.workspace": {
		title: "Read and edit the pages you can access",
		detail: "Pages, databases and comments in your workspaces, as you.",
	},
	openid: { title: "Know your account ID" },
	profile: { title: "See your name" },
	email: { title: "See your email address" },
	phone: { title: "See your phone number" },
};

export function ConsentPage() {
	const view = routeApi.useLoaderData();
	switch (view.view) {
		case "sign-in":
			return <SignInStep view={view} />;
		case "no-workspace":
			return <NoWorkspace view={view} />;
		case "redirect":
			return <Returning url={view.url} name="your agent" />;
		case "consent":
			return <Consent view={view} />;
		default:
			return (
				<AuthFrame title="This link doesn't work." intro={view.message}>
					<a href="/" className="text-sm leading-4 text-link hover:underline">
						Go to Livepage
					</a>
				</AuthFrame>
			);
	}
}

function SignInStep({
	view,
}: {
	view: Extract<ConsentView, { view: "sign-in" }>;
}) {
	const router = useRouter();
	const state: LoginState = {
		signup: "invite",
		status: "signed-out",
		factors: view.factors,
		workspaceName: null,
	};
	return (
		<SignInForm
			state={state}
			title="Sign in to connect an agent."
			intro={
				<>
					{view.clientHint ? (
						<span className="font-mono text-[14px] text-ink">
							{view.clientHint}
						</span>
					) : (
						"An AI agent"
					)}{" "}
					wants to work in your workspace. Sign in to see what it asks for
					before you decide.
				</>
			}
			submitLabel="Continue"
			onSignedIn={() => router.invalidate()}
		/>
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
}: {
	view: Extract<ConsentView, { view: "consent" }>;
}) {
	const { grant, user, problems, workspaces } = view;
	const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [returning, setReturning] = useState<string | null>(null);
	const name = grant.client.name;
	const target = workspaces.length === 1 ? workspaces[0] : "your workspaces";
	const extra = grant.scopes.filter((s) => s !== MCP_SCOPE && s in SCOPES);
	const unknown = grant.scopes.filter((s) => s !== MCP_SCOPE && !(s in SCOPES));
	const abilities = [
		...(grant.scopes.includes(MCP_SCOPE)
			? ["Read pages", "Edit pages", "Search the workspace"]
			: []),
		...extra.map((s) => SCOPES[s].title),
	];

	const decide = async (approve: boolean) => {
		setBusy(approve ? "allow" : "deny");
		setError(null);
		try {
			const { redirectUrl } = await submitConsent({
				data: { grantId: grant.grantId, approve },
			});
			setReturning(redirectUrl);
		} catch (err) {
			setError(errorText(err));
			setBusy(null);
		}
	};

	if (returning) return <Returning url={returning} name={name} />;

	return (
		<AuthFrame title={`${name} wants to use ${target}.`}>
			<div className="flex items-center gap-3 border-y border-rule py-3">
				<Avatar id={user.id} name={user.name || user.email} size={32} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-base font-medium leading-[18px] text-ink">
						{user.name || user.email}
					</div>
					<div className="truncate text-sm leading-4 text-graphite">
						{user.email}
					</div>
				</div>
				<button
					type="button"
					className="text-sm text-link hover:underline"
					onClick={async () => {
						await submitSignOut();
						window.location.reload();
					}}
				>
					Switch
				</button>
			</div>
			<div className="flex flex-col gap-3">
				<div className="text-sm font-medium leading-4 text-ink">
					It will be able to
				</div>
				<ul className="flex flex-col gap-3">
					{abilities.map((ability) => (
						<li
							key={ability}
							className="flex items-center gap-3 text-[15px] leading-5 text-ink"
						>
							<Tick />
							{ability}
						</li>
					))}
					{unknown.map((scope) => (
						<li
							key={scope}
							className="flex items-center gap-3 font-mono text-sm leading-5 text-ink"
						>
							<Tick />
							{scope}
						</li>
					))}
				</ul>
			</div>
			<p className="text-sm leading-[19px] text-graphite">
				It acts as you and can only see what you can see. After you allow it,
				you go back to{" "}
				<span className="font-mono text-ink">{hostOf(grant.redirectUri)}</span>.
			</p>
			{problems.map((p) => (
				<FormError key={p} message={p} />
			))}
			<FormError message={error} />
			<div className="grid grid-cols-2 gap-3">
				<SubmitButton
					type="button"
					loading={busy === "allow"}
					disabled={busy !== null || problems.length > 0}
					onClick={() => decide(true)}
				>
					Allow
				</SubmitButton>
				<SubmitButton
					type="button"
					variant="secondary"
					loading={busy === "deny"}
					disabled={busy !== null}
					onClick={() => decide(false)}
				>
					Cancel
				</SubmitButton>
			</div>
		</AuthFrame>
	);
}

function Tick() {
	return (
		<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-green-soft text-green">
			<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
				<path
					d="m2.5 6.5 2.3 2.2 4.7-5"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</span>
	);
}

function NoWorkspace({
	view,
}: {
	view: Extract<ConsentView, { view: "no-workspace" }>;
}) {
	const [busy, setBusy] = useState(false);
	const [returning, setReturning] = useState<string | null>(null);
	if (returning)
		return (
			<Returning url={returning} name={view.client?.name || "the agent"} />
		);
	return (
		<AuthFrame
			title="No access."
			intro={`You're signed in as ${view.email}, but you aren't in any workspace here, so you can't connect an agent.`}
		>
			{view.grantId ? (
				<SubmitButton
					type="button"
					loading={busy}
					onClick={async () => {
						setBusy(true);
						const { redirectUrl } = await submitConsent({
							data: { grantId: view.grantId as string, approve: false },
						});
						setReturning(redirectUrl);
					}}
				>
					Tell the agent no
				</SubmitButton>
			) : null}
			<SubmitButton
				type="button"
				variant="secondary"
				onClick={async () => {
					await submitSignOut();
					window.location.reload();
				}}
			>
				Sign in as someone else
			</SubmitButton>
		</AuthFrame>
	);
}

function Returning({ url, name }: { url: string; name: string }) {
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		window.location.assign(url);
		const timer = setTimeout(() => setSlow(true), 2500);
		return () => clearTimeout(timer);
	}, [url]);
	const denied = /[?&#]error=access_denied/.test(url);
	if (denied)
		return (
			<AuthFrame
				title="Access denied."
				intro={`${name} won't get access. You can close this tab.`}
			>
				<span />
			</AuthFrame>
		);
	return (
		<AuthFrame
			title="You're connected."
			intro={`Go back to ${name} to keep working.${slow ? " You can close this tab." : ""}`}
		>
			<p className="text-sm leading-[19px] text-graphite">
				Changed your mind? Disconnect it any time in Settings.
			</p>
		</AuthFrame>
	);
}
