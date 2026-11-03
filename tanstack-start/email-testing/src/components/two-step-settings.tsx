import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { FormError } from "#/components/auth-frame";
import { CodeInput } from "#/components/code-input";
import { CopyButton, useCopy } from "#/components/copy-button";
import { Icon, Spinner } from "#/components/icons";
import {
	confirmTwoStep,
	disableTwoStep,
	replaceRecoveryCodes,
	startTwoStep,
} from "#/functions/two-step";
import { qrPath } from "#/lib/qr";
import {
	errorText,
	groupSecret,
	otpauthLabel,
	recoveryCodesFile,
} from "#/lib/two-step";

type Setup = { linked: false; secret: string; uri: string } | { linked: true };
type Mode =
	| { name: "idle" }
	| { name: "setup"; setup: Setup }
	| { name: "codes"; codes: string[]; fresh: boolean }
	| { name: "off" }
	| { name: "new-codes" };

const message = errorText;

// Settings → Security: two-step sign-in with an authenticator app, for the signed-in person only.
export function TwoStepSettings({
	enabled,
	email,
}: {
	enabled: boolean;
	email: string;
}) {
	const router = useRouter();
	const [mode, setMode] = useState<Mode>({ name: "idle" });
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Turned on, but older recovery codes couldn't be replaced in the same step. They still work.
	const [keptOldCodes, setKeptOldCodes] = useState(false);

	const idle = () => {
		setError(null);
		setMode({ name: "idle" });
	};

	if (mode.name === "setup")
		return (
			<SetupPanel
				setup={mode.setup}
				email={email}
				onCancel={idle}
				onDone={async (codes) => {
					await router.invalidate();
					if (codes) setMode({ name: "codes", codes, fresh: true });
					else {
						setKeptOldCodes(true);
						idle();
					}
				}}
			/>
		);
	if (mode.name === "codes")
		return (
			<RecoveryCodes
				codes={mode.codes}
				fresh={mode.fresh}
				email={email}
				onDone={idle}
			/>
		);
	if (mode.name === "off" || mode.name === "new-codes")
		return (
			<ConfirmWithCode
				action={mode.name}
				onCancel={idle}
				onDone={async (codes) => {
					await router.invalidate();
					setKeptOldCodes(false);
					if (codes) setMode({ name: "codes", codes, fresh: false });
					else idle();
				}}
			/>
		);

	return (
		<div className="space-y-3">
			<div className="card">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<span
						className={`flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash ${enabled ? "text-signal" : "text-graphite"}`}
					>
						<Icon name={enabled ? "shieldCheck" : "shield"} size={17} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
							<span className="font-medium">Two-step sign-in</span>
							{enabled ? (
								<span className="flex items-center gap-1.5 text-[13px] text-signal">
									<span className="live-dot" /> On
								</span>
							) : (
								<span className="text-[13px] text-pencil">Off</span>
							)}
						</span>
						<span className="mt-0.5 block text-[13px] leading-[19px] text-graphite">
							{enabled
								? "Signing in asks for a code from your authenticator app after your password."
								: "Signing in only asks for your password."}
						</span>
					</span>
					{enabled ? (
						<button
							type="button"
							className="btn btn-sm shrink-0"
							onClick={() => setMode({ name: "off" })}
						>
							Turn off
						</button>
					) : (
						<button
							type="button"
							className="btn btn-sm btn-primary shrink-0"
							disabled={starting}
							onClick={async () => {
								setStarting(true);
								setError(null);
								try {
									setMode({ name: "setup", setup: await startTwoStep() });
								} catch (err) {
									setError(message(err));
								} finally {
									setStarting(false);
								}
							}}
						>
							{starting ? <Spinner size={13} /> : null} Set up
						</button>
					)}
				</div>
				{enabled ? (
					<div className="flex items-center gap-3 border-t border-rule px-4 py-3.5">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-graphite">
							<Icon name="key" size={17} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block font-medium">Recovery codes</span>
							<span className="mt-0.5 block text-[13px] leading-[19px] text-graphite">
								Single-use codes for when your phone isn't with you.
							</span>
						</span>
						<button
							type="button"
							className="btn btn-sm shrink-0"
							onClick={() => setMode({ name: "new-codes" })}
						>
							New codes
						</button>
					</div>
				) : null}
			</div>
			{keptOldCodes && enabled ? (
				<Note>
					Two-step sign-in is on. Your recovery codes from last time still work.
					Select New codes if you no longer have them.
				</Note>
			) : null}
			<FormError>{error}</FormError>
		</div>
	);
}

function Note({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-[10px] border border-rule bg-wash px-4 py-3 text-[13px] leading-[20px] text-graphite">
			{children}
		</p>
	);
}

function StepNumber({ n }: { n: number }) {
	return (
		<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-button text-[12px] font-semibold text-button-ink">
			{n}
		</span>
	);
}

function SetupPanel({
	setup,
	email,
	onCancel,
	onDone,
}: {
	setup: Setup;
	email: string;
	onCancel: () => void;
	onDone: (codes: string[] | null) => Promise<void>;
}) {
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (value = code) => {
		if (busy || value.length !== 6) return;
		setBusy(true);
		setError(null);
		try {
			const { recoveryCodes } = await confirmTwoStep({ data: { code: value } });
			await onDone(recoveryCodes);
		} catch (err) {
			setError(message(err));
			setCode("");
			setBusy(false);
		}
	};

	return (
		<div className="card overflow-hidden">
			<div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
				<span className="font-medium">Set up two-step sign-in</span>
				<button
					type="button"
					className="btn btn-sm btn-ghost -mr-2"
					onClick={onCancel}
					disabled={busy}
				>
					Cancel
				</button>
			</div>
			{setup.linked ? (
				<div className="flex gap-3.5 border-b border-rule px-4 py-5">
					<StepNumber n={1} />
					<div className="text-[14px] leading-[21px] text-graphite">
						<div className="font-medium text-ink">
							Your authenticator app is already linked
						</div>
						An earlier setup linked an app but didn't finish. Enter a code from
						that app to turn two-step sign-in on. If you lost it, an admin can
						remove it in the Appwrite Console under Auth → Users.
					</div>
				</div>
			) : (
				<ScanStep secret={setup.secret} uri={setup.uri} email={email} />
			)}
			<form
				className="flex gap-3.5 px-4 py-5"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<StepNumber n={2} />
				<div className="min-w-0 flex-1">
					<label
						htmlFor="two-step-code"
						className="block text-[14px] font-medium"
					>
						Enter the 6-digit code from the app
					</label>
					<p className="mt-0.5 text-[13px] leading-[19px] text-graphite">
						This checks the app is set up right before sign-in starts asking for
						it.
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<div className="w-full sm:w-[176px]">
							<CodeInput
								id="two-step-code"
								label="Code from your authenticator app"
								kind="totp"
								size="md"
								value={code}
								onChange={setCode}
								onComplete={submit}
								invalid={Boolean(error)}
								disabled={busy}
							/>
						</div>
						<button
							type="submit"
							className="btn btn-primary h-10 w-full sm:w-auto"
							disabled={busy || code.length !== 6}
						>
							{busy ? <Spinner size={14} /> : null} Turn on
						</button>
					</div>
					{error ? (
						<div className="mt-3">
							<FormError>{error}</FormError>
						</div>
					) : null}
				</div>
			</form>
		</div>
	);
}

function ScanStep({
	secret,
	uri,
	email,
}: {
	secret: string;
	uri: string;
	email: string;
}) {
	const qr = useMemo(() => qrPath(uri), [uri]);
	const { issuer, account } = otpauthLabel(uri);
	return (
		<div className="flex gap-3.5 border-b border-rule px-4 py-5">
			<StepNumber n={1} />
			<div className="min-w-0 flex-1">
				<div className="text-[14px] font-medium">
					Scan this with your authenticator app
				</div>
				<p className="mt-0.5 text-[13px] leading-[19px] text-graphite">
					1Password, Google Authenticator, Authy or any app with 6-digit codes.
				</p>
				<div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
					{/* Always dark on white, so phone cameras read it in dark mode too. */}
					<div className="w-fit shrink-0 rounded-[10px] border border-rule bg-white p-2.5">
						<svg
							viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
							width={156}
							height={156}
							shapeRendering="crispEdges"
							role="img"
							aria-label="QR code for your authenticator app"
						>
							<path d={qr.path} fill="#0e0e0e" />
						</svg>
					</div>
					<div className="min-w-0 flex-1 text-[13px] leading-[19px] text-graphite">
						<div>Can't scan it? Enter this key instead:</div>
						<div className="mt-2 flex items-start gap-2 rounded-[8px] border border-rule bg-wash px-3 py-2.5">
							<span className="mono min-w-0 flex-1 break-words text-[14px] leading-[22px] text-ink">
								{groupSecret(secret)}
							</span>
							<CopyButton value={secret} className="mt-0.5 shrink-0" />
						</div>
						<div className="mt-3">
							It shows up as{" "}
							<span className="font-medium text-ink">
								{issuer ?? "Appwrite"}
							</span>{" "}
							<span className="text-ink">({account ?? email})</span>. That's the
							name of this inbox's Appwrite project.
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function RecoveryCodes({
	codes,
	fresh,
	email,
	onDone,
}: {
	codes: string[];
	fresh: boolean;
	email: string;
	onDone: () => void;
}) {
	const { copied, copy } = useCopy();
	const [saved, setSaved] = useState(false);
	const download = () => {
		const text = recoveryCodesFile(codes, {
			email,
			site: window.location.host,
			date: new Date(),
		});
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "catchall-recovery-codes.txt";
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		setSaved(true);
	};
	return (
		<div className="card overflow-hidden">
			<div className="flex items-start gap-3 border-b border-rule px-4 py-3.5">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-signal">
					<Icon name={fresh ? "shieldCheck" : "key"} size={17} />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-medium">
						{fresh ? "Two-step sign-in is on" : "New recovery codes"}
					</span>
					<span className="mt-0.5 block text-[13px] leading-[19px] text-graphite">
						{fresh
							? "Save these recovery codes now. This is the only time they're shown."
							: "Your old codes stopped working. Save these now. This is the only time they're shown."}
					</span>
				</span>
			</div>
			<div className="px-4 py-4">
				<ol className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-[8px] border border-rule bg-wash px-4 py-4 sm:grid-cols-3">
					{codes.map((c, i) => (
						<li key={c} className="flex items-baseline gap-2.5">
							<span className="w-3 text-right text-[11px] tabular-nums text-pencil">
								{i + 1}
							</span>
							<span className="mono text-[15px] tracking-[0.04em] text-ink">
								{c}
							</span>
						</li>
					))}
				</ol>
				<p className="mt-3 text-[13px] leading-[19px] text-graphite">
					Each code works once, in place of a code from your app. Keep them
					somewhere safe that isn't your phone, like a password manager.
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => {
							copy(codes.join("\n"), "codes");
							setSaved(true);
						}}
					>
						<Icon name={copied === "codes" ? "check" : "copy"} size={14} />
						{copied === "codes" ? "Copied" : "Copy"}
					</button>
					<button type="button" className="btn btn-sm" onClick={download}>
						<Icon name="download" size={14} /> Download
					</button>
					<button
						type="button"
						className={`btn btn-sm ml-auto ${saved ? "btn-primary" : ""}`}
						onClick={onDone}
					>
						{saved ? "Done" : "I've saved them"}
					</button>
				</div>
			</div>
		</div>
	);
}

function ConfirmWithCode({
	action,
	onCancel,
	onDone,
}: {
	action: "off" | "new-codes";
	onCancel: () => void;
	onDone: (codes: string[] | null) => Promise<void>;
}) {
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const off = action === "off";

	return (
		<form
			className="card px-4 py-4"
			onSubmit={async (e) => {
				e.preventDefault();
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					if (off) {
						await disableTwoStep({ data: { code } });
						await onDone(null);
					} else {
						const { recoveryCodes } = await replaceRecoveryCodes({
							data: { code },
						});
						await onDone(recoveryCodes);
					}
				} catch (err) {
					setError(message(err));
					setCode("");
					setBusy(false);
				}
			}}
		>
			<label htmlFor="confirm-code" className="block font-medium">
				{off ? "Turn off two-step sign-in" : "Create new recovery codes"}
			</label>
			<p className="mt-0.5 text-[13px] leading-[19px] text-graphite">
				{off
					? "Enter a code from your authenticator app, or a recovery code. After this, signing in only asks for your password."
					: "Enter a code from your authenticator app, or a recovery code. Your current recovery codes stop working."}
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<div className="w-full sm:w-[176px]">
					<CodeInput
						id="confirm-code"
						label={
							off
								? "Code to turn off two-step sign-in"
								: "Code to create new recovery codes"
						}
						kind="any"
						size="md"
						value={code}
						onChange={setCode}
						invalid={Boolean(error)}
						disabled={busy}
						autoFocus
					/>
				</div>
				<button
					type="submit"
					className={`btn h-10 flex-1 sm:flex-none ${off ? "btn-danger" : "btn-primary"}`}
					disabled={busy || (code.length !== 6 && code.length !== 10)}
				>
					{busy ? <Spinner size={14} /> : null}{" "}
					{off ? "Turn off" : "Create new codes"}
				</button>
				<button
					type="button"
					className="btn btn-ghost h-10"
					onClick={onCancel}
					disabled={busy}
				>
					Cancel
				</button>
			</div>
			{error ? (
				<div className="mt-3">
					<FormError>{error}</FormError>
				</div>
			) : null}
		</form>
	);
}
