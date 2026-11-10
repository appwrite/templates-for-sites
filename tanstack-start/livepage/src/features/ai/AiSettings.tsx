// Settings → AI (board 33). Owners and admins only; the server functions enforce that themselves.
import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Button, Input, Skeleton, Switch } from "#/components/ui";
import {
	fetchAiCapabilities,
	fetchAiSettings,
	submitAiSettings,
	submitAiTest,
} from "#/functions/ai";
import { errorText } from "#/lib/errors";
import type {
	AiCapabilities,
	AiSettingsPatch,
	AiSettingsView,
	Capability,
} from "#/server/ai";
import { refreshAiStatus } from "./client";
import { Spark } from "./spark";

const OPENAI_ENDPOINT = "https://api.openai.com/v1";

export function AiSettings() {
	const { workspace } = useWorkspace();
	const allowed = workspace.role === "owner" || workspace.role === "admin";
	if (!allowed) {
		return (
			<div className="max-w-[620px]">
				<h1 className="mb-6 font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
					AI
				</h1>
				<p className="text-base text-graphite">
					Only workspace owners and admins can change AI settings.
				</p>
			</div>
		);
	}
	return <AiSettingsForm workspaceId={workspace.id} />;
}

function AiSettingsForm({ workspaceId }: { workspaceId: string }) {
	const [settings, setSettings] = useState<AiSettingsView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null);
	const [replacing, setReplacing] = useState(false);
	const [key, setKey] = useState("");
	const [advanced, setAdvanced] = useState(false);
	const [endpoint, setEndpoint] = useState("");
	const [textModel, setTextModel] = useState("");
	const [imageModel, setImageModel] = useState("");
	const [embeddingModel, setEmbeddingModel] = useState("");
	const [busy, setBusy] = useState<"save" | "test" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const load = useCallback(() => {
		fetchAiSettings({ data: { workspaceId } })
			.then((view) => {
				setSettings(view);
				setEndpoint(view.endpoint);
				setTextModel(view.textModel);
				setImageModel(view.imageModel);
				setEmbeddingModel(view.embeddingModel);
				if (view.hasKey) {
					fetchAiCapabilities({ data: { workspaceId } })
						.then(setCapabilities)
						.catch((err) => setError(errorText(err)));
				}
			})
			.catch((err) => setLoadError(errorText(err)));
	}, [workspaceId]);

	useEffect(load, [load]);

	const buildPatch = (): AiSettingsPatch => ({
		...(key.trim() ? { key: key.trim() } : {}),
		endpoint,
		textModel,
		imageModel,
		embeddingModel,
	});

	const save = async () => {
		setBusy("save");
		setError(null);
		setMessage(null);
		try {
			const result = await submitAiSettings({
				data: { workspaceId, patch: buildPatch() },
			});
			setSettings(result.settings);
			if (result.capabilities) setCapabilities(result.capabilities);
			setEndpoint(result.settings.endpoint);
			setTextModel(result.settings.textModel);
			setImageModel(result.settings.imageModel);
			setEmbeddingModel(result.settings.embeddingModel);
			setKey("");
			setReplacing(false);
			setMessage("Saved. AI is working.");
			refreshAiStatus();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(null);
		}
	};

	const test = async () => {
		setBusy("test");
		setError(null);
		setMessage(null);
		try {
			const result = await submitAiTest({
				data: { workspaceId, patch: buildPatch() },
			});
			setCapabilities(result);
			setMessage("The provider answered.");
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(null);
		}
	};

	const toggleAsk = async (next: boolean) => {
		if (!settings) return;
		setSettings({ ...settings, ask: next });
		setError(null);
		try {
			const result = await submitAiSettings({
				data: { workspaceId, patch: { ask: next } },
			});
			setSettings(result.settings);
			refreshAiStatus();
		} catch (err) {
			setSettings({ ...settings, ask: !next });
			setError(errorText(err));
		}
	};

	if (loadError) return <p className="text-base text-coral">{loadError}</p>;
	if (!settings) {
		return (
			<div className="max-w-[620px] space-y-4">
				<Skeleton className="h-12 w-24" />
				<Skeleton className="h-11 w-[480px]" />
			</div>
		);
	}

	const isOpenAi = endpoint.replace(/\/+$/, "") === OPENAI_ENDPOINT;
	const showKeyInput = !settings.hasKey || replacing;

	return (
		<div className="max-w-[620px]">
			<h1 className="mb-6 font-serif text-[32px] font-medium leading-[38px] tracking-[-0.02em] text-ink">
				AI
			</h1>

			<label
				htmlFor="ai-key"
				className="mb-2 block text-sm font-medium leading-4 text-ink"
			>
				{isOpenAi ? "OpenAI API key" : "API key"}
			</label>
			{showKeyInput ? (
				<div className="flex max-w-[480px] items-center gap-2">
					<Input
						id="ai-key"
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={key}
						placeholder="Paste your key"
						onChange={(e) => setKey(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && key.trim() && busy === null) {
								e.preventDefault();
								void save();
							}
						}}
					/>
					{settings.hasKey && (
						<Button
							variant="ghost"
							onClick={() => {
								setReplacing(false);
								setKey("");
							}}
						>
							Cancel
						</Button>
					)}
				</div>
			) : (
				<div className="flex h-10 max-w-[480px] items-center justify-between rounded-md border border-rule-strong px-3 font-mono text-base text-graphite">
					<span>
						Saved as a secret
						{settings.keyHint ? `, ending ${settings.keyHint}` : ""}
					</span>
					<span className="flex items-center gap-3 font-sans">
						<button
							type="button"
							className="text-link"
							disabled={busy !== null}
							onClick={test}
						>
							{busy === "test" ? "Testing" : "Test"}
						</button>
						<button
							type="button"
							className="text-link"
							onClick={() => setReplacing(true)}
						>
							Replace
						</button>
					</span>
				</div>
			)}

			{showKeyInput && (
				<div className="mt-3 flex items-center gap-3">
					<Button
						variant="primary"
						loading={busy === "save"}
						disabled={!key.trim() || busy !== null}
						onClick={save}
					>
						Test and save
					</Button>
				</div>
			)}

			<div className="mt-3">
				<button
					type="button"
					className="text-sm text-link"
					aria-expanded={advanced}
					onClick={() => setAdvanced((v) => !v)}
				>
					Advanced
				</button>
			</div>
			{advanced && (
				<div className="mt-3 max-w-[480px] space-y-3 rounded-md border border-rule p-4">
					<Labeled
						label="Endpoint URL"
						hint="Any OpenAI-compatible API. Changing it needs the key again."
					>
						{(id) => (
							<Input
								id={id}
								value={endpoint}
								spellCheck={false}
								onChange={(e) => setEndpoint(e.target.value)}
							/>
						)}
					</Labeled>
					<Labeled label="Text model">
						{(id) => (
							<Input
								id={id}
								value={textModel}
								spellCheck={false}
								placeholder="Detected from the provider"
								onChange={(e) => setTextModel(e.target.value)}
							/>
						)}
					</Labeled>
					<Labeled label="Image model">
						{(id) => (
							<Input
								id={id}
								value={imageModel}
								spellCheck={false}
								placeholder="Detected from the provider"
								onChange={(e) => setImageModel(e.target.value)}
							/>
						)}
					</Labeled>
					<Labeled
						label="Embedding model"
						hint="Blank uses Appwrite's built-in embeddings."
					>
						{(id) => (
							<Input
								id={id}
								value={embeddingModel}
								spellCheck={false}
								placeholder="Appwrite's built-in"
								onChange={(e) => setEmbeddingModel(e.target.value)}
							/>
						)}
					</Labeled>
					{settings.hasKey && !replacing && (
						<div className="flex gap-2 pt-1">
							<Button
								variant="primary"
								loading={busy === "save"}
								disabled={busy !== null}
								onClick={save}
							>
								Save
							</Button>
							<Button
								loading={busy === "test"}
								disabled={busy !== null}
								onClick={test}
							>
								Test
							</Button>
						</div>
					)}
				</div>
			)}

			{(error || message) && (
				<output
					className={`mt-3 block text-sm ${error ? "text-coral" : "text-green"}`}
				>
					{error || message}
				</output>
			)}

			{capabilities && (
				<div className="mt-6 border-t border-rule">
					<CapabilityRow name="Text" capability={capabilities.text} />
					<CapabilityRow name="Images" capability={capabilities.images} />
					<CapabilityRow
						name="Search by meaning"
						capability={capabilities.search}
					/>
				</div>
			)}

			{settings.hasKey && (
				<div
					className={`flex items-center justify-between border-b border-rule min-h-14 py-2.5 ${capabilities ? "" : "mt-6 border-t"}`}
				>
					<div>
						<div className="text-[14px] font-medium leading-[18px] text-ink">
							Answers across the workspace
						</div>
						<div className="mt-0.5 text-sm leading-4 text-graphite">
							Pages are indexed so AI can cite them.
						</div>
					</div>
					<Switch
						checked={settings.ask}
						onChange={toggleAsk}
						label="Answers across the workspace"
					/>
				</div>
			)}
		</div>
	);
}

function CapabilityRow({
	name,
	capability,
}: {
	name: string;
	capability: Capability;
}) {
	return (
		<div className="flex items-center justify-between gap-6 border-b border-rule min-h-14 py-2.5">
			<div className="min-w-0">
				<div className="text-[14px] font-medium leading-[18px] text-ink">
					{name}
				</div>
				<div className="mt-0.5 truncate font-mono text-xs text-pencil">
					{capability.model || "None"}
				</div>
			</div>
			<div
				className={`flex shrink-0 items-center gap-1.5 text-sm ${capability.ok ? "text-green" : "text-pencil"}`}
			>
				{capability.ok && <Spark size={11} />}
				{capability.detail}
			</div>
		</div>
	);
}

function Labeled({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: (id: string) => React.ReactNode;
}) {
	const id = `ai-${label.toLowerCase().replace(/\s+/g, "-")}`;
	return (
		<div>
			<label
				htmlFor={id}
				className="mb-1 block text-sm leading-4 text-graphite"
			>
				{label}
			</label>
			{children(id)}
			{hint && <p className="mt-1 text-xs leading-4 text-pencil">{hint}</p>}
		</div>
	);
}
