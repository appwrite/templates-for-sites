// Favorites and recently opened pages, at the top of the page tree. Hidden until there's something
// to show, so a new workspace stays quiet.
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageIcon, TableIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { displayName } from "#/lib/permissions";
import type { Page } from "#/lib/types";
import { useExtras } from "./extras";

const RECENT_COUNT = 5;

export function SidebarPins() {
	const { pages, activePageId, viewer } = useWorkspace();
	const { favorites, recents } = useExtras();

	const { pinned, recent, sharedWithMe } = useMemo(() => {
		const byId = new Map(pages.map((p) => [p.id, p]));
		const pinned = favorites.flatMap((id) => byId.get(id) ?? []);
		const recent = recents
			.filter((visit) => !favorites.includes(visit.pageId))
			.flatMap((visit) => byId.get(visit.pageId) ?? [])
			.slice(0, RECENT_COUNT);
		// Pages someone shared with this person alone have no place in the tree, which shows the
		// workspace's pages and their own private ones.
		const sharedWithMe = pages.filter(
			(p) => p.visibility !== "workspace" && p.createdBy !== viewer.userId,
		);
		return { pinned, recent, sharedWithMe };
	}, [pages, favorites, recents, viewer.userId]);

	if (!pinned.length && !recent.length && !sharedWithMe.length) return null;
	return (
		<div className="flex max-h-[34%] shrink-0 flex-col gap-3 overflow-y-auto">
			<Group label="Favorites" pages={pinned} activeId={activePageId} />
			<Group
				label="Shared with you"
				pages={sharedWithMe}
				activeId={activePageId}
			/>
			<Group label="Recent" pages={recent} activeId={activePageId} />
		</div>
	);
}

function Group({
	label,
	pages,
	activeId,
}: {
	label: string;
	pages: Page[];
	activeId: string | null;
}) {
	if (!pages.length) return null;
	return (
		<div className="flex flex-col gap-px">
			<div className="px-2 pb-1 text-xs font-medium text-pencil">{label}</div>
			{pages.map((page) => (
				<Link
					key={page.id}
					to="/p/$pageId"
					params={{ pageId: page.id }}
					className={`flex h-[30px] coarse:h-10 items-center gap-2 rounded-md px-2 text-base ${
						page.id === activeId
							? "bg-link-soft font-medium text-link"
							: "text-ink hover:bg-wash-2"
					}`}
				>
					<span className="flex size-[15px] shrink-0 items-center justify-center text-graphite">
						{page.icon && !page.icon.startsWith("file:") ? (
							<span className="text-sm leading-none">{page.icon}</span>
						) : page.kind === "database" ? (
							<TableIcon size={15} />
						) : (
							<PageIcon size={15} />
						)}
					</span>
					<span className="truncate">{displayName(page)}</span>
				</Link>
			))}
		</div>
	);
}
