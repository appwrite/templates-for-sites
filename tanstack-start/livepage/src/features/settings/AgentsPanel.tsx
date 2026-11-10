import { useCallback, useEffect, useState } from "react";
import { SparkleFilled } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, Button, useToast } from "#/components/ui";
import { timeAgo } from "#/features/workspace/format";
import {
	fetchAgents,
	submitDisconnectAgent,
	submitEnableAgents,
} from "#/functions/settings";
import { copyText } from "#/lib/browser";
import { errorText } from "#/lib/errors";
import { ConfirmDialog, PanelError, PanelSkeleton, PanelTitle } from "./ui";

type State = Awaited<ReturnType<typeof fetchAgents>>;

export function AgentsPanel() {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [state, setState] = useState<State | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [leaving, setLeaving] = useState<State["agents"][number] | null>(null);
	const workspaceId = workspace.id;

	const load = useCallback(() => {
		fetchAgents({ data: { workspaceId } })
			.then((next) => {
				setState(next);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, [workspaceId]);

	useEffect(load, [load]);

	if (error && !state) return <PanelError message={error} onRetry={load} />;
	if (!state) return <PanelSkeleton />;

	const available = state.state.kind === "on";

	const enable = async () => {
		setBusy(true);
		try {
			await submitEnableAgents();
			load();
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		try {
			await copyText(state.mcpUrl);
			toast.show("Copied.");
		} catch {
			toast.show("Your browser blocked copying.", { tone: "error" });
		}
	};

	if (!available) {
		return (
			<>
				<PanelTitle title="Agents" />
				<div className="w-full max-w-[620px] border-t border-rule pt-5 text-base leading-[22px] text-graphite">
					{state.state.kind === "self-hosted" && (
						<>
							<h2 className="text-md font-semibold text-ink">
								Agents need Appwrite Cloud
							</h2>
							<p className="mt-2">
								{workspace.name} runs on self-hosted Appwrite. Agents sign in
								through Appwrite Cloud's OAuth server, so they can't connect to
								this workspace.
							</p>
							<p className="mt-2">
								Everything else in {workspace.name} is unaffected. Pages,
								databases, comments, live editing and AI all keep working.
							</p>
							<a
								href="https://appwrite.io/docs/advanced/migrations/self-hosted"
								target="_blank"
								rel="noreferrer"
								className="mt-2 inline-block text-link hover:underline"
							>
								Move to Appwrite Cloud
							</a>
						</>
					)}
					{state.state.kind === "in-use" && (
						<>
							<h2 className="text-md font-semibold text-ink">
								Another site is using agents here
							</h2>
							<p className="mt-2">
								This Appwrite project's sign-in for agents points at{" "}
								{state.state.host}. A project has one, so agents can't connect
								here until it's freed up.
							</p>
						</>
					)}
					{state.state.kind === "off" && (
						<>
							<h2 className="text-md font-semibold text-ink">Agents are off</h2>
							<p className="mt-2">
								Turn them on to let coding agents read and edit {workspace.name}{" "}
								as the person who connects them.
							</p>
							{state.state.canEnable ? (
								state.manager && (
									<Button
										variant="primary"
										className="mt-3"
										loading={busy}
										onClick={enable}
									>
										Turn on agents
									</Button>
								)
							) : (
								<p className="mt-2">
									This site's API key was given back after setup. Add these
									scopes to it first: {state.state.scopes.join(", ")}.
									{state.state.siteSettings && (
										<>
											{" "}
											<a
												href={state.state.siteSettings}
												target="_blank"
												rel="noreferrer"
												className="text-link hover:underline"
											>
												Open site settings
											</a>
										</>
									)}
								</p>
							)}
						</>
					)}
				</div>
			</>
		);
	}

	return (
		<>
			<PanelTitle
				title="Agents"
				subtitle={`Let coding agents read and edit ${workspace.name}. Each agent gets the access of the person who connects it.`}
			/>
			<div className="w-full max-w-[560px]">
				<div className="mb-1.5 text-sm font-medium text-ink">MCP URL</div>
				<div className="flex h-[40px] items-center gap-2 rounded-md border border-rule-strong pl-3 pr-1">
					<code className="min-w-0 flex-1 truncate font-mono text-base text-ink">
						{state.mcpUrl}
					</code>
					<Button variant="primary" className="h-[30px]" onClick={copy}>
						Copy
					</Button>
				</div>
			</div>
			<div>
				<h2 className="mb-2 text-sm font-medium text-ink">How to connect</h2>
				<ol className="flex flex-col gap-2 text-base text-ink">
					{[
						"Add the URL above to your agent as an MCP server.",
						`Sign in to ${workspace.name} when your agent opens the browser.`,
						"The agent shows up here. Disconnect it any time.",
					].map((line, i) => (
						<li key={line} className="flex gap-3">
							<span className="w-3 text-graphite">{i + 1}</span>
							{line}
						</li>
					))}
				</ol>
			</div>
			<div className="w-full overflow-x-auto">
				{state.agents.length === 0 ? (
					<p className="border-t border-rule pt-4 text-sm text-pencil">
						No agents connected yet.
					</p>
				) : (
					<table className="w-full min-w-[560px] border-collapse">
						<thead>
							<tr className="border-b border-rule text-left text-sm text-graphite">
								<th className="pb-2 font-normal">Connected agents</th>
								<th className="w-[200px] pb-2 font-normal">Connected by</th>
								<th className="w-[160px] pb-2 font-normal">Last used</th>
								<th className="w-[80px] pb-2" />
							</tr>
						</thead>
						<tbody>
							{state.agents.map((agent) => (
								<tr key={agent.id} className="border-b border-rule">
									<td className="py-3">
										<div className="flex items-center gap-2.5 text-base font-medium text-ink">
											<span className="flex size-6 items-center justify-center rounded-sm bg-link-soft text-link">
												<SparkleFilled size={12} />
											</span>
											{agent.name}
										</div>
									</td>
									<td>
										<div className="flex items-center gap-2 text-base text-ink">
											<Avatar
												id={agent.connectedBy}
												name={agent.connectedByName}
												size={20}
											/>
											{agent.connectedByName}
										</div>
									</td>
									<td className="text-base text-graphite">
										{agent.lastUsedAt ? timeAgo(agent.lastUsedAt) : "Not yet"}
									</td>
									<td className="text-right">
										{(state.manager ||
											agent.connectedBy === state.viewerId) && (
											<button
												type="button"
												onClick={() => setLeaving(agent)}
												className="text-sm text-link hover:underline"
											>
												Disconnect
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
			{leaving && (
				<ConfirmDialog
					open
					onClose={() => setLeaving(null)}
					title={`Disconnect ${leaving.name}?`}
					description="It loses access right away. It can connect again if someone signs in for it."
					action="Disconnect"
					onConfirm={async () => {
						await submitDisconnectAgent({
							data: { workspaceId, id: leaving.id },
						});
						load();
					}}
				/>
			)}
		</>
	);
}
