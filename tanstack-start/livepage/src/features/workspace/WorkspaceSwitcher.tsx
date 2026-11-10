// The workspace menu at the top of the sidebar (boards 31 and 76).
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronsUpDown, PlusIcon } from "#/components/icons";
import { CreateWorkspaceDialog } from "#/components/shell/sidebar";
import { useWorkspace } from "#/components/shell/workspace-context";
import { colorFor, initials, Popover, useMenu } from "#/components/ui";
import { submitSignOut } from "#/functions/session";
import { listPresences } from "#/lib/browser-appwrite";
import type { Workspace } from "#/lib/types";
import { useExtras } from "./extras";
import { fetchWorkspaceCounts } from "./functions";

// A workspace's picture, or the first letter on its color.
export function WorkspaceMark({
	workspace,
	size = 24,
}: {
	workspace: Pick<Workspace, "id" | "name" | "icon">;
	size?: number;
}) {
	const style = {
		width: size,
		height: size,
		fontSize: Math.round(size * 0.45),
	};
	if (workspace.icon?.startsWith("file:"))
		return (
			<img
				src={`/api/files/${workspace.icon.slice(5)}`}
				alt=""
				style={style}
				className="shrink-0 rounded-md object-cover"
			/>
		);
	return (
		<span
			aria-hidden="true"
			style={{ ...style, backgroundColor: colorFor(workspace.id) }}
			className="flex shrink-0 items-center justify-center rounded-md font-semibold text-paper"
		>
			{initials(workspace.name).slice(0, 1)}
		</span>
	);
}

function describe(members: number | undefined, here: number) {
	if (members === undefined) return "";
	if (members <= 1) return "Just you";
	const base = `${members} members`;
	return here > 0 ? `${base}, ${here} here now` : base;
}

export function WorkspaceSwitcher() {
	const { workspace, workspaces, viewer } = useWorkspace();
	const { unread } = useExtras();
	const router = useRouter();
	const menu = useMenu();
	const [counts, setCounts] = useState<Record<string, number>>({});
	const [here, setHere] = useState<Record<string, number>>({});
	const [creating, setCreating] = useState(false);

	const load = useCallback(() => {
		fetchWorkspaceCounts()
			.then(setCounts)
			.catch(() => undefined);
		listPresences()
			.then((rows) => {
				const next: Record<string, Set<string>> = {};
				for (const row of rows) {
					const id = (row.metadata as { workspaceId?: string })?.workspaceId;
					if (!id) continue;
					next[id] = (next[id] ?? new Set()).add(row.userId);
				}
				setHere(
					Object.fromEntries(
						Object.entries(next).map(([id, set]) => [id, set.size]),
					),
				);
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		if (menu.open) load();
	}, [menu.open, load]);

	const signOut = async () => {
		await submitSignOut();
		window.location.assign("/login");
	};

	return (
		<>
			<button
				ref={menu.anchor}
				type="button"
				aria-haspopup="menu"
				aria-expanded={menu.open}
				onClick={menu.toggle}
				className="flex h-9 items-center gap-2 rounded-md px-2 text-base font-semibold text-ink hover:bg-wash-2"
			>
				<WorkspaceMark workspace={workspace} size={22} />
				<span className="min-w-0 flex-1 truncate text-left">
					{workspace.name}
				</span>
				<ChevronsUpDown size={14} className="shrink-0 text-pencil" />
			</button>
			<Popover
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				className="w-[320px] max-w-[calc(100vw-32px)] rounded-[12px] border border-rule bg-paper p-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.12)]"
			>
				<div className="truncate px-2 pb-1.5 pt-1 text-xs text-pencil">
					{viewer.email}
				</div>
				<div
					className="flex max-h-[320px] flex-col gap-0.5 overflow-auto"
					role="menu"
				>
					{workspaces.map((item) => {
						const active = item.id === workspace.id;
						const count = unread[item.id] ?? 0;
						return (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								onClick={() => {
									menu.close();
									if (!active)
										router.navigate({
											to: "/w/$workspaceId",
											params: { workspaceId: item.id },
										});
								}}
								className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${active ? "bg-link-soft" : "hover:bg-wash"}`}
							>
								<WorkspaceMark workspace={item} size={28} />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-base font-medium leading-[18px] text-ink">
										{item.name}
									</span>
									<span className="block truncate text-sm leading-4 text-graphite">
										{describe(counts[item.id], here[item.id] ?? 0)}
									</span>
								</span>
								{count > 0 && (
									<span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-xs font-medium text-white">
										{count}
									</span>
								)}
							</button>
						);
					})}
				</div>
				<div className="my-1.5 border-t border-rule" />
				<button
					type="button"
					onClick={() => {
						menu.close();
						setCreating(true);
					}}
					className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base text-graphite hover:bg-wash hover:text-ink"
				>
					<PlusIcon size={13} />
					New workspace
				</button>
				<button
					type="button"
					onClick={signOut}
					className="flex h-8 w-full items-center rounded-md px-2 text-base text-graphite hover:bg-wash hover:text-ink"
				>
					Sign out
				</button>
			</Popover>
			<CreateWorkspaceDialog
				open={creating}
				onClose={() => setCreating(false)}
			/>
		</>
	);
}
