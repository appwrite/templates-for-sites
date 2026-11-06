import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { AuthFrame, FormError } from "#/components/auth-frame";
import { CodeInput } from "#/components/code-input";
import { Icon, Spinner } from "#/components/icons";
import {
	submitSecondFactor,
	submitSignIn,
	submitSignOut,
} from "#/functions/session";
import { errorText } from "#/lib/errors";
import type { CodeKind } from "#/lib/two-step";

// Which codes the code step takes: one from the authenticator app, a recovery code, or both.
export type SecondFactors = { app: boolean; recovery: boolean };
type Challenge = { id: string; expire: string; kind: CodeKind };

// Sign-in shared by /login and the OAuth consent screen: email and password, then a code for
// accounts with two-step sign-in on. Pass `factors` when the session already waits for the code.
export function SignIn({
	title,
	intro,
	host,
	submitLabel = "Sign in",
	factors: waiting = null,
	onSignedIn,
}: {
	title: string;
	intro: ReactNode;
	host: string;
	submitLabel?: string;
	factors?: SecondFactors | null;
	onSignedIn: (result: { setupComplete: boolean }) => Promise<void> | void;
}) {
	const [factors, setFactors] = useState<SecondFactors | null>(waiting);
	const [email, setEmail] = useState<string | null>(null);

	if (factors)
		return (
			<CodeStep
				factors={factors}
				email={email}
				host={host}
				submitLabel={submitLabel}
				onSignedIn={onSignedIn}
				onRestart={() => {
					setFactors(null);
					setEmail(null);
				}}
			/>
		);
	return (
		<AuthFrame title={title} intro={intro} host={host}>
			<PasswordStep
				submitLabel={submitLabel}
				onSignedIn={onSignedIn}
				onNeedsCode={(next, who) => {
					setEmail(who);
					setFactors(next);
				}}
			/>
		</AuthFrame>
	);
}

function PasswordStep({
	submitLabel,
	onSignedIn,
	onNeedsCode,
}: {
	submitLabel: string;
	onSignedIn: (result: { setupComplete: boolean }) => Promise<void> | void;
	onNeedsCode: (factors: SecondFactors, email: string) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const email = String(form.get("email") || "");
		setBusy(true);
		setError(null);
		try {
			const result = await submitSignIn({
				data: { email, password: String(form.get("password") || "") },
			});
			if (result.factors) {
				onNeedsCode(result.factors, email.trim().toLowerCase());
				return;
			}
			await onSignedIn(result);
		} catch (err) {
			setError(errorText(err));
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

function CodeStep({
	factors,
	email,
	host,
	submitLabel,
	onSignedIn,
	onRestart,
}: {
	factors: SecondFactors;
	email: string | null;
	host: string;
	submitLabel: string;
	onSignedIn: (result: { setupComplete: boolean }) => Promise<void> | void;
	onRestart: () => void;
}) {
	const [kind, setKind] = useState<CodeKind>(
		factors.app || !factors.recovery ? "totp" : "recovery",
	);
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// A wrong code keeps the same Appwrite challenge for the next try.
	const challenge = useRef<Challenge | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const busyRef = useRef(false);

	const verify = async (code: string) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = await submitSecondFactor({
				data: { code, kind, challenge: challenge.current },
			});
			if (result.ok) {
				await onSignedIn(result);
				return;
			}
			challenge.current = result.challenge;
			setError(result.message);
			setValue("");
		} catch (err) {
			setError(errorText(err));
		}
		busyRef.current = false;
		setBusy(false);
		requestAnimationFrame(() => input.current?.focus());
	};

	const switchTo = (next: CodeKind) => {
		setKind(next);
		setValue("");
		setError(null);
		requestAnimationFrame(() => input.current?.focus());
	};

	const restart = async () => {
		await submitSignOut().catch(() => undefined);
		onRestart();
	};

	if (!factors.app && !factors.recovery) {
		return (
			<AuthFrame
				title="Can't finish signing in"
				intro="This account asks for a second step Catchall doesn't support, such as an email code. An admin can turn two-step sign-in off for it in the Appwrite Console, under Auth → Users."
				host={host}
			>
				<button type="button" className="btn btn-lg w-full" onClick={restart}>
					Sign in as someone else
				</button>
			</AuthFrame>
		);
	}

	const forWho = email ? (
		<>
			{" "}
			for <span className="text-ink">{email}</span>
		</>
	) : null;

	return (
		<AuthFrame
			title={kind === "totp" ? "Enter your code" : "Use a recovery code"}
			intro={
				kind === "totp" ? (
					<>Open your authenticator app and enter the 6-digit code{forWho}.</>
				) : (
					<>
						Enter one of the recovery codes you saved when you turned on
						two-step sign-in. Each code works once.
					</>
				)
			}
			host={host}
			top={
				<span className="mb-7 flex size-12 items-center justify-center rounded-[12px] border border-rule bg-wash text-ink">
					<Icon name={kind === "totp" ? "phone" : "key"} size={22} />
				</span>
			}
		>
			<form
				className="space-y-4"
				onSubmit={(e) => {
					e.preventDefault();
					verify(value);
				}}
			>
				<CodeInput
					id="code"
					label={kind === "totp" ? "Authenticator code" : "Recovery code"}
					kind={kind}
					value={value}
					onChange={setValue}
					onComplete={verify}
					invalid={Boolean(error)}
					disabled={busy}
					inputRef={input}
					autoFocus
				/>
				<FormError>{error}</FormError>
				<button
					className="btn btn-primary btn-lg w-full"
					type="submit"
					disabled={busy || value.length < (kind === "totp" ? 6 : 10)}
				>
					{busy ? <Spinner size={15} /> : null} {submitLabel}
				</button>
			</form>
			<div className="mt-6 space-y-3 border-t border-rule pt-5 text-[14px] text-graphite">
				{kind === "totp" && factors.recovery ? (
					<p>
						No phone with you?{" "}
						<button
							type="button"
							className="link text-ink"
							onClick={() => switchTo("recovery")}
						>
							Use a recovery code
						</button>
					</p>
				) : null}
				{kind === "recovery" && factors.app ? (
					<p>
						Have your phone?{" "}
						<button
							type="button"
							className="link text-ink"
							onClick={() => switchTo("totp")}
						>
							Use your authenticator app
						</button>
					</p>
				) : null}
				<p>
					Not you?{" "}
					<button type="button" className="link text-ink" onClick={restart}>
						Sign in as someone else
					</button>
				</p>
			</div>
		</AuthFrame>
	);
}
