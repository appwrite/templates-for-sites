import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthFrame, FormError } from "#/components/auth-frame";
import { Spinner } from "#/components/icons";
import { submitNewPassword, submitResetRequest } from "#/functions/session";

type Search = { userId?: string; secret?: string };

export const Route = createFileRoute("/reset")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		userId: typeof search.userId === "string" ? search.userId : undefined,
		secret: typeof search.secret === "string" ? search.secret : undefined,
	}),
	head: () => ({ meta: [{ title: "Reset password · Catchall" }] }),
	component: ResetPage,
});

function ResetPage() {
	const { userId, secret } = Route.useSearch();
	return userId && secret ? (
		<NewPassword userId={userId} secret={secret} />
	) : (
		<RequestLink />
	);
}

function RequestLink() {
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const email = String(new FormData(e.currentTarget).get("email") || "");
		setBusy(true);
		setError(null);
		try {
			await submitResetRequest({ data: { email } });
			setSentTo(email);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (sentTo) {
		return (
			<AuthFrame
				title="Check your email"
				intro={`If ${sentTo} has an account here, a reset link is on its way. The link works for one hour.`}
			>
				<Link to="/login" className="btn btn-lg w-full">
					Back to sign in
				</Link>
			</AuthFrame>
		);
	}

	return (
		<AuthFrame
			title="Reset your password"
			intro="Enter the email you sign in with. We'll send a link to set a new password."
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
				<FormError>{error}</FormError>
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy}
				>
					{busy ? <Spinner size={15} /> : null} Send reset link
				</button>
				<Link
					to="/login"
					className="block text-center text-[14px] text-graphite hover:text-ink"
				>
					Back to sign in
				</Link>
			</form>
		</AuthFrame>
	);
}

function NewPassword({ userId, secret }: { userId: string; secret: string }) {
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const password = String(
			new FormData(e.currentTarget).get("password") || "",
		);
		setBusy(true);
		setError(null);
		try {
			await submitNewPassword({ data: { userId, secret, password } });
			setDone(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (done) {
		return (
			<AuthFrame
				title="Password updated"
				intro="Sign in with your new password."
			>
				<Link to="/login" className="btn btn-primary btn-lg w-full">
					Sign in
				</Link>
			</AuthFrame>
		);
	}

	return (
		<AuthFrame title="Set a new password" intro="Use at least 8 characters.">
			<form className="space-y-4" onSubmit={submit}>
				<div>
					<label className="label" htmlFor="password">
						New password
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
				</div>
				<FormError>{error}</FormError>
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy}
				>
					{busy ? <Spinner size={15} /> : null} Save password
				</button>
			</form>
		</AuthFrame>
	);
}
