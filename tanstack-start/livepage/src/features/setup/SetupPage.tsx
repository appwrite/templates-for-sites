import { getRouteApi } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
	fetchSetupView,
	runSetupStep,
	submitClaim,
	submitContinueAi,
	submitFeatures,
	submitFinish,
	submitSchemaUpdate,
	submitSkipAi,
	submitSkipVectors,
	submitStage,
	submitVerifyAi,
	submitWorkspace,
} from "#/functions/setup";
import { randomId } from "#/lib/browser";
import { errorText } from "#/lib/errors";
import type {
	AiState,
	Capabilities,
	FeatureChoice,
	SetupStep,
	SetupStepId,
	SetupView,
	Stage,
	VectorSpec,
} from "#/lib/setup-types";
import {
	AccountPreview,
	AiPreview,
	BuildPreview,
	DonePreview,
	FieldLabel,
	FormError,
	fieldClass,
	Logo,
	MapPreview,
	PrimaryButton,
	ScopesCard,
	SetupFrame,
	type StageName,
	TextButton,
	WorkspacePreview,
} from "./setup-ui";

const routeApi = getRouteApi("/setup");

const STAGE_OF: Record<StageName, Stage | null> = {
	Account: null,
	Workspace: "workspace",
	AI: "ai",
	Features: "features",
	Build: "build",
};

export function SetupPage() {
	const initial = routeApi.useLoaderData();
	const [view, setView] = useState<SetupView>(initial);
	// Choices on the features step, kept while someone goes back through the stepper.
	const featureDraft = useRef<FeatureChoice | null>(null);
	const [stageError, setStageError] = useState<string | null>(null);

	const go = async (stage: StageName) => {
		const next = STAGE_OF[stage];
		if (!next) return;
		setStageError(null);
		try {
			setView(await submitStage({ data: { stage: next } }));
		} catch (err) {
			setStageError(errorText(err));
		}
	};

	switch (view.view) {
		case "no-key":
			return (
				<Message
					heading="This site can't reach Appwrite."
					body="It has no Appwrite key. Deploy it on Appwrite Sites, then come back to /setup."
				/>
			);
		case "update":
			return <SchemaUpdate view={view} onView={setView} />;
		case "locked":
			return <Locked signedIn={view.signedIn} />;
		case "in-progress":
			return <InProgress signedIn={view.signedIn} email={view.email} />;
		case "missing-scopes":
			return <MissingScopes view={view} onChecked={setView} />;
		case "claim":
			return <Claim onDone={setView} />;
		case "workspace":
			return <WorkspaceStep view={view} onDone={setView} />;
		case "ai":
			return (
				<AiStep
					view={view}
					onDone={setView}
					onGo={go}
					stageError={stageError}
				/>
			);
		case "features":
			return (
				<FeaturesStep
					view={view}
					onDone={setView}
					onGo={go}
					draft={featureDraft}
					stageError={stageError}
				/>
			);
		case "build":
			return <BuildStep view={view} onView={setView} />;
		case "done":
			return <DoneStep view={view} />;
	}
}

function Message({ heading, body }: { heading: string; body: string }) {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-paper px-6">
			<div className="w-full max-w-[460px]">
				<Logo />
				<h1 className="pt-16 font-serif text-[44px] font-medium leading-[50px] tracking-[-0.02em] text-ink">
					{heading}
				</h1>
				<p className="pt-3 text-md leading-[25px] text-graphite">{body}</p>
			</div>
		</main>
	);
}

function Locked({ signedIn }: { signedIn: boolean }) {
	useEffect(() => {
		window.location.assign(signedIn ? "/" : "/login");
	}, [signedIn]);
	return null;
}

// A newer version of the code needs tables, columns or indexes this deployment doesn't have yet.
function SchemaUpdate({
	view,
	onView,
}: {
	view: Extract<SetupView, { view: "update" }>;
	onView: (next: SetupView) => void;
}) {
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { work } = view;
	const items = [
		...work.tables.map((t) => `New table: ${t}`),
		...work.columns.map((c) => `New column: ${c}`),
		...work.indexes.map((i) => `New index: ${i}`),
	];

	const apply = async () => {
		setRunning(true);
		setError(null);
		try {
			// Columns build in the background on Appwrite, so this polls until they're ready.
			for (;;) {
				const next = await submitSchemaUpdate();
				if (next.view !== "update") {
					onView(next);
					return;
				}
				onView(next);
				await new Promise((resolve) => setTimeout(resolve, 2_000));
			}
		} catch (err) {
			setError(errorText(err));
			setRunning(false);
		}
	};

	return (
		<SetupFrame
			heading="This version needs a database update."
			body="It only adds what's missing. Your pages and data aren't touched, and the extra permissions are removed when it's done."
			top={112}
			preview={<ScopesCard scopes={items.slice(0, 8)} />}
		>
			<div className="flex max-w-[496px] flex-col gap-4 pt-6">
				{items.length > 0 && (
					<ul className="font-mono text-sm leading-6 text-graphite">
						{items.slice(0, 12).map((item) => (
							<li key={item}>{item}</li>
						))}
						{items.length > 12 && <li>and {items.length - 12} more</li>}
					</ul>
				)}
				{work.building > 0 && (
					<p className="text-sm text-graphite">
						Appwrite is building {work.building}{" "}
						{work.building === 1 ? "column" : "columns"}.
					</p>
				)}
				{error && <p className="text-sm text-coral">{error}</p>}
				<div>
					<PrimaryButton loading={running} onClick={() => void apply()}>
						{running ? "Updating" : "Update the database"}
					</PrimaryButton>
				</div>
			</div>
		</SetupFrame>
	);
}

function InProgress({
	signedIn,
	email,
}: {
	signedIn: boolean;
	email: string | null;
}) {
	return (
		<main className="flex min-h-dvh items-center justify-center bg-paper px-6">
			<div className="w-full max-w-[460px]">
				<Logo />
				<h1 className="pt-16 font-serif text-[44px] font-medium leading-[50px] tracking-[-0.02em] text-ink">
					Someone is setting this up.
				</h1>
				<p className="pt-3 text-md leading-[25px] text-graphite">
					{signedIn
						? `You're signed in as ${email}, but another person claimed this Livepage first. Ask them to invite you when it's ready.`
						: "Another person is finishing setup. When they're done they can invite you. If this is you, sign in to carry on."}
				</p>
				<div className="flex items-center gap-4 pt-6">
					<a
						href={signedIn ? "/" : "/login"}
						className="flex h-[40px] items-center rounded-md bg-ink px-[18px] text-base font-medium leading-[18px] text-paper hover:opacity-90"
					>
						{signedIn ? "Go to Livepage" : "Sign in"}
					</a>
				</div>
			</div>
		</main>
	);
}

// ---------- 00 missing permissions ----------

function MissingScopes({
	view,
	onChecked,
}: {
	view: Extract<SetupView, { view: "missing-scopes" }>;
	onChecked: (next: SetupView) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<SetupFrame
			heading="This site needs a few more permissions."
			body="Add them in the Appwrite Console. You don't need to redeploy, and setup removes the temporary ones when it finishes."
			top={112}
			preview={<ScopesCard scopes={view.missing} />}
		>
			<div className="flex max-w-[496px] flex-col pt-6">
				{view.groups.map((group) => (
					<div
						key={group.product}
						className="flex min-h-[40px] items-center border-b border-rule py-2"
					>
						<div className="w-[120px] shrink-0 text-base font-medium leading-[18px] text-ink">
							{group.product}
						</div>
						<div className="font-mono text-sm leading-[18px] text-graphite">
							{group.scopes.join(", ")}
						</div>
					</div>
				))}
			</div>
			<p className="max-w-[496px] pt-4 text-sm leading-[20px] text-graphite">
				Go to Sites, open this site, then Settings, Build, Scopes.
			</p>
			{error ? (
				<div className="pt-3">
					<FormError message={error} />
				</div>
			) : null}
			<div className="flex items-center gap-4 pt-[20px]">
				<PrimaryButton
					loading={busy}
					onClick={async () => {
						setBusy(true);
						setError(null);
						try {
							onChecked(await fetchSetupView());
						} catch (err) {
							setError(errorText(err));
						} finally {
							setBusy(false);
						}
					}}
				>
					Check again
				</PrimaryButton>
				{view.consoleUrl ? (
					<a
						href={view.consoleUrl}
						target="_blank"
						rel="noreferrer"
						className="text-base leading-[18px] text-link hover:underline"
					>
						Open Console ↗
					</a>
				) : null}
			</div>
		</SetupFrame>
	);
}

// ---------- 01 your account ----------

function Claim({ onDone }: { onDone: (view: SetupView) => void }) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<SetupFrame
			stage="Account"
			heading="Start with you."
			body="You'll own this Livepage and can invite everyone else once it's built. There's nothing to configure in Appwrite."
			preview={<AccountPreview name={name} />}
		>
			<form
				className="flex max-w-[440px] flex-col gap-4 pt-8"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						onDone(await submitClaim({ data: { name, email, password } }));
					} catch (err) {
						setError(errorText(err));
						setBusy(false);
					}
				}}
			>
				<div className="flex flex-col gap-[6px]">
					<FieldLabel htmlFor="setup-name">Your name</FieldLabel>
					<input
						id="setup-name"
						className={fieldClass}
						autoComplete="name"
						required
						maxLength={128}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-[6px]">
					<FieldLabel htmlFor="setup-email">Work email</FieldLabel>
					<input
						id="setup-email"
						className={fieldClass}
						type="email"
						autoComplete="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-[6px]">
					<FieldLabel htmlFor="setup-password">Password</FieldLabel>
					<input
						id="setup-password"
						className={fieldClass}
						type="password"
						autoComplete="new-password"
						required
						minLength={12}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
					<p className="text-sm leading-4 text-pencil">
						At least 12 characters.
					</p>
				</div>
				<FormError message={error} />
				<div className="flex pt-2">
					<PrimaryButton type="submit" loading={busy}>
						Continue
					</PrimaryButton>
				</div>
			</form>
		</SetupFrame>
	);
}

// ---------- 02 first workspace ----------

function Radio({
	selected,
	onSelect,
	title,
	body,
	name,
	value,
}: {
	selected: boolean;
	onSelect: () => void;
	title: string;
	body: string;
	name: string;
	value: string;
}) {
	return (
		<label
			className={`flex cursor-pointer gap-3 rounded-md p-3 ${
				selected
					? "border-[1.5px] border-link bg-link-soft"
					: "border border-rule-strong"
			}`}
		>
			<input
				type="radio"
				className="sr-only"
				name={name}
				value={value}
				checked={selected}
				onChange={onSelect}
			/>
			<span
				className={`mt-px size-4 shrink-0 rounded-[8px] ${
					selected
						? "border-[5px] border-link bg-paper"
						: "border-[1.5px] border-rule-strong"
				}`}
			/>
			<span className="flex flex-col gap-[2px]">
				<span className="text-base font-medium leading-[18px] text-ink">
					{title}
				</span>
				<span className="text-sm leading-[19px] text-graphite">{body}</span>
			</span>
		</label>
	);
}

function WorkspaceStep({
	view,
	onDone,
}: {
	view: Extract<SetupView, { view: "workspace" }>;
	onDone: (view: SetupView) => void;
}) {
	const [name, setName] = useState(view.name);
	const [signup, setSignup] = useState(view.signup);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<SetupFrame
			stage="Workspace"
			heading="Name your team's place."
			body="Each workspace keeps its own pages, databases and members. You can add more later."
			preview={<WorkspacePreview name={name} />}
		>
			<form
				className="flex max-w-[440px] flex-col gap-[20px] pt-8"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						onDone(await submitWorkspace({ data: { name, signup } }));
					} catch (err) {
						setError(errorText(err));
						setBusy(false);
					}
				}}
			>
				<div className="flex flex-col gap-[6px]">
					<FieldLabel htmlFor="setup-workspace">Workspace name</FieldLabel>
					<input
						id="setup-workspace"
						className={fieldClass}
						required
						maxLength={128}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<div className="text-sm font-medium leading-4 text-ink">
						Who can start a new workspace here?
					</div>
					<Radio
						name="signup"
						value="invite"
						selected={signup === "invite"}
						onSelect={() => setSignup("invite")}
						title="Only people you invite"
						body="Good for one company running its own Livepage."
					/>
					<Radio
						name="signup"
						value="open"
						selected={signup === "open"}
						onSelect={() => setSignup("open")}
						title="Anyone who signs up"
						body="Each sign-up gets a private workspace of their own."
					/>
				</div>
				<FormError message={error} />
				<div className="flex items-center gap-4 pt-1">
					<PrimaryButton type="submit" loading={busy}>
						Continue
					</PrimaryButton>
				</div>
			</form>
		</SetupFrame>
	);
}

// ---------- 03 AI key ----------

function Support({ ok, label }: { ok: boolean; label: string }) {
	return (
		<span
			className={`flex items-center gap-1.5 text-sm leading-4 ${ok ? "text-green" : "text-pencil"}`}
		>
			<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
				{ok ? (
					<path
						d="m2.5 6.5 2.3 2.2 4.7-5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				) : (
					<path
						d="m3 3 6 6M9 3l-6 6"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				)}
			</svg>
			{label}
		</span>
	);
}

function AiStep({
	view,
	onDone,
	onGo,
	stageError,
}: {
	view: Extract<SetupView, { view: "ai" }>;
	onDone: (view: SetupView) => void;
	onGo: (stage: StageName) => void;
	stageError: string | null;
}) {
	const verified: AiState | null = view.ai;
	const [editing, setEditing] = useState(!verified);
	const [key, setKey] = useState("");
	const [endpoint, setEndpoint] = useState(verified?.endpoint ?? "");
	const [textModel, setTextModel] = useState(verified?.textModel ?? "");
	const [imageModel, setImageModel] = useState(verified?.imageModel ?? "");
	const [embeddingModel, setEmbeddingModel] = useState(
		verified?.embeddingModel ?? "",
	);
	const [advanced, setAdvanced] = useState(false);
	const [rejected, setRejected] = useState<{
		message: string;
		kind: string;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [skipping, setSkipping] = useState(false);

	const check = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setRejected(null);
		setError(null);
		try {
			const result = await submitVerifyAi({
				data: {
					key,
					endpoint: endpoint.trim() || view.defaultEndpoint,
					textModel,
					imageModel,
					embeddingModel,
				},
			});
			if (result.ok) {
				setEditing(false);
				setBusy(false);
				onDone(result.view);
			} else {
				setRejected(result);
				setBusy(false);
			}
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	const isDefault =
		!endpoint.trim() || endpoint.trim() === view.defaultEndpoint;
	const label = isDefault ? "OpenAI API key" : "API key";

	const showVerified = verified && !editing;

	return (
		<SetupFrame
			stage="AI"
			onGo={onGo}
			heading="Add a teammate who reads everything."
			body="AI writes alongside your team and answers from your own pages, using your own AI account."
			preview={<AiPreview />}
		>
			{showVerified ? (
				<div className="flex max-w-[440px] flex-col gap-[6px] pt-8">
					<div className="text-sm font-medium leading-4 text-ink">
						{verified.defaultEndpoint ? "OpenAI API key" : "API key"}
					</div>
					{stageError ? <FormError message={stageError} /> : null}
					<div className="flex h-[40px] items-center gap-2 rounded-md border-[1.5px] border-green px-3">
						<div className="grow font-mono text-base leading-[18px] text-graphite">
							{verified.masked}
						</div>
						<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
							<circle cx="8" cy="8" r="7" fill="var(--color-green)" />
							<path
								d="m4.8 8.2 2.2 2.2 4.2-4.6"
								fill="none"
								stroke="#fff"
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</div>
					<div className="text-sm font-medium leading-4 text-green">
						Key works. Your account can use the models Livepage needs.
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
						<Support ok={verified.supports.text} label="Writing" />
						<Support ok={verified.supports.images} label="Images" />
						<Support
							ok={verified.supports.embeddings}
							label="Search by meaning"
						/>
					</div>
					{verified.notes.map((note) => (
						<p key={note} className="text-sm leading-[19px] text-pencil">
							{note}
						</p>
					))}
					<p className="max-w-[440px] pt-2 text-sm leading-[20px] text-graphite">
						Saved as a secret in this project. Only this site can read it, so it
						never reaches a browser.
					</p>
					<div className="flex items-center gap-4 pt-4">
						<PrimaryButton
							loading={busy}
							onClick={async () => {
								setBusy(true);
								try {
									onDone(await submitContinueAi());
								} catch (err) {
									setError(errorText(err));
									setBusy(false);
								}
							}}
						>
							Continue
						</PrimaryButton>
						<TextButton onClick={() => setEditing(true)}>
							Use a different key
						</TextButton>
					</div>
					<FormError message={error} />
				</div>
			) : (
				<form
					className="flex max-w-[440px] flex-col gap-[6px] pt-8"
					onSubmit={check}
				>
					<FieldLabel htmlFor="setup-key">{label}</FieldLabel>
					<input
						id="setup-key"
						className={`${fieldClass} font-mono !text-base ${
							rejected ? "!border-[1.5px] !border-coral" : ""
						}`}
						type="password"
						autoComplete="off"
						spellCheck={false}
						required
						value={key}
						onChange={(e) => {
							setKey(e.target.value);
							setRejected(null);
						}}
					/>
					{rejected ? <FormError message={rejected.message} /> : null}
					<FormError message={error} />
					{advanced ? (
						<div className="flex flex-col gap-3 pt-3">
							<div className="flex flex-col gap-[6px]">
								<FieldLabel htmlFor="setup-endpoint">Endpoint URL</FieldLabel>
								<input
									id="setup-endpoint"
									className={`${fieldClass} font-mono !text-base`}
									placeholder={view.defaultEndpoint}
									spellCheck={false}
									value={endpoint}
									onChange={(e) => setEndpoint(e.target.value)}
								/>
							</div>
							{(
								[
									["setup-text", "Text model", textModel, setTextModel],
									["setup-image", "Image model", imageModel, setImageModel],
									[
										"setup-embed",
										"Embedding model",
										embeddingModel,
										setEmbeddingModel,
									],
								] as const
							).map(([id, name, value, set]) => (
								<div key={id} className="flex flex-col gap-[6px]">
									<FieldLabel htmlFor={id}>{name}</FieldLabel>
									<input
										id={id}
										className={`${fieldClass} font-mono !text-base`}
										placeholder="Detected from the provider"
										spellCheck={false}
										value={value}
										onChange={(e) => set(e.target.value)}
									/>
								</div>
							))}
						</div>
					) : (
						<div className="pt-1">
							<button
								type="button"
								onClick={() => setAdvanced(true)}
								className="text-sm leading-4 text-link hover:underline coarse:py-2.5"
							>
								Advanced
							</button>
						</div>
					)}
					<p className="max-w-[440px] pt-3 text-sm leading-[20px] text-graphite">
						Saved as a secret in this project. Only this site can read it, so it
						never reaches a browser.
					</p>
					<div className="flex items-center gap-4 pt-3">
						<PrimaryButton type="submit" loading={busy}>
							{rejected ? "Try again" : "Check key"}
						</PrimaryButton>
						{verified ? (
							<TextButton onClick={() => setEditing(false)}>
								Keep the current key
							</TextButton>
						) : null}
						<TextButton
							onClick={async () => {
								if (skipping) return;
								setSkipping(true);
								try {
									onDone(await submitSkipAi());
								} catch (err) {
									setError(errorText(err));
									setSkipping(false);
								}
							}}
						>
							Skip, add it later in Settings
						</TextButton>
					</div>
				</form>
			)}
		</SetupFrame>
	);
}

// ---------- 03c-g features ----------

function Toggle({
	checked,
	onChange,
	disabled,
	label,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative flex h-[18px] w-8 shrink-0 items-center rounded-[9px] p-[2px] transition-colors coarse:before:absolute coarse:before:-inset-x-2 coarse:before:-inset-y-[11px] ${
				checked ? "justify-end bg-accent" : ""
			} ${!checked && !disabled ? "bg-rule-strong" : ""} ${
				disabled ? "cursor-not-allowed bg-wash-2" : ""
			}`}
		>
			<span className="size-[14px] rounded-[7px] bg-paper" />
		</button>
	);
}

function Badge({
	tone,
	children,
}: {
	tone: "muted" | "green" | "amber";
	children: string;
}) {
	const styles =
		tone === "green"
			? "bg-green-soft text-green"
			: tone === "amber"
				? "bg-amber-soft text-amber"
				: "bg-wash-2 text-graphite";
	return (
		<span
			className={`flex h-[20px] items-center whitespace-nowrap rounded-sm px-[6px] text-xs leading-4 ${styles}`}
		>
			{children}
		</span>
	);
}

function FeatureRow({
	title,
	badge,
	children,
	toggle,
	last,
}: {
	title: string;
	badge?: React.ReactNode;
	children: React.ReactNode;
	toggle: React.ReactNode;
	last?: boolean;
}) {
	return (
		<div
			className={`flex items-start gap-4 border-t border-rule py-[14px] ${last ? "border-b" : ""}`}
		>
			<div className="flex grow basis-0 flex-col gap-[6px]">
				<div className="flex flex-wrap items-center gap-2">
					<div className="text-[15px] font-semibold leading-[20px] text-ink">
						{title}
					</div>
					{badge}
				</div>
				{children}
			</div>
			{toggle}
		</div>
	);
}

function money(price: number) {
	return `$${price}/mo`;
}

function FeaturesStep({
	view,
	onDone,
	onGo,
	draft,
	stageError,
}: {
	view: Extract<SetupView, { view: "features" }>;
	onDone: (view: SetupView) => void;
	onGo: (stage: StageName) => void;
	draft: { current: FeatureChoice | null };
	stageError: string | null;
}) {
	const [choice, setChoice] = useState<FeatureChoice>(
		draft.current ?? view.choice,
	);
	const [cap, setCap] = useState<Capabilities>(view.capabilities);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(false);

	const set = (patch: Partial<FeatureChoice>) =>
		setChoice((current) => {
			const next = { ...current, ...patch };
			draft.current = next;
			return next;
		});

	const paid = cap.vectors.kind === "paid" ? cap.vectors.specs : null;
	const spec = paid?.find((s) => s.slug === choice.vectorsSpec) ?? paid?.[0];
	const noEmbeddings = cap.embeddings === "none";
	const vectorsAvailable =
		!noEmbeddings &&
		(cap.vectors.kind === "paid" || cap.vectors.kind === "self-on");
	const dotted = choice.vectors && vectorsAvailable;

	const recheck = async () => {
		setChecking(true);
		setError(null);
		try {
			const next = await fetchSetupView();
			if (next.view === "features") setCap(next.capabilities);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setChecking(false);
		}
	};

	const workspace = view.workspaceName || "this workspace";

	return (
		<SetupFrame
			stage="Features"
			onGo={onGo}
			top={40}
			wide
			heading="Choose what to turn on."
			preview={<MapPreview dotted={Boolean(dotted)} />}
		>
			<div className="flex items-center gap-2 pb-[20px] pt-[10px]">
				<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
					<circle cx="7" cy="7" r="7" fill="var(--color-green)" />
					<path
						d="m4 7 2.2 2.2L10 5.2"
						fill="none"
						stroke="#fff"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<div className="text-base leading-[20px] text-graphite">
					We checked this project: {cap.summary}
				</div>
			</div>

			<div className="max-w-[496px]">
				{/* Search by meaning */}
				{cap.vectors.kind === "paid" ? (
					<div className="flex flex-col gap-[10px] border-t border-rule py-[14px]">
						<div className="flex items-start gap-4">
							<div className="flex grow basis-0 flex-col gap-[3px]">
								<div className="flex flex-wrap items-center gap-2">
									<div className="text-[15px] font-semibold leading-[20px] text-ink">
										Search by meaning
									</div>
									{noEmbeddings ? (
										<Badge tone="muted">Needs an embedding model</Badge>
									) : choice.vectors ? null : spec ? (
										<span className="text-sm leading-[20px] text-pencil">
											from ${paid?.[0].price} a month
										</span>
									) : null}
								</div>
								<div className="text-sm leading-[19px] text-graphite">
									Finds pages by what they mean, and shows related pages on the
									Map. It runs on its own vector database.
								</div>
								{noEmbeddings ? (
									<p className="pt-1 text-sm leading-[19px] text-graphite">
										Add an AI provider with an embedding model to turn this on.
									</p>
								) : null}
							</div>
							<Toggle
								label="Search by meaning"
								checked={Boolean(dotted)}
								disabled={!vectorsAvailable}
								onChange={(on) =>
									set({
										vectors: on,
										vectorsSpec: on
											? (choice.vectorsSpec ?? paid?.[0]?.slug ?? null)
											: choice.vectorsSpec,
									})
								}
							/>
						</div>
						{dotted && spec ? (
							<>
								<div className="flex flex-col">
									{paid?.map((item) => (
										<SpecRow
											key={item.slug}
											spec={item}
											selected={item.slug === spec.slug}
											onSelect={() => set({ vectorsSpec: item.slug })}
										/>
									))}
								</div>
								<div className="text-sm leading-[19px] text-ink">
									Adds ${spec.price} a month to this project's Appwrite bill.
									Nothing is charged unless you continue with this on.
								</div>
							</>
						) : null}
					</div>
				) : (
					<FeatureRow
						title="Search by meaning"
						badge={
							cap.vectors.kind === "free-plan" ? (
								<Badge tone="muted">Needs a paid plan</Badge>
							) : cap.vectors.kind === "self-off" ? (
								<Badge tone="muted">Off on this server</Badge>
							) : cap.vectors.kind === "self-on" ? (
								noEmbeddings ? (
									<Badge tone="muted">Needs an embedding model</Badge>
								) : (
									<Badge tone="green">No extra cost</Badge>
								)
							) : (
								<Badge tone="muted">Unavailable</Badge>
							)
						}
						toggle={
							<Toggle
								label="Search by meaning"
								checked={Boolean(dotted)}
								disabled={!vectorsAvailable}
								onChange={(on) => set({ vectors: on })}
							/>
						}
					>
						{cap.vectors.kind === "free-plan" ? (
							<>
								<p className="text-sm leading-[19px] text-graphite">
									Finds pages by what they mean. It needs its own vector
									database, which the Free plan doesn't include. Keyword search,
									AI answers and the Map all work without it.
								</p>
								<a
									href="https://appwrite.io/pricing"
									target="_blank"
									rel="noreferrer"
									className="text-sm font-medium leading-4 text-link hover:underline"
								>
									See Appwrite plans
								</a>
							</>
						) : cap.vectors.kind === "self-off" ? (
							<>
								<p className="text-sm leading-[19px] text-graphite">
									This needs VectorsDB, which is off by default on self-hosted
									Appwrite. Keyword search, AI answers and the Map all work
									without it.
								</p>
								<div className="flex h-8 items-center rounded-md bg-wash px-[10px] font-mono text-sm leading-4 text-ink">
									_APP_VECTORSDB=enabled
								</div>
								<p className="text-sm leading-[19px] text-graphite">
									Add this to your server's environment and restart Appwrite.
								</p>
								<button
									type="button"
									disabled={checking}
									onClick={recheck}
									className="w-fit text-sm font-medium leading-4 text-link hover:underline disabled:opacity-50"
								>
									Check again
								</button>
							</>
						) : cap.vectors.kind === "self-on" ? (
							<p className="text-sm leading-[19px] text-graphite">
								Finds pages by what they mean, and shows related pages on the
								Map. It runs on your own server, so there's nothing to pay for.
							</p>
						) : (
							<p className="text-sm leading-[19px] text-graphite">
								{cap.vectors.kind === "unknown" ? cap.vectors.message : null}
							</p>
						)}
					</FeatureRow>
				)}

				{/* Connect AI agents */}
				<FeatureRow
					title="Connect AI agents"
					badge={
						cap.agents.kind === "self-hosted" ? (
							<Badge tone="muted">Needs Appwrite Cloud</Badge>
						) : cap.agents.kind === "in-use" ? (
							<Badge tone="amber">Used by another app</Badge>
						) : null
					}
					toggle={
						<Toggle
							label="Connect AI agents"
							checked={choice.agents && cap.agents.kind === "available"}
							disabled={cap.agents.kind !== "available"}
							onChange={(on) => set({ agents: on })}
						/>
					}
				>
					{cap.agents.kind === "self-hosted" ? (
						<p className="text-sm leading-[19px] text-graphite">
							AI agents sign in through Appwrite Cloud's OAuth server, which
							self-hosted Appwrite doesn't include.
						</p>
					) : cap.agents.kind === "in-use" ? (
						<p className="text-sm leading-[19px] text-graphite">
							This project's OAuth server already sends people to{" "}
							{cap.agents.host}. Setup will leave it alone so that app keeps
							working, which means AI agents can't connect to {workspace} here.
						</p>
					) : (
						<p className="text-sm leading-[19px] text-graphite">
							Lets Claude, Cursor and other MCP tools work in {workspace} as the
							person who signs in. Included in your plan.
						</p>
					)}
				</FeatureRow>

				{/* Require two-step sign-in */}
				<FeatureRow
					last
					title="Require two-step sign-in"
					toggle={
						<Toggle
							label="Require two-step sign-in"
							checked={choice.twoStep}
							onChange={(on) => set({ twoStep: on })}
						/>
					}
				>
					<p className="text-sm leading-[19px] text-graphite">
						Everyone adds a code from an authenticator app. Anyone can still
						turn it on for themselves.
					</p>
				</FeatureRow>
			</div>

			<div className="max-w-[496px] pt-3">
				<FormError message={error ?? stageError} />
			</div>
			<div className="flex items-center gap-4 pt-[20px]">
				<PrimaryButton
					loading={busy}
					onClick={async () => {
						setBusy(true);
						setError(null);
						try {
							onDone(
								await submitFeatures({
									data: {
										...choice,
										vectors: Boolean(dotted),
										vectorsSpec: spec?.slug ?? null,
									},
								}),
							);
						} catch (err) {
							setError(errorText(err));
							setBusy(false);
						}
					}}
				>
					Continue
				</PrimaryButton>
				<div className="text-base leading-[18px] text-graphite">
					You can change these later in Settings
				</div>
			</div>
		</SetupFrame>
	);
}

function SpecRow({
	spec,
	selected,
	onSelect,
}: {
	spec: VectorSpec;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<label
			className={`flex h-[36px] cursor-pointer items-center rounded-md px-[10px] ${selected ? "bg-link-soft" : ""}`}
		>
			<input
				type="radio"
				className="sr-only"
				name="vectors-spec"
				value={spec.slug}
				checked={selected}
				onChange={onSelect}
			/>
			<span className="flex w-6 shrink-0">
				<span
					className={`size-[14px] rounded-[7px] ${
						selected
							? "border-4 border-link bg-paper"
							: "border-[1.5px] border-rule-strong"
					}`}
				/>
			</span>
			<span
				className={`w-[112px] shrink-0 text-base leading-[18px] ${selected ? "font-medium text-link" : "text-ink"}`}
			>
				{spec.name}
			</span>
			<span className="grow basis-0 text-sm leading-4 text-graphite">
				{spec.cpu} CPU, {spec.memoryGb} GB memory, {spec.storageGb} GB storage
			</span>
			<span
				className={`w-[68px] shrink-0 text-right text-sm leading-4 ${selected ? "font-medium text-link" : "text-graphite"}`}
			>
				{money(spec.price)}
			</span>
		</label>
	);
}

// ---------- 04 building ----------

function formatDuration(ms: number) {
	return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function StepDot({ status }: { status: SetupStep["status"] | "running" }) {
	if (status === "done")
		return <div className="size-4 shrink-0 rounded-[8px] bg-green" />;
	if (status === "failed")
		return (
			<div className="flex size-4 shrink-0 items-center justify-center rounded-[8px] bg-coral text-xs font-bold leading-4 text-paper">
				!
			</div>
		);
	if (status === "running")
		return (
			<div className="size-4 shrink-0 animate-spin rounded-[8px] border-2 border-link/20 border-t-link" />
		);
	return (
		<div className="size-4 shrink-0 rounded-[8px] border-[1.5px] border-rule-strong" />
	);
}

function BuildStep({
	view,
	onView,
}: {
	view: Extract<SetupView, { view: "build" }>;
	onView: (view: SetupView) => void;
}) {
	const runnerId = useRef(randomId());
	const [running, setRunning] = useState<SetupStepId | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [showLog, setShowLog] = useState(false);
	const [busy, setBusy] = useState(false);
	const [expired, setExpired] = useState(false);
	const [watching, setWatching] = useState(false);
	const inflight = useRef(false);
	const [retryError, setRetryError] = useState<string | null>(null);

	useEffect(() => {
		if (!running) return;
		setElapsed(0);
		const started = Date.now();
		const timer = setInterval(
			() => setElapsed(Math.round((Date.now() - started) / 1000)),
			1000,
		);
		return () => clearInterval(timer);
	}, [running]);

	const failed = view.steps.find((s) => s.status === "failed");
	const next = view.steps.find((s) => s.status === "pending");

	// Whether this view is still on screen. In-flight requests outlive re-renders, so one that
	// returns late still clears `inflight` and the loop carries on.
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	// A new view object is what turns the loop, so a failed look still hands one over.
	const lookAgain = () => {
		setTimeout(async () => {
			if (!alive.current) return;
			const fresh = await fetchSetupView().catch(() => null);
			if (alive.current) onView(fresh ?? { ...view });
		}, 2000);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: failed and next derive from view; each view change is one turn of the loop
	useEffect(() => {
		if (failed || !next || inflight.current) return;
		inflight.current = true;
		setRunning(next.id);
		const run = async () => {
			try {
				const result = await runSetupStep({
					data: { step: next.id, runner: runnerId.current },
				});
				inflight.current = false;
				if (!alive.current) return;
				if (result.view === "build" && result.watching) {
					// Another tab holds the lease. Look again shortly.
					setRunning(null);
					setWatching(true);
					lookAgain();
					return;
				}
				setWatching(false);
				if (result.view === "build" && result.keyExpired) {
					setRunning(null);
					setExpired(true);
					setTimeout(() => {
						if (!alive.current) return;
						setExpired(false);
						onView({ ...result, keyExpired: false });
					}, 2500);
					return;
				}
				setRunning(null);
				onView(result);
			} catch {
				inflight.current = false;
				if (!alive.current) return;
				setRunning(null);
				// A dropped request isn't a failed step. Look at the real state and continue.
				lookAgain();
			}
		};
		run();
	}, [view]);

	const retry = async (step: SetupStep) => {
		setBusy(true);
		setRetryError(null);
		try {
			onView(
				await runSetupStep({
					data: { step: step.id, runner: runnerId.current },
				}),
			);
		} catch (err) {
			setRetryError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const heading = failed
		? "One step needs a retry."
		: `Building ${view.workspaceName}.`;
	const hasVectors = view.steps.some((s) => s.id === "vectors");
	const body = failed
		? "Everything before it is saved. Retrying only runs what's left."
		: hasVectors
			? `${view.workspaceName} is ready in about a minute. The vector database can take longer and finishes on its own.`
			: "This takes about a minute. If you close this tab, come back to /setup and it picks up where it stopped.";

	return (
		<SetupFrame
			stage="Build"
			heading={heading}
			body={body}
			top={failed ? 56 : 56}
			preview={<BuildPreview name={view.workspaceName} />}
		>
			{watching || view.watching ? (
				<p className="pt-3 text-sm leading-[19px] text-graphite">
					Setup is running in another tab. This one is watching.
				</p>
			) : null}
			{expired ? (
				<p className="pt-3 text-sm leading-[19px] text-amber">
					The site's key expired. Getting a fresh one and carrying on.
				</p>
			) : null}
			<div
				className="flex max-w-[496px] flex-col pt-6"
				data-testid="build-steps"
			>
				{view.steps.map((step, index) => {
					const last = index === view.steps.length - 1;
					const isRunning = running === step.id;
					if (step.status === "failed") {
						return (
							<div
								key={step.id}
								className="flex flex-col gap-[6px] rounded-md bg-coral-soft px-3 py-[10px]"
								data-step={step.id}
								data-status="failed"
							>
								<div className="flex items-center gap-[10px]">
									<StepDot status="failed" />
									<div className="grow basis-0 text-base font-medium leading-[18px] text-ink">
										{step.label}
									</div>
									<button
										type="button"
										disabled={busy}
										onClick={() => retry(step)}
										className="flex h-[28px] items-center rounded-[5px] bg-ink px-[10px] text-sm font-medium leading-4 text-paper disabled:opacity-50"
									>
										Retry
									</button>
								</div>
								<div className="pl-[26px] text-sm leading-[19px] text-graphite">
									{step.error}
								</div>
								{step.optional ? (
									<div className="pl-[26px]">
										<button
											type="button"
											disabled={busy}
											onClick={async () => {
												setBusy(true);
												setRetryError(null);
												try {
													onView(await submitSkipVectors());
												} catch (err) {
													setRetryError(errorText(err));
												} finally {
													setBusy(false);
												}
											}}
											className="text-sm leading-4 text-link hover:underline"
										>
											Continue without search by meaning
										</button>
									</div>
								) : null}
							</div>
						);
					}
					const starting = step.detail === "Starting";
					return (
						<div
							key={step.id}
							className={`flex h-[40px] shrink-0 items-center gap-3 ${last ? "" : "border-b border-rule"}`}
							data-step={step.id}
							data-status={isRunning ? "running" : step.status}
						>
							<StepDot
								status={isRunning || starting ? "running" : step.status}
							/>
							<div
								className={`grow basis-0 text-base leading-[18px] ${
									step.status === "done" || isRunning
										? "text-ink"
										: "text-pencil"
								} ${isRunning ? "font-medium" : ""}`}
							>
								{step.label}
							</div>
							<div
								className={`font-mono text-sm leading-4 ${isRunning || starting ? "text-link" : "text-pencil"}`}
							>
								{starting
									? "Starting"
									: isRunning
										? `${elapsed}s`
										: step.durationMs !== undefined
											? formatDuration(step.durationMs)
											: ""}
							</div>
						</div>
					);
				})}
			</div>
			{retryError ? (
				<div className="max-w-[496px] pt-3">
					<FormError message={retryError} />
				</div>
			) : null}
			{view.log.length ? (
				<div className="max-w-[496px] pt-5">
					<button
						type="button"
						onClick={() => setShowLog((v) => !v)}
						className="text-sm leading-4 text-pencil hover:text-ink coarse:py-2.5"
					>
						{showLog ? "Hide log" : "Show log"}
					</button>
					{showLog ? (
						<ul className="mt-2 max-h-[220px] overflow-auto rounded-md bg-wash p-3 font-mono text-xs leading-[18px] text-graphite">
							{view.log.map((line, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
								<li key={`${line.t}-${i}`}>
									<span className="text-pencil">
										{new Date(line.t).toLocaleTimeString()}
									</span>{" "}
									{line.kind === "pause"
										? `paused, resumed ${new Date(line.resumedAt ?? line.t).toLocaleTimeString()}`
										: line.text}
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</SetupFrame>
	);
}

// ---------- 05 done ----------

function isEmail(value: string) {
	const at = value.indexOf("@");
	if (at < 1 || at !== value.lastIndexOf("@")) return false;
	if (value.includes(" ")) return false;
	const domain = value.slice(at + 1);
	return (
		domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
	);
}

function DoneStep({ view }: { view: Extract<SetupView, { view: "done" }> }) {
	const [emails, setEmails] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState<"invite" | "skip" | null>(null);
	const [failed, setFailed] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	const [invalid, setInvalid] = useState<string | null>(null);

	const addDraft = () => {
		const next = draft.trim().replace(/,$/, "").toLowerCase();
		if (!next) {
			setDraft("");
			return;
		}
		if (!isEmail(next)) {
			setInvalid(`"${draft.trim()}" isn't an email address.`);
			return;
		}
		setEmails((list) => (list.includes(next) ? list : [...list, next]));
		setFailed((list) => list.filter((e) => e !== next));
		setDraft("");
		setInvalid(null);
	};

	const removeEmail = (email: string) => {
		setEmails((list) => list.filter((e) => e !== email));
		setFailed((list) => list.filter((e) => e !== email));
	};

	const open = () => window.location.assign(`/w/${view.workspaceId}`);

	const finish = async (mode: "invite" | "skip") => {
		setBusy(mode);
		setError(null);
		try {
			const list = mode === "invite" ? emails : [];
			const pending = draft.trim() ? [draft.trim()] : [];
			const result = await submitFinish({
				data: { invites: mode === "invite" ? [...list, ...pending] : [] },
			});
			if (result.failed.length) {
				setFailed(result.failed);
				setBusy(null);
				return;
			}
			open();
		} catch (err) {
			setError(errorText(err));
			setBusy(null);
		}
	};

	const invitedOk = emails.filter((e) => !failed.includes(e));

	return (
		<SetupFrame
			top={88}
			kicker={`Setup finished in ${view.seconds} seconds`}
			heading={`${view.workspaceName} is ready. Bring people in.`}
			body="Livepage is better with someone on the other side of the cursor."
			preview={<DonePreview name={view.workspaceName} />}
		>
			<div className="flex max-w-[440px] flex-col gap-[6px] pt-8">
				<FieldLabel htmlFor="setup-invite">Invite your team</FieldLabel>
				<div className="flex min-h-[40px] flex-wrap items-center gap-[6px] rounded-md border border-rule-strong px-[6px] py-[6px] focus-within:border-[1.5px] focus-within:border-link">
					{emails.map((email) => (
						<span
							key={email}
							className={`flex h-[26px] items-center gap-1 rounded-sm pl-2 pr-1 text-sm leading-4 ${failed.includes(email) ? "bg-coral-soft text-coral" : "bg-wash-2 text-ink"}`}
						>
							{email}
							<button
								type="button"
								aria-label={`Remove ${email}`}
								onClick={() => removeEmail(email)}
								className="flex size-4 items-center justify-center rounded-sm text-pencil hover:text-ink coarse:-my-2 coarse:size-8"
							>
								×
							</button>
						</span>
					))}
					<input
						id="setup-invite"
						className="h-[26px] min-w-[120px] flex-1 bg-transparent px-1 text-[15px] leading-[18px] text-ink outline-none placeholder:text-pencil"
						placeholder={emails.length ? "" : "name@team.com"}
						value={draft}
						aria-invalid={Boolean(invalid)}
						onChange={(e) => {
							setDraft(e.target.value);
							setInvalid(null);
						}}
						onBlur={addDraft}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "," || e.key === " ") {
								e.preventDefault();
								addDraft();
							}
							if (e.key === "Backspace" && !draft && emails.length) {
								removeEmail(emails[emails.length - 1]);
							}
						}}
					/>
				</div>
				{invalid ? <FormError message={invalid} /> : null}
				{failed.length ? (
					<p className="text-sm leading-[19px] text-coral" role="alert">
						Couldn't invite {failed.join(", ")}.{" "}
						{invitedOk.length ? `The rest are on their way. ` : ""}
						Fix or remove them and try again.
					</p>
				) : null}
				<FormError message={error} />
			</div>
			<div className="flex flex-wrap items-center gap-4 pt-[20px]">
				<PrimaryButton
					loading={busy === "invite"}
					disabled={
						busy !== null ||
						(emails.length === 0 && !draft.trim()) ||
						Boolean(invalid)
					}
					onClick={() => finish("invite")}
				>
					Send invites and open {view.workspaceName}
				</PrimaryButton>
				<TextButton onClick={() => (busy ? undefined : finish("skip"))}>
					{busy === "skip" ? "Opening" : "Open without inviting"}
				</TextButton>
			</div>
			<div className="flex max-w-[440px] gap-[10px] pt-8">
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					aria-hidden="true"
					className="shrink-0"
				>
					<path
						d="M8 1.5 13.5 3.5v4c0 3.4-2.3 5.9-5.5 7-3.2-1.1-5.5-3.6-5.5-7v-4z"
						fill="none"
						stroke="var(--color-green)"
						strokeWidth="1.4"
						strokeLinejoin="round"
					/>
				</svg>
				<div className="text-sm leading-[20px] text-graphite">
					Setup is locked, and this site gave back the permissions only setup
					needed.
				</div>
			</div>
			{view.vectorsPending ? (
				<div className="flex max-w-[440px] gap-[10px] pt-4">
					<div className="mt-0.5 size-4 shrink-0 animate-spin rounded-[8px] border-2 border-link/20 border-t-link" />
					<div className="text-sm leading-[20px] text-graphite">
						Search by meaning is still starting. Keyword search works now, and
						this switches on by itself. You can close this tab.
					</div>
				</div>
			) : null}
			{view.vectorsFailed ? (
				<div className="flex max-w-[440px] gap-[10px] pt-4">
					<div className="mt-[3px] size-[10px] shrink-0 rounded-full bg-amber" />
					<div className="text-sm leading-[20px] text-graphite">
						Search by meaning couldn't start, so keyword search is on. You can
						try again from Settings.
					</div>
				</div>
			) : null}
		</SetupFrame>
	);
}
