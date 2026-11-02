import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthFrame, FormError } from "#/components/auth-frame";
import { Spinner } from "#/components/icons";
import {
	fetchLoginState,
	submitSignIn,
	submitSignOut,
} from "#/functions/session";

export const Route = createFileRoute("/login")({
	loader: async () => {
		const state = await fetchLoginState();
		if (state.status === "member")
			throw redirect({ to: state.setupComplete ? "/inbox" : "/setup" });
		return state;
	},
	head: () => ({ meta: [{ title: "Sign in · Catchall" }] }),
	component: LoginPage,
});

function LoginPage() {
	const state = Route.useLoaderData();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [host] = useState(() =>
		typeof window === "undefined" ? "" : window.location.host,
	);

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		setBusy(true);
		setError(null);
		try {
			const result = await submitSignIn({
				data: {
					email: String(form.get("email") || ""),
					password: String(form.get("password") || ""),
				},
			});
			await navigate({ to: result.setupComplete ? "/inbox" : "/setup" });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	if (state.status === "no-team") {
		return (
			<AuthFrame
				title="No access yet"
				intro={`You're signed in as ${state.email}, but you're not a member of this inbox. Ask an admin for an invite.`}
				host={host}
			>
				<button
					type="button"
					className="btn btn-lg w-full"
					onClick={async () => {
						await submitSignOut();
						window.location.reload();
					}}
				>
					Sign out
				</button>
			</AuthFrame>
		);
	}

	return (
		<AuthFrame
			title="Sign in"
			intro="Your team's test inbox. Ask an admin for an invite if you don't have an account yet."
			host={host}
		>
			<form className="space-y-4" onSubmit={submit}>
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
					<div className="flex items-baseline justify-between">
						<label className="label" htmlFor="password">
							Password
						</label>
						<Link to="/reset" className="link text-[13px] text-graphite">
							Forgot?
						</Link>
					</div>
					<input
						className="input"
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</div>
				<FormError>{error}</FormError>
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy}
				>
					{busy ? <Spinner size={15} /> : null} Sign in
				</button>
			</form>
		</AuthFrame>
	);
}
