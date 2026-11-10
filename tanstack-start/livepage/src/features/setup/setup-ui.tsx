// The Setup frame (form on the left, a quiet preview on the right) and small shared parts, from the
// Setup boards.
import { useHydrated } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function Logo() {
	return (
		<div className="flex items-center gap-[10px]">
			<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent">
				<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
					<circle
						cx="6"
						cy="8"
						r="4"
						fill="none"
						stroke="#fff"
						strokeWidth="1.6"
					/>
					<circle
						cx="10"
						cy="8"
						r="4"
						fill="none"
						stroke="#fff"
						strokeWidth="1.6"
					/>
				</svg>
			</div>
			<div className="text-[15px] font-semibold leading-[18px] tracking-[-0.01em] text-ink">
				Livepage
			</div>
		</div>
	);
}

const STAGES = ["Account", "Workspace", "AI", "Features", "Build"] as const;
export type StageName = (typeof STAGES)[number];

export function Stepper({
	current,
	onGo,
}: {
	current: StageName;
	onGo?: (stage: StageName) => void;
}) {
	const at = STAGES.indexOf(current);
	return (
		<div className="flex flex-wrap items-center gap-2" data-testid="stepper">
			{STAGES.map((stage, i) => (
				<div key={stage} className="flex items-center gap-2">
					{i > 0 ? <div className="h-px w-5 shrink-0 bg-rule-strong" /> : null}
					{i < at && onGo ? (
						<button
							type="button"
							onClick={() => onGo(stage)}
							className="text-sm leading-4 text-pencil hover:text-ink coarse:py-2"
						>
							{stage}
						</button>
					) : (
						<div
							className={`text-sm leading-4 ${
								i === at ? "font-semibold text-link" : "text-pencil"
							}`}
						>
							{stage}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

export function SetupFrame({
	stage,
	onGo,
	top = 88,
	heading,
	body,
	children,
	preview,
	wide,
	kicker,
}: {
	kicker?: string;
	stage?: StageName;
	onGo?: (stage: StageName) => void;
	top?: number;
	heading: ReactNode;
	body?: ReactNode;
	children: ReactNode;
	preview: ReactNode;
	wide?: boolean;
}) {
	return (
		<main className="flex min-h-dvh bg-paper antialiased">
			<div className="flex min-h-dvh w-full shrink-0 flex-col px-6 pb-8 pt-[36px] sm:px-[72px] lg:w-[640px]">
				<Logo />
				<div style={{ paddingTop: top }}>
					{stage ? <Stepper current={stage} onGo={onGo} /> : null}
					{kicker ? (
						<div className="text-sm font-semibold leading-4 text-green">
							{kicker}
						</div>
					) : null}
					<div className={stage || kicker ? "pt-[20px]" : ""}>
						<h1
							className={`font-serif font-medium tracking-[-0.02em] text-ink ${
								wide
									? "text-[44px] leading-[50px]"
									: "text-[48px] leading-[54px]"
							}`}
						>
							{heading}
						</h1>
					</div>
					{body ? (
						<div className="max-w-[460px] pt-[10px] text-md leading-[25px] text-graphite">
							{body}
						</div>
					) : null}
					{children}
				</div>
			</div>
			<div className="hidden min-h-dvh grow flex-col items-center justify-center gap-6 border-l border-rule bg-wash p-8 lg:flex">
				{preview}
			</div>
		</main>
	);
}

export function PreviewCaption({ children }: { children: ReactNode }) {
	return (
		<div className="text-center text-base leading-[18px] text-graphite">
			{children}
		</div>
	);
}

// ---------- form bits ----------

export function FieldLabel({
	htmlFor,
	children,
}: {
	htmlFor: string;
	children: ReactNode;
}) {
	return (
		<label htmlFor={htmlFor} className="text-sm font-medium leading-4 text-ink">
			{children}
		</label>
	);
}

export const fieldClass =
	"h-[40px] w-full rounded-md border border-rule-strong bg-paper px-3 text-[15px] leading-[18px] text-ink placeholder:text-pencil hover:border-pencil focus:border-[1.5px] focus:border-link focus:outline-none disabled:opacity-50";

export function PrimaryButton({
	children,
	loading,
	disabled,
	type = "button",
	onClick,
	full,
}: {
	children: ReactNode;
	loading?: boolean;
	disabled?: boolean;
	type?: "button" | "submit";
	onClick?: () => void;
	full?: boolean;
}) {
	// Until React takes over, a disabled submit button stops the browser posting the form itself.
	const hydrated = useHydrated();
	return (
		<button
			type={type}
			disabled={disabled || loading || (type === "submit" && !hydrated)}
			onClick={onClick}
			className={`flex h-[40px] items-center justify-center gap-2 rounded-md bg-ink px-[18px] text-base font-medium leading-[18px] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${full ? "w-full" : ""}`}
		>
			{loading ? (
				<span className="inline-block size-3.5 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
			) : null}
			{children}
		</button>
	);
}

export function TextButton({
	children,
	onClick,
	type = "button",
}: {
	children: ReactNode;
	onClick?: () => void;
	type?: "button" | "submit";
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			className="text-base leading-[18px] text-graphite hover:text-ink coarse:py-2.5"
		>
			{children}
		</button>
	);
}

export function FormError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p className="text-sm leading-[19px] text-coral" role="alert">
			{message}
		</p>
	);
}

// ---------- previews on the right ----------

function WindowFrame({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-[440px] w-[640px] max-w-full shrink-0 overflow-clip rounded-lg border border-rule bg-paper [box-shadow:#1111112E_0px_24px_60px_-24px]">
			{children}
		</div>
	);
}

function Bar({ w, h = 9 }: { w: number; h?: number }) {
	return (
		<div
			className="shrink-0 rounded-[5px] bg-wash-2"
			style={{ width: w, height: h }}
		/>
	);
}

function WorkspaceLetter({ name }: { name: string }) {
	return (
		<div className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-accent">
			<div className="text-xs font-semibold leading-4 text-paper">
				{(name.trim()[0] ?? "L").toUpperCase()}
			</div>
		</div>
	);
}

export function AccountPreview({ name }: { name: string }) {
	const first = name.trim().split(/\s+/)[0] || "";
	return (
		<>
			<WindowFrame>
				<div className="flex w-[160px] shrink-0 flex-col gap-[10px] border-r border-rule bg-wash px-3 py-4">
					<div className="h-[10px] w-[84px] rounded-[5px] bg-rule-strong" />
					<div className="h-3" />
					<Bar w={120} h={8} />
					<Bar w={92} h={8} />
					<Bar w={108} h={8} />
				</div>
				<div className="flex grow basis-0 flex-col gap-[14px] px-[44px] py-12">
					<div className="flex items-center">
						<div className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
							Welcome{first ? `, ${first}` : ""}
						</div>
						<div className="relative h-8 w-[2px] shrink-0 bg-amber">
							<div className="absolute left-0 top-[-20px] h-[20px] whitespace-nowrap rounded-t-[3px] rounded-br-[3px] bg-amber px-[7px]">
								<div className="whitespace-pre text-xs font-medium leading-[20px] text-paper">
									{first || "You"}
								</div>
							</div>
						</div>
					</div>
					<Bar w={340} />
					<Bar w={300} />
					<Bar w={220} />
				</div>
			</WindowFrame>
			<PreviewCaption>
				Your first cursor. It gets more interesting when other people arrive.
			</PreviewCaption>
		</>
	);
}

const PAGE_NAMES = ["Getting started", "Team wiki", "Projects"];

export function WorkspacePreview({ name }: { name: string }) {
	return (
		<>
			<WindowFrame>
				<div className="flex w-[190px] shrink-0 flex-col gap-[6px] border-r border-rule bg-wash px-3 py-[14px]">
					<div className="flex items-center gap-2 pb-[10px]">
						<WorkspaceLetter name={name} />
						<div className="truncate text-base font-semibold leading-[18px] text-ink">
							{name || "Your team"}
						</div>
					</div>
					{PAGE_NAMES.map((page) => (
						<div
							key={page}
							className="flex h-[26px] items-center text-sm leading-4 text-graphite"
						>
							{page}
						</div>
					))}
				</div>
				<div className="flex grow basis-0 flex-col gap-[14px] px-[40px] py-12">
					<div className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
						{name || "Your team"}
					</div>
					<Bar w={300} />
					<Bar w={260} />
				</div>
			</WindowFrame>
			<PreviewCaption>
				We'll start you off with three pages you can keep or delete.
			</PreviewCaption>
		</>
	);
}

export function AiPreview() {
	return (
		<>
			<div className="flex w-[640px] max-w-full flex-col gap-[14px] overflow-clip rounded-lg border border-rule bg-paper px-[40px] py-8 [box-shadow:#1111112E_0px_24px_60px_-24px]">
				<div className="text-md leading-[26px] text-ink">
					Offline mode ships March 18. Field crews lose signal for hours,
				</div>
				<div className="flex flex-col gap-[10px] rounded-[8px] border border-link p-[14px]">
					<div className="flex items-center gap-2">
						<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
							<path
								d="M7 1.5 8.3 5.7 12.5 7 8.3 8.3 7 12.5 5.7 8.3 1.5 7l4.2-1.3z"
								fill="var(--color-link)"
							/>
						</svg>
						<div className="grow text-base leading-[18px] text-ink">
							Summarise the last three incident reviews
						</div>
					</div>
					<div className="h-px bg-rule" />
					<div className="text-base leading-[22px] text-graphite">
						All three started with a failed sync after a long disconnect.
						Runbooks now cover the retry, but nothing warns the crew.
					</div>
					<div className="flex gap-[6px]">
						{["INC-204", "INC-211", "INC-219"].map((tag) => (
							<div
								key={tag}
								className="flex h-6 items-center rounded-sm bg-wash px-2 text-sm leading-4 text-graphite"
							>
								{tag}
							</div>
						))}
					</div>
				</div>
				<div className="flex gap-[28px] pt-[6px] text-sm leading-4 text-graphite">
					<div>Write and rewrite</div>
					<div>Ask your workspace</div>
					<div>Fill database columns</div>
				</div>
			</div>
			<PreviewCaption>Answers cite the pages they came from.</PreviewCaption>
		</>
	);
}

export function MapPreview({ dotted }: { dotted: boolean }) {
	const node = (
		left: number,
		top: number,
		width: number,
		label: string,
		dot: ReactNode,
		tone: string,
	) => (
		<div
			className="absolute flex flex-col items-center gap-[7px]"
			style={{ left, top, width }}
		>
			{dot}
			<div className="bg-paper px-1">
				<div className={`text-base leading-[18px] ${tone}`}>{label}</div>
			</div>
		</div>
	);
	return (
		<>
			<div className="relative h-[440px] w-[640px] max-w-full shrink-0 overflow-clip rounded-lg border border-rule bg-paper">
				<svg
					className="absolute left-0 top-0"
					width="640"
					height="440"
					viewBox="0 0 640 440"
					aria-hidden="true"
				>
					<path
						d="M300 200 440 110M300 200 150 120M300 200 170 300M440 110 540 210"
						fill="none"
						stroke="currentColor"
						className="text-ink"
						strokeWidth="1.5"
					/>
					{dotted ? (
						<path
							d="M300 200 480 340M300 200 330 370"
							fill="none"
							stroke="var(--color-link)"
							strokeWidth="1.5"
							strokeDasharray="3 5"
						/>
					) : null}
				</svg>
				{node(
					200,
					186,
					200,
					"Offline mode launch",
					<div className="size-[28px] shrink-0 rounded-[14px] bg-accent" />,
					"font-semibold text-ink",
				)}
				{node(
					370,
					98,
					140,
					"Roadmap",
					<div className="size-6 shrink-0 rounded-md bg-ink" />,
					"font-medium text-ink",
				)}
				{node(
					80,
					110,
					140,
					"Launch tasks",
					<div className="size-[20px] shrink-0 rounded-[5px] bg-ink" />,
					"font-medium text-ink",
				)}
				{node(
					100,
					291,
					140,
					"Sync engine spec",
					<div className="size-[18px] shrink-0 rounded-[9px] bg-ink" />,
					"font-medium text-ink",
				)}
				{node(
					470,
					202,
					140,
					"Pricing v3 rollout",
					<div className="size-4 shrink-0 rounded-[8px] border-[1.5px] border-pencil bg-paper" />,
					"text-graphite",
				)}
				{dotted ? (
					<>
						{node(
							410,
							331,
							140,
							"Runbooks",
							<div className="size-[18px] shrink-0 rounded-[9px] border-[1.5px] border-link bg-paper" />,
							"text-link",
						)}
						{node(
							260,
							362,
							140,
							"Crew onboarding",
							<div className="size-4 shrink-0 rounded-[8px] border-[1.5px] border-link bg-paper" />,
							"text-link",
						)}
					</>
				) : null}
			</div>
			<PreviewCaption>
				{dotted
					? "Solid lines are links your team made. Dotted lines come from search by meaning."
					: "Your Map still shows every link your team makes."}
			</PreviewCaption>
		</>
	);
}

export function BuildPreview({ name }: { name: string }) {
	return (
		<>
			<WindowFrame>
				<div className="flex w-[190px] shrink-0 flex-col gap-[6px] border-r border-rule bg-wash px-3 py-[14px]">
					<div className="flex items-center gap-2 pb-[10px]">
						<WorkspaceLetter name={name} />
						<div className="truncate text-base font-semibold leading-[18px] text-ink">
							{name}
						</div>
					</div>
					<Bar w={120} h={8} />
					<div className="h-1" />
					<Bar w={96} h={8} />
					<div className="h-1" />
					<Bar w={108} h={8} />
				</div>
				<div className="flex grow basis-0 flex-col gap-[14px] px-[40px] py-12">
					<div className="h-[26px] w-[220px] rounded-[5px] bg-wash-2" />
					<Bar w={340} />
					<Bar w={300} />
					<Bar w={320} />
				</div>
			</WindowFrame>
			<PreviewCaption>
				Your site's own key is doing the work. You don't need to paste one.
			</PreviewCaption>
		</>
	);
}

export function DonePreview({ name }: { name: string }) {
	return (
		<>
			<WindowFrame>
				<div className="flex w-[190px] shrink-0 flex-col gap-[2px] border-r border-rule bg-wash px-3 py-[14px]">
					<div className="flex items-center gap-2 pb-3">
						<WorkspaceLetter name={name} />
						<div className="truncate text-base font-semibold leading-[18px] text-ink">
							{name}
						</div>
					</div>
					<div className="flex h-[28px] items-center rounded-[5px] bg-link-soft px-2 text-sm font-medium leading-4 text-link">
						Getting started
					</div>
					<div className="flex h-[28px] items-center px-2 text-sm leading-4 text-graphite">
						Team wiki
					</div>
					<div className="flex h-[28px] items-center px-2 text-sm leading-4 text-graphite">
						Projects
					</div>
				</div>
				<div className="flex grow basis-0 flex-col gap-3 px-[36px] py-[44px]">
					<div className="font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
						Getting started
					</div>
					<div className="text-base leading-[22px] text-graphite">
						Type / for blocks, or press Space on an empty line to ask AI.
					</div>
					{[
						"Invite someone and watch their cursor",
						"Type /database to add a table to a page",
						"Ask AI what's on this page",
					].map((line) => (
						<div key={line} className="flex items-center gap-[10px]">
							<div className="size-[14px] shrink-0 rounded-[3px] border-[1.5px] border-rule-strong" />
							<div className="text-base leading-[18px] text-ink">{line}</div>
						</div>
					))}
				</div>
			</WindowFrame>
			<PreviewCaption>
				Your first page, already in the workspace.
			</PreviewCaption>
		</>
	);
}

export function ScopesCard({ scopes }: { scopes: string[] }) {
	return (
		<>
			<div className="flex w-[560px] max-w-full flex-col gap-3 rounded-lg border border-rule bg-paper p-6">
				<div className="text-sm leading-4 text-pencil">
					Sites / Livepage / Settings / Build
				</div>
				<div className="text-md font-semibold leading-[20px] text-ink">
					Scopes
				</div>
				<div className="flex flex-wrap gap-2">
					{scopes.map((scope) => (
						<div
							key={scope}
							className="flex h-[26px] items-center rounded-sm bg-link-soft px-2 font-mono text-sm leading-4 text-link"
						>
							{scope}
						</div>
					))}
				</div>
			</div>
			<PreviewCaption>
				This is the card to look for in the Console.
			</PreviewCaption>
		</>
	);
}
