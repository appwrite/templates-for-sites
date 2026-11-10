import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";
import { submitInviteRequest, submitSendVerification } from "#/functions/auth";
import { submitSignUp } from "#/functions/session";
import { errorText } from "#/lib/errors";
import {
	AuthFrame,
	authFieldClass,
	Field,
	FormError,
	Note,
	SubmitButton,
} from "./frame";

const routeApi = getRouteApi("/signup");

export function SignupPage() {
	const { signup, workspaceName } = routeApi.useLoaderData();
	return signup === "open" ? (
		<SignUp workspaceName={workspaceName} />
	) : (
		<InviteOnly workspaceName={workspaceName} />
	);
}

function SignUp({ workspaceName }: { workspaceName: string }) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<AuthFrame
			title={`Join ${workspaceName}.`}
			intro="Create an account to start writing with the team."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						await submitSignUp({ data: { name, email, password } });
						// Best effort: the account works before the email is confirmed.
						await submitSendVerification().catch(() => undefined);
						window.location.assign("/");
					} catch (err) {
						setError(errorText(err));
						setBusy(false);
					}
				}}
			>
				<Field label="Name" htmlFor="signup-name">
					<input
						id="signup-name"
						className={authFieldClass}
						required
						autoComplete="name"
						maxLength={128}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</Field>
				<Field label="Email" htmlFor="signup-email">
					<input
						id="signup-email"
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
					htmlFor="signup-password"
					hint="At least 8 characters."
				>
					<input
						id="signup-password"
						className={authFieldClass}
						type="password"
						required
						minLength={8}
						autoComplete="new-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Create account</SubmitButton>
				<Note>
					Already have an account?{" "}
					<Link to="/login" className="text-link hover:underline">
						Sign in
					</Link>
				</Note>
			</form>
		</AuthFrame>
	);
}

function InviteOnly({ workspaceName }: { workspaceName: string }) {
	const [email, setEmail] = useState("");
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);

	if (sent)
		return (
			<AuthFrame
				title="Asked."
				intro={`The owner of ${workspaceName} can see your request. If they say yes, the invite goes to ${email}.`}
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
			title="Invite only."
			intro={`${workspaceName} only lets people in by invite. Ask the owner, and we'll email you when they answer.`}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						await submitInviteRequest({ data: { email, note } });
						setSent(true);
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Your email" htmlFor="invite-email">
					<input
						id="invite-email"
						className={authFieldClass}
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</Field>
				<Field
					label={
						<>
							Note to the owner{" "}
							<span className="font-normal text-pencil">(optional)</span>
						</>
					}
					htmlFor="invite-note"
				>
					<textarea
						id="invite-note"
						className="h-[72px] w-full resize-none rounded-md border border-rule-strong bg-paper px-3 py-[10px] text-[15px] leading-[22px] text-ink placeholder:text-pencil hover:border-pencil focus:border-[1.5px] focus:border-link focus:outline-none"
						maxLength={500}
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</Field>
				<FormError message={error} />
				<SubmitButton loading={busy}>Ask for an invite</SubmitButton>
				<Note>
					Already have an account?{" "}
					<Link to="/login" className="text-link hover:underline">
						Sign in
					</Link>
				</Note>
			</form>
		</AuthFrame>
	);
}
