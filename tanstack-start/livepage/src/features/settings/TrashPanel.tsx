import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "#/components/shell/workspace-context";
import { Avatar, useToast } from "#/components/ui";
import type { PurgeState } from "#/features/settings/server/trash";
import { timeAgo } from "#/features/workspace/format";
import {
	fetchMembers,
	fetchTrash,
	type MemberRow,
	submitDeleteForever,
	submitRestore,
} from "#/functions/settings";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import {
	ConfirmDialog,
	PanelError,
	PanelSkeleton,
	PanelTitle,
	TextLink,
} from "./ui";

type Trash = Awaited<ReturnType<typeof fetchTrash>>;
type Item = Trash["pages"][number];

const DAY_MS = 86_400_000;
const daysLeft = (trashedAt: string) =>
	Math.max(0, 30 - Math.floor((Date.now() - Date.parse(trashedAt)) / DAY_MS));

export function TrashPanel() {
	const { workspace } = useWorkspace();
	const toast = useToast();
	const [trash, setTrash] = useState<Trash | null>(null);
	const [members, setMembers] = useState<MemberRow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [forever, setForever] = useState<Item | null>(null);
	const [purging, setPurging] = useState<{
		title: string;
		done: number;
		total: number;
		retry?: () => void;
	} | null>(null);
	const workspaceId = workspace.id;

	const load = useCallback(() => {
		fetchTrash({ data: { workspaceId } })
			.then((next) => {
				setTrash(next);
				setError(null);
			})
			.catch((err) => setError(errorText(err)));
	}, [workspaceId]);

	useEffect(load, [load]);
	useEffect(() => {
		fetchMembers({ data: { workspaceId } })
			.then(setMembers)
			.catch(() => undefined);
	}, [workspaceId]);

	const names = useMemo(
		() => new Map(members.map((m) => [m.userId, m.name || m.email])),
		[members],
	);

	if (error && !trash) return <PanelError message={error} onRetry={load} />;
	if (!trash) return <PanelSkeleton />;

	// A large tree takes several requests. The state from the last one continues it.
	const purge = async (item: Item, start?: PurgeState) => {
		let state = start;
		const title = displayName(item);
		setPurging({ title, done: state?.done ?? 0, total: state?.total ?? 0 });
		try {
			for (;;) {
				const result = await submitDeleteForever({
					data: { pageId: item.id, state },
				});
				state = result.state;
				setPurging({ title, done: state.done, total: state.total });
				if (result.done) break;
			}
			setPurging(null);
			load();
		} catch (err) {
			setPurging({
				title,
				done: state?.done ?? 0,
				total: state?.total ?? 0,
				retry: () => void purge(item, state),
			});
			toast.show(errorText(err), { tone: "error" });
		}
	};

	const restore = async (item: Item) => {
		setTrash({ ...trash, pages: trash.pages.filter((p) => p.id !== item.id) });
		try {
			await submitRestore({ data: { pageId: item.id } });
			toast.show(`Restored ${displayName(item)}.`);
		} catch (err) {
			toast.show(errorText(err), { tone: "error" });
			load();
		}
	};

	return (
		<>
			<PanelTitle
				title="Trash"
				subtitle="Deleted pages stay here for 30 days, then they're removed for good."
			/>
			{purging && (
				<output className="mb-3 block text-sm text-graphite" data-purge>
					Deleting {purging.title}: {purging.done.toLocaleString()} of{" "}
					{purging.total.toLocaleString()}. Keep this tab open.{" "}
					{purging.retry && (
						<button
							type="button"
							onClick={purging.retry}
							className="text-accent hover:underline"
						>
							Try again
						</button>
					)}
				</output>
			)}
			{trash.pages.length === 0 ? (
				<p className="text-sm text-pencil">Nothing in the trash.</p>
			) : (
				<div className="w-full overflow-x-auto">
					<table className="w-full min-w-[680px] border-collapse">
						<thead>
							<tr className="border-b border-rule text-left text-sm text-graphite">
								<th className="pb-2 font-normal">Page</th>
								<th className="w-[170px] pb-2 font-normal">Deleted by</th>
								<th className="w-[110px] pb-2 font-normal">When</th>
								<th className="w-[110px] pb-2 font-normal">Removed in</th>
								<th className="w-[170px] pb-2" />
							</tr>
						</thead>
						<tbody>
							{trash.pages.map((item) => {
								const left = daysLeft(item.trashedAt as string);
								const who = names.get(item.updatedBy) ?? "Someone";
								return (
									<tr key={item.id} className="border-b border-rule">
										<td className="py-2.5">
											<div className="truncate text-base leading-[18px] text-ink">
												{displayName(item)}
											</div>
											{item.path && (
												<div className="truncate text-sm leading-4 text-graphite">
													{item.path}
												</div>
											)}
										</td>
										<td>
											<div className="flex items-center gap-2 text-base text-ink">
												<Avatar id={item.updatedBy} name={who} size={20} />
												<span className="truncate">{who}</span>
											</div>
										</td>
										<td className="text-base text-graphite">
											{timeAgo(item.trashedAt as string)}
										</td>
										<td
											className={`text-base ${left <= 1 ? "text-coral" : "text-graphite"}`}
										>
											{left} {left === 1 ? "day" : "days"}
										</td>
										<td className="text-right">
											<TextLink onClick={() => void restore(item)}>
												Restore
											</TextLink>
											<button
												type="button"
												onClick={() => setForever(item)}
												className="ml-4 text-sm text-graphite hover:text-ink"
											>
												Delete forever
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
			{forever && (
				<ConfirmDialog
					open
					onClose={() => setForever(null)}
					title={`Delete ${displayName(forever)} forever?`}
					description="Its text, history, comments and files all go, along with anything nested under it. This can't be undone."
					action="Delete forever"
					onConfirm={async () => {
						const item = forever;
						setForever(null);
						void purge(item);
					}}
				/>
			)}
		</>
	);
}
