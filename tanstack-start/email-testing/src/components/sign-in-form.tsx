import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { FormError } from "#/components/auth-frame";
import { Spinner } from "#/components/icons";
import { submitSignIn } from "#/functions/session";

// Email and password sign-in, shared by /login and the OAuth consent screen.
export function SignInForm({
	onSignedIn,
	submitLabel = "Sign in",
}: {
	onSignedIn: (result: { setupComplete: boolean }) => Promise<void> | void;
	submitLabel?: string;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

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
			await onSignedIn(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
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
				{busy ? <Spinner size={15} /> : null} {submitLabel}
			</button>
		</form>
	);
}
