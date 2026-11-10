import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { submitNewPassword, submitResetRequest } from "#/functions/auth";
import { errorText } from "#/lib/errors";
import {
	AuthFrame,
	authFieldClass,
	Field,
	FormError,
	SubmitButton,
} from "./frame";

export function ResetPage() {
	const { userId, secret } = useSearch({ strict: false }) as {
		userId?: string;
		secret?: string;
	};
	return userId && secret ? (
		<NewPassword userId={userId} secret={secret} />
	) : (
		<RequestLink />
	);
}

function RequestLink() {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	if (sent)
		return (
			<AuthFrame
				title="Check your email."
				intro={`If ${email} has an account here, a link to set a new password is on its way.`}
			>
				<Link
					to="/login"
					className="text-sm leading-4 text-link hover:underline"
				>
					Back to sign in
				</Link>
			</AuthFrame>
		);
	return (
		<AuthFrame
			title="Forgot it?"
			intro="Enter your email and we'll send a link to set a new password."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						await submitResetRequest({ data: { email } });
						setSent(true);
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Email" htmlFor="reset-email">
					<input
						id="reset-email"
						className={authFieldClass}
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Send link</SubmitButton>
				<Link
					to="/login"
					className="text-sm leading-4 text-link hover:underline"
				>
					Back to sign in
				</Link>
			</form>
		</AuthFrame>
	);
}

function NewPassword({ userId, secret }: { userId: string; secret: string }) {
	const router = useRouter();
	const [email] = useState("");
	const [password, setPassword] = useState("");
	const [repeat, setRepeat] = useState("");
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	if (done)
		return (
			<AuthFrame
				title="Password updated."
				intro="Sign in with your new password."
			>
				<SubmitButton
					type="button"
					onClick={() => router.navigate({ to: "/login" })}
				>
					Sign in
				</SubmitButton>
			</AuthFrame>
		);

	return (
		<AuthFrame
			title="Set a new password."
			intro={email ? `For ${email}.` : undefined}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					if (password !== repeat) {
						setError("Those two passwords don't match.");
						return;
					}
					setBusy(true);
					setError(null);
					try {
						await submitNewPassword({ data: { userId, secret, password } });
						setDone(true);
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field
					label="New password"
					htmlFor="reset-password"
					hint="At least 8 characters."
				>
					<input
						id="reset-password"
						className={authFieldClass}
						type="password"
						required
						minLength={8}
						autoComplete="new-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
				<Field label="Repeat password" htmlFor="reset-repeat">
					<input
						id="reset-repeat"
						className={authFieldClass}
						type="password"
						required
						minLength={8}
						autoComplete="new-password"
						value={repeat}
						onChange={(e) => setRepeat(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Save password</SubmitButton>
			</form>
		</AuthFrame>
	);
}
