// Settings, Security: two-step sign-in with an authenticator app, for the signed-in person only.

import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui";
import {
	confirmTwoStep,
	disableTwoStep,
	fetchTwoStep,
	replaceRecoveryCodes,
	startTwoStep,
} from "#/functions/auth";
import { copyText } from "#/lib/browser";
import { errorText } from "#/lib/errors";
import { qrPath } from "#/lib/qr";
import { groupSecret, otpauthLabel, recoveryCodesFile } from "#/lib/two-step";
import { authFieldClass, CodeBoxes, FormError } from "./frame";

type Setup = { linked: false; secret: string; uri: string } | { linked: true };

type Mode =
	| { name: "idle" }
	| { name: "setup"; setup: Setup }
	| { name: "codes"; codes: string[]; fresh: boolean }
	| { name: "off" }
	| { name: "new-codes" };

// The enrol flow on its own: board 86's three columns. Used by Settings and by the page people
// land on when the site requires two-step sign-in.
export function TwoStepEnroll({
	email,
	onCancel,
	onDone,
}: {
	email: string;
	onCancel?: () => void;
	onDone: () => void;
}) {
	const [setup, setSetup] = useState<Setup | null>(null);
	const [code, setCode] = useState("");
	const [codes, setCodes] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);

	// One authenticator per visit: a second request would replace the secret this page shows.
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		startTwoStep().then(
			(result) => setSetup((result ?? { linked: true }) as Setup),
			(err) => setError(errorText(err)),
		);
	}, []);

	const qr = useMemo(
		() => (setup && !setup.linked ? qrPath(setup.uri) : null),
		[setup],
	);
	const label =
		setup && !setup.linked
			? otpauthLabel(setup.uri)
			: { issuer: null, account: null };

	const confirm = async (value = code) => {
		if (busy || value.length !== 6) return;
		setBusy(true);
		setError(null);
		try {
			const result = await confirmTwoStep({ data: { code: value } });
			const list = result?.recoveryCodes ?? null;
			setCodes(list ?? []);
			if (!list) setSaved(true);
		} catch (err) {
			setError(errorText(err));
			setCode("");
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		await copyText((codes ?? []).join("\n"));
		setSaved(true);
	};

	const download = () => {
		const text = recoveryCodesFile(codes ?? [], {
			email,
			site: window.location.host,
			date: new Date(),
		});
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "livepage-recovery-codes.txt";
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		setSaved(true);
	};

	return (
		<div className="flex flex-col">
			<div className="flex items-start gap-4">
				<div className="flex grow flex-col gap-2">
					<h2 className="font-serif text-[44px] font-medium leading-[50px] tracking-[-0.02em] text-ink">
						Set up two-step sign-in.
					</h2>
					<p className="text-[15px] leading-[22px] text-graphite">
						A code from your phone, on top of your password. Takes about a
						minute.
					</p>
				</div>
				{onCancel ? (
					<button
						type="button"
						onClick={onCancel}
						className="pt-[6px] text-sm leading-4 text-graphite hover:text-ink"
					>
						Cancel
					</button>
				) : null}
			</div>
			<div className="flex flex-col gap-8 pt-8 md:flex-row">
				<div className="flex grow basis-0 flex-col gap-3 border-t border-ink pt-3">
					<StepHeading n={1} title="Scan this code" />
					{setup?.linked ? (
						<p className="text-base leading-[20px] text-graphite">
							An earlier setup linked an app but didn't finish. Enter a code
							from that app to turn two-step sign-in on.
						</p>
					) : (
						<>
							<div className="flex size-[200px] shrink-0 items-center justify-center rounded-md border border-rule-strong">
								{qr ? (
									<svg
										viewBox={`0 0 ${qr.size} ${qr.size}`}
										width={174}
										height={174}
										shapeRendering="crispEdges"
										role="img"
										aria-label="QR code for your authenticator app"
										className="rounded-sm bg-white"
									>
										<path d={qr.path} fill="#111111" />
									</svg>
								) : null}
							</div>
							<p className="text-base leading-[20px] text-graphite">
								Open your authenticator app and scan it with your phone.
							</p>
							<div className="flex flex-col gap-1">
								<div className="text-sm leading-4 text-pencil">
									Can't scan it? Enter this key:
								</div>
								<div
									className="font-mono text-sm leading-[18px] text-ink"
									data-testid="totp-secret"
								>
									{setup && !setup.linked ? groupSecret(setup.secret) : ""}
								</div>
								{label.account ? (
									<div className="text-sm leading-4 text-pencil">
										Shows as {label.issuer ?? "Appwrite"} ({label.account})
									</div>
								) : null}
							</div>
						</>
					)}
				</div>
				<div className="flex grow basis-0 flex-col gap-3 border-t border-ink pt-3">
					<StepHeading n={2} title="Confirm a code" />
					<p className="text-base leading-[20px] text-graphite">
						Type the six-digit code your app shows.
					</p>
					<CodeBoxes
						size="md"
						label="Code from your authenticator app"
						value={code}
						onChange={setCode}
						onComplete={confirm}
						invalid={Boolean(error)}
						disabled={busy || Boolean(codes)}
					/>
					<button
						type="button"
						disabled={busy || code.length !== 6 || Boolean(codes)}
						onClick={() => confirm()}
						className="flex h-[40px] shrink-0 items-center justify-center rounded-md bg-ink text-base font-medium leading-[18px] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{codes ? "Confirmed" : "Confirm"}
					</button>
					<FormError message={error} />
				</div>
				<div className="flex grow basis-0 flex-col gap-3 border-t border-ink pt-3">
					<StepHeading n={3} title="Save your recovery codes" />
					<p className="text-base leading-[20px] text-graphite">
						If you lose your phone, each code gets you in once.
					</p>
					{codes && codes.length > 0 ? (
						<>
							<div
								className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-wash p-3"
								data-testid="recovery-codes"
							>
								{codes.map((c) => (
									<div
										key={c}
										className="font-mono text-sm leading-[18px] text-ink"
									>
										{c}
									</div>
								))}
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={copy}
									className="flex h-[40px] grow basis-0 items-center justify-center rounded-md border border-rule-strong text-base font-medium leading-[18px] text-ink hover:bg-wash"
								>
									Copy
								</button>
								<button
									type="button"
									onClick={download}
									className="flex h-[40px] grow basis-0 items-center justify-center rounded-md border border-rule-strong text-base font-medium leading-[18px] text-ink hover:bg-wash"
								>
									Download
								</button>
							</div>
							<SavedCheck saved={saved} onChange={setSaved} />
							<button
								type="button"
								disabled={!saved}
								onClick={onDone}
								className="flex h-[40px] shrink-0 items-center justify-center rounded-md bg-ink text-base font-medium leading-[18px] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Done
							</button>
						</>
					) : codes ? (
						<>
							<p className="text-base leading-[20px] text-graphite">
								Your recovery codes from last time still work.
							</p>
							<button
								type="button"
								onClick={onDone}
								className="flex h-[40px] shrink-0 items-center justify-center rounded-md bg-ink text-base font-medium leading-[18px] text-paper hover:opacity-90"
							>
								Done
							</button>
						</>
					) : (
						<div className="rounded-md bg-wash p-3 text-sm leading-[18px] text-pencil">
							They appear here after you confirm a code.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// Copy and Download tick this. It stays a choice of its own for codes written down by hand.
function SavedCheck({
	saved,
	onChange,
}: {
	saved: boolean;
	onChange: (saved: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2 py-1 text-base leading-[20px] text-ink">
			<input
				type="checkbox"
				checked={saved}
				onChange={(e) => onChange(e.target.checked)}
				className="size-4 shrink-0 accent-[var(--color-link)]"
			/>
			I've saved these
		</label>
	);
}

function StepHeading({ n, title }: { n: number; title: string }) {
	return (
		<div className="flex items-baseline gap-2">
			<div className="font-mono text-sm leading-[20px] text-pencil">{n}</div>
			<div className="text-[15px] font-medium leading-[20px] text-ink">
				{title}
			</div>
		</div>
	);
}

export function TwoStepSettings() {
	const router = useRouter();
	const [status, setStatus] = useState<{
		enabled: boolean;
		email: string;
	} | null>(null);
	const [mode, setMode] = useState<Mode>({ name: "idle" });
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(
		() => fetchTwoStep().then(setStatus, (err) => setError(errorText(err))),
		[],
	);

	useEffect(() => {
		load();
	}, [load]);

	if (!status) return <FormError message={error} />;

	const finish = async () => {
		await load();
		await router.invalidate();
		setMode({ name: "idle" });
	};

	if (mode.name === "setup")
		return (
			<TwoStepEnroll
				email={status.email}
				onCancel={() => setMode({ name: "idle" })}
				onDone={finish}
			/>
		);

	if (mode.name === "codes")
		return (
			<RecoveryCodes
				codes={mode.codes}
				email={status.email}
				onDone={() => setMode({ name: "idle" })}
			/>
		);

	if (mode.name === "off" || mode.name === "new-codes")
		return (
			<ConfirmCode
				off={mode.name === "off"}
				onCancel={() => setMode({ name: "idle" })}
				onDone={async (codes) => {
					await load();
					await router.invalidate();
					if (codes) setMode({ name: "codes", codes, fresh: false });
					else setMode({ name: "idle" });
				}}
			/>
		);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-4 rounded-lg border border-rule px-4 py-3.5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[15px] font-medium text-ink">
							Two-step sign-in
						</span>
						<span
							className={`text-sm ${status.enabled ? "text-green" : "text-pencil"}`}
						>
							{status.enabled ? "On" : "Off"}
						</span>
					</div>
					<div className="mt-0.5 text-sm leading-[19px] text-graphite">
						{status.enabled
							? "Signing in asks for a code from your authenticator app after your password."
							: "Signing in only asks for your password."}
					</div>
				</div>
				{status.enabled ? (
					<Button onClick={() => setMode({ name: "off" })}>Turn off</Button>
				) : (
					<Button
						variant="primary"
						onClick={() => setMode({ name: "setup", setup: { linked: true } })}
					>
						Set up
					</Button>
				)}
			</div>
			{status.enabled ? (
				<div className="flex items-center gap-4 rounded-lg border border-rule px-4 py-3.5">
					<div className="min-w-0 flex-1">
						<div className="text-[15px] font-medium text-ink">
							Recovery codes
						</div>
						<div className="mt-0.5 text-sm leading-[19px] text-graphite">
							Single-use codes for when your phone isn't with you.
						</div>
					</div>
					<Button onClick={() => setMode({ name: "new-codes" })}>
						New codes
					</Button>
				</div>
			) : null}
			<FormError message={error} />
		</div>
	);
}

function RecoveryCodes({
	codes,
	email,
	onDone,
}: {
	codes: string[];
	email: string;
	onDone: () => void;
}) {
	const [saved, setSaved] = useState(false);
	const copy = async () => {
		await copyText(codes.join("\n"));
		setSaved(true);
	};
	const download = () => {
		const text = recoveryCodesFile(codes, {
			email,
			site: window.location.host,
			date: new Date(),
		});
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "livepage-recovery-codes.txt";
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		setSaved(true);
	};
	return (
		<div className="flex max-w-[480px] flex-col gap-3 rounded-lg border border-rule p-4">
			<div className="text-[15px] font-medium text-ink">New recovery codes</div>
			<p className="text-sm leading-[19px] text-graphite">
				Your old codes stopped working. Save these now. This is the only time
				they're shown.
			</p>
			<div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-wash p-3">
				{codes.map((c) => (
					<div key={c} className="font-mono text-sm leading-[18px] text-ink">
						{c}
					</div>
				))}
			</div>
			<div className="flex gap-2">
				<Button onClick={copy}>Copy</Button>
				<Button onClick={download}>Download</Button>
			</div>
			<SavedCheck saved={saved} onChange={setSaved} />
			<div className="flex justify-end">
				<Button variant="primary" disabled={!saved} onClick={onDone}>
					Done
				</Button>
			</div>
		</div>
	);
}

function ConfirmCode({
	off,
	onCancel,
	onDone,
}: {
	off: boolean;
	onCancel: () => void;
	onDone: (codes: string[] | null) => Promise<void>;
}) {
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			className="flex max-w-[480px] flex-col gap-3 rounded-lg border border-rule p-4"
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setError(null);
				try {
					if (off) {
						await disableTwoStep({ data: { code } });
						await onDone(null);
					} else {
						const result = await replaceRecoveryCodes({ data: { code } });
						await onDone(result?.recoveryCodes ?? null);
					}
				} catch (err) {
					setError(errorText(err));
					setCode("");
				} finally {
					setBusy(false);
				}
			}}
		>
			<div className="text-[15px] font-medium text-ink">
				{off ? "Turn off two-step sign-in" : "Create new recovery codes"}
			</div>
			<p className="text-sm leading-[19px] text-graphite">
				Enter a code from your authenticator app, or a recovery code.{" "}
				{off
					? "After this, signing in only asks for your password."
					: "Your current recovery codes stop working."}
			</p>
			<input
				className={`${authFieldClass} font-mono`}
				aria-label={
					off ? "Code to turn off two-step sign-in" : "Code to create new codes"
				}
				// biome-ignore lint/a11y/noAutofocus: opened by a button, this is the only field
				autoFocus
				autoComplete="off"
				value={code}
				onChange={(e) => setCode(e.target.value)}
			/>
			<FormError message={error} />
			<div className="flex gap-2">
				<Button
					type="submit"
					variant={off ? "danger" : "primary"}
					loading={busy}
				>
					{off ? "Turn off" : "Create new codes"}
				</Button>
				<Button onClick={onCancel}>Cancel</Button>
			</div>
		</form>
	);
}
