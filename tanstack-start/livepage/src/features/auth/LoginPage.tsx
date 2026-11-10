import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	type LoginState,
	submitPassword,
	submitSecondFactor,
} from "#/functions/auth";
import { errorText } from "#/lib/errors";
import type { CodeKind } from "#/lib/two-step";
import {
	AuthFrame,
	authFieldClass,
	CodeBoxes,
	Field,
	FormError,
	SubmitButton,
} from "./frame";

type Factors = { app: boolean; recovery: boolean };
type Challenge = { id: string; expire: string; kind: CodeKind };

// Password, then a code for accounts with two-step sign-in on. Also used by the consent screen.
export function SignInForm({
	title,
	intro,
	state,
	onSignedIn,
	submitLabel = "Sign in",
}: {
	title: React.ReactNode;
	intro?: React.ReactNode;
	state: LoginState;
	onSignedIn: () => void;
	submitLabel?: string;
}) {
	const [factors, setFactors] = useState<Factors | null>(state.factors);
	const [kind, setKind] = useState<CodeKind>(
		state.factors?.app === false ? "recovery" : "totp",
	);

	if (factors) {
		return kind === "recovery" ? (
			<RecoveryStep
				canUseApp={factors.app}
				onUseApp={() => setKind("totp")}
				onSignedIn={onSignedIn}
			/>
		) : (
			<CodeStep
				workspace={state.workspaceName ?? "Livepage"}
				canUseRecovery={factors.recovery}
				onUseRecovery={() => setKind("recovery")}
				onSignedIn={onSignedIn}
			/>
		);
	}

	return (
		<PasswordStep
			title={title}
			intro={intro}
			signup={state.signup}
			submitLabel={submitLabel}
			onSignedIn={onSignedIn}
			onNeedsCode={(next) => {
				setKind(next.app ? "totp" : "recovery");
				setFactors(next);
			}}
		/>
	);
}

function PasswordStep({
	title,
	intro,
	signup,
	submitLabel,
	onSignedIn,
	onNeedsCode,
}: {
	title: React.ReactNode;
	intro?: React.ReactNode;
	signup: "invite" | "open";
	submitLabel: string;
	onSignedIn: () => void;
	onNeedsCode: (factors: Factors) => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<AuthFrame title={title} intro={intro}>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						const result = await submitPassword({ data: { email, password } });
						if (result.factors) onNeedsCode(result.factors);
						else onSignedIn();
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Email" htmlFor="login-email">
					<input
						id="login-email"
						className={authFieldClass}
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</Field>
				<Field
					label="Password"
					htmlFor="login-password"
					aside={
						<Link
							to="/reset"
							className="text-sm leading-4 text-link hover:underline coarse:py-2.5"
						>
							Forgot it?
						</Link>
					}
				>
					<input
						id="login-password"
						className={authFieldClass}
						type="password"
						required
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>{submitLabel}</SubmitButton>
				{signup === "open" ? (
					<div className="text-sm leading-4 text-graphite">
						New here?{" "}
						<Link
							to="/signup"
							className="text-link hover:underline coarse:py-2.5"
						>
							Create an account
						</Link>
					</div>
				) : null}
			</form>
		</AuthFrame>
	);
}

function CodeStep({
	workspace,
	canUseRecovery,
	onUseRecovery,
	onSignedIn,
}: {
	workspace: string;
	canUseRecovery: boolean;
	onUseRecovery: () => void;
	onSignedIn: () => void;
}) {
	const [code, setCode] = useState("");
	const [challenge, setChallenge] = useState<Challenge | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (value = code) => {
		if (busy || value.length !== 6) return;
		setBusy(true);
		setError(null);
		try {
			const result = await submitSecondFactor({
				data: { code: value, kind: "totp", challenge },
			});
			if (result.ok) {
				onSignedIn();
				return;
			}
			setError(result.message);
			setChallenge(result.challenge);
			setCode("");
		} catch (err) {
			setError(errorText(err));
			setCode("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<AuthFrame
			title="Enter your code."
			intro={`Open your authenticator app and type the six-digit code for ${workspace}.`}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<CodeBoxes
					autoFocus
					label="Code from your authenticator app"
					value={code}
					onChange={setCode}
					onComplete={submit}
					invalid={Boolean(error)}
					disabled={busy}
				/>
				<FormError message={error} />
				<SubmitButton loading={busy} disabled={code.length !== 6}>
					Continue
				</SubmitButton>
				{canUseRecovery ? (
					<button
						type="button"
						onClick={onUseRecovery}
						className="w-fit text-sm leading-4 text-link hover:underline"
					>
						Use a recovery code
					</button>
				) : null}
			</form>
		</AuthFrame>
	);
}

function RecoveryStep({
	canUseApp,
	onUseApp,
	onSignedIn,
}: {
	canUseApp: boolean;
	onUseApp: () => void;
	onSignedIn: () => void;
}) {
	const [code, setCode] = useState("");
	const [challenge, setChallenge] = useState<Challenge | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<AuthFrame
			title="Use a recovery code."
			intro="Enter one of the codes you saved when you set up two-step sign-in. Each code works once."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					if (busy) return;
					setBusy(true);
					setError(null);
					try {
						const result = await submitSecondFactor({
							data: { code, kind: "recovery", challenge },
						});
						if (result.ok) {
							onSignedIn();
							return;
						}
						setError(result.message);
						setChallenge(result.challenge);
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Recovery code" htmlFor="login-recovery">
					<input
						id="login-recovery"
						className={`${authFieldClass} font-mono !text-base`}
						// biome-ignore lint/a11y/noAutofocus: the only field on this step
						autoFocus
						required
						autoComplete="off"
						spellCheck={false}
						value={code}
						onChange={(e) => setCode(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Continue</SubmitButton>
				{canUseApp ? (
					<button
						type="button"
						onClick={onUseApp}
						className="w-fit text-sm leading-4 text-link hover:underline"
					>
						Use your authenticator app instead
					</button>
				) : null}
				<div className="text-sm leading-4 text-graphite">
					Lost your codes too? Ask your workspace owner for help.
				</div>
			</form>
		</AuthFrame>
	);
}

export function LoginPage() {
	const state = getRouteApi("/login").useLoaderData();
	return (
		<SignInForm
			title={`Back to ${state.workspaceName ?? "Livepage"}.`}
			state={state}
			onSignedIn={() => window.location.assign("/")}
		/>
	);
}
