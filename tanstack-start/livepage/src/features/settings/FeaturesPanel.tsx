import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Switch, useToast } from "#/components/ui";
import { refreshAiStatus } from "#/features/ai/client";
import {
	fetchFeatures,
	submitDisableVectors,
	submitEnableVectors,
	submitFlag,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import type { VectorSpec } from "#/lib/setup-types";
import {
	ConfirmDialog,
	PanelError,
	PanelSkeleton,
	PanelTitle,
	Row,
	Tag,
	TextLink,
} from "./ui";

type State = Awaited<ReturnType<typeof fetchFeatures>>;

export function FeaturesPanel() {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [turningOff, setTurningOff] = useState(false);
	const workspaceId = workspace.id;

	const load = useCallback(() => {
		fetchFeatures({ data: { workspaceId } })
			.then((next) => {
				setState(next);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, [workspaceId]);

	useEffect(load, [load]);

	if (error && !state) return <PanelError message={error} onRetry={load} />;
	if (!state) return <PanelSkeleton />;

	const flip = async (name: "publish" | "guests", value: boolean) => {
		setState({ ...state, flags: { ...state.flags, [name]: value } });
		try {
			await submitFlag({ data: { name, value } });
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			load();
		}
	};

	const vectors = state.vectors;
	const can = state.canChange;
	return (
		<>
			<PanelTitle
				title="Features"
				subtitle={`Optional parts of ${workspace.name}. Turn them on or off at any time.`}
			/>
			{!can && (
				<p className="text-sm text-graphite">
					Only the owner of this site's first workspace can change these.
				</p>
			)}
			<div className="w-full max-w-[760px] border-t border-rule">
				<div className="border-b border-rule py-3.5">
					<div className="flex items-center gap-2 text-base font-medium text-ink">
						Search by meaning
						<Tag on={vectors.kind === "on" && vectors.status === "ready"}>
							{vectors.kind !== "on"
								? "Off"
								: vectors.status === "ready"
									? "On"
									: vectors.status === "starting"
										? "Starting"
										: "Not running"}
						</Tag>
					</div>
					<p className="mt-0.5 text-sm text-graphite">
						Finds pages by what they're about, and shows related pages on the
						map.
					</p>
					<VectorsBody
						state={vectors}
						can={can}
						onEnable={async (spec) => {
							await submitEnableVectors({ data: { specification: spec } });
							refreshAiStatus();
							load();
						}}
						onTurnOff={() => setTurningOff(true)}
					/>
				</div>
				<Row
					title="Publish to the web"
					detail="Members can share read-only pages with a public link."
				>
					<Switch
						checked={state.flags.publish}
						disabled={!can}
						onChange={(v) => void flip("publish", v)}
						label="Publish to the web"
					/>
				</Row>
				<Row
					title="Guests"
					detail={`Invite people from outside ${workspace.name} to single pages.`}
				>
					<Switch
						checked={state.flags.guests}
						disabled={!can}
						onChange={(v) => void flip("guests", v)}
						label="Guests"
					/>
				</Row>
			</div>
			<ConfirmDialog
				open={turningOff}
				onClose={() => setTurningOff(false)}
				title="Turn off search by meaning?"
				description="This deletes the vector database. Pages keep working with keyword search."
				action="Turn off"
				onConfirm={async () => {
					await submitDisableVectors();
					refreshAiStatus();
					load();
				}}
			/>
		</>
	);
}

function VectorsBody({
	state,
	can,
	onEnable,
	onTurnOff,
}: {
	state: State["vectors"];
	can: boolean;
	onEnable: (spec: string | null) => Promise<void>;
	onTurnOff: () => void;
}) {
	const toast = useToast();
	const [busy, setBusy] = useState(false);
	const enable = async (spec: string | null) => {
		setBusy(true);
		try {
			await onEnable(spec);
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};
	if (state.kind === "on")
		return (
			<div className="mt-3 flex flex-wrap items-center justify-between gap-4">
				<span className="flex items-center gap-1.5 text-sm text-ink">
					<span
						className={`size-1.5 rounded-full ${state.status === "ready" ? "bg-green" : state.status === "starting" ? "bg-amber" : "bg-coral"}`}
					/>
					{state.status === "ready"
						? "Running"
						: state.status === "starting"
							? "Starting up. It shows up in search once it's running."
							: "Not running. Pages use keyword search until it is."}
				</span>
				{can && (
					<TextLink danger onClick={onTurnOff}>
						Turn off
					</TextLink>
				)}
				<p className="w-full text-sm text-graphite">
					Turning off deletes the vector database. Pages keep working with
					keyword search.
				</p>
			</div>
		);
	if (state.kind === "off")
		return (
			<SpecPicker specs={state.specs} can={can} busy={busy} onEnable={enable} />
		);
	if (state.kind === "self-on")
		return (
			<div className="mt-3 flex items-center gap-3">
				{can && (
					<Button
						variant="primary"
						loading={busy}
						onClick={() => void enable(null)}
					>
						Turn on
					</Button>
				)}
				<span className="text-sm text-graphite">
					Uses the VectorsDB on your Appwrite server.
				</span>
			</div>
		);
	if (state.kind === "free-plan")
		return (
			<p className="mt-3 text-sm text-graphite">
				Search by meaning needs a paid Appwrite plan. Keyword search works
				without it.
			</p>
		);
	if (state.kind === "self-off")
		return (
			<p className="mt-3 text-sm text-graphite">
				Your Appwrite server has no VectorsDB. Add one and this can be turned
				on.
			</p>
		);
	if (state.kind === "needs-scopes")
		return (
			<p className="mt-3 text-sm leading-[18px] text-graphite">
				This site's API key was given back after setup, so it can't create a
				vector database. Add these scopes to the key in the site's settings,
				then come back: {state.scopes.join(", ")}.
				{state.siteSettings && (
					<>
						{" "}
						<a
							href={state.siteSettings}
							target="_blank"
							rel="noreferrer"
							className="text-link hover:underline"
						>
							Open site settings
						</a>
					</>
				)}
			</p>
		);
	return <p className="mt-3 text-sm text-graphite">{state.message}</p>;
}

function SpecPicker({
	specs,
	can,
	busy,
	onEnable,
}: {
	specs: VectorSpec[];
	can: boolean;
	busy: boolean;
	onEnable: (spec: string | null) => void;
}) {
	const [chosen, setChosen] = useState(specs[0]?.slug ?? "");
	if (!can) return null;
	return (
		<>
			<div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
				{specs.map((spec) => {
					const active = spec.slug === chosen;
					return (
						<button
							key={spec.slug}
							type="button"
							aria-pressed={active}
							onClick={() => setChosen(spec.slug)}
							className={`rounded-md border p-3 text-left ${active ? "border-link-soft bg-link-soft text-link" : "border-rule text-ink hover:bg-wash"}`}
						>
							<div className="text-base font-medium">{spec.name}</div>
							<div
								className={`text-sm ${active ? "text-link" : "text-graphite"}`}
							>
								${spec.price} per month
							</div>
						</button>
					);
				})}
			</div>
			<div className="mt-3 flex items-center gap-3">
				<Button
					variant="primary"
					loading={busy}
					disabled={!chosen}
					onClick={() => onEnable(chosen)}
				>
					Turn on
				</Button>
				<span className="text-sm text-graphite">
					Adds to this project's Appwrite bill. Nothing is charged until you
					confirm.
				</span>
			</div>
		</>
	);
}
