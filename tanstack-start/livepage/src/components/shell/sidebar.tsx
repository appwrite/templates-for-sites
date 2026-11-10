import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useAiStatus } from "#/features/ai/client";
import { useExtras } from "#/features/workspace/extras";
import { SidebarPins } from "#/features/workspace/SidebarPins";
import { WorkspaceSwitcher } from "#/features/workspace/WorkspaceSwitcher";
import { submitSignOut } from "#/functions/session";
import { submitCreateWorkspace } from "#/functions/workspaces";
import { errorText } from "#/lib/errors";
import { displayName } from "#/lib/permissions";
import { applyTheme, isDark } from "#/lib/theme";
import type { Page } from "#/lib/types";
import {
	ChevronsUpDown,
	GearIcon,
	HomeIcon,
	InboxIcon,
	LogoutIcon,
	MapIcon,
	MoonIcon,
	PersonIcon,
	PlusIcon,
	SearchIcon,
	TemplatesIcon,
	TrashIcon,
} from "../icons";
import {
	Avatar,
	AvatarStack,
	Button,
	Dialog,
	Field,
	Input,
	Menu,
	type MenuItem,
	Skeleton,
	useMenu,
	useToast,
} from "../ui";
import { PageTree } from "./page-tree";
import { useWorkspace } from "./workspace-context";

function NavLink({
	to,
	section,
	icon,
	label,
	badge,
}: {
	to: string;
	section?: string;
	icon: React.ReactNode;
	label: string;
	badge?: number;
}) {
	const { workspace } = useWorkspace();
	return (
		<Link
			to={to}
			params={{ workspaceId: workspace.id, section }}
			activeOptions={{ exact: to === "/w/$workspaceId" }}
			className="flex h-8 items-center gap-2.5 rounded-md px-2 text-base leading-[18px] text-graphite hover:bg-wash-2 coarse:h-10 coarse:gap-3 coarse:text-[15px]"
			activeProps={{ className: "bg-link-soft font-medium text-link" }}
			inactiveProps={{ className: "text-graphite" }}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{badge ? (
				<span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-xs font-semibold text-white">
					{badge}
				</span>
			) : null}
		</Link>
	);
}

function SectionHeader({
	label,
	onAdd,
}: {
	label: string;
	onAdd?: () => void;
}) {
	return (
		<div className="flex h-6 items-center px-2">
			<div className="flex-1 text-xs font-medium text-pencil">{label}</div>
			{onAdd && (
				<button
					type="button"
					aria-label={`Add page to ${label}`}
					onClick={onAdd}
					className="flex h-5 w-5 items-center justify-center rounded-sm text-pencil hover:bg-wash-2 coarse:-mr-2 coarse:size-10"
				>
					<PlusIcon size={14} />
				</button>
			)}
		</div>
	);
}

export function Sidebar() {
	const {
		workspace,
		pages,
		pagesLoading,
		pagesError,
		peers,
		createPage,
		viewer,
	} = useWorkspace();
	const router = useRouter();
	const { unread } = useExtras();
	const ai = useAiStatus(workspace.id);
	const guest = workspace.role === "guest";

	const creating = useRef(false);
	const openNewPage = async (
		sectionId: string | null,
		visibility: Page["visibility"] = "workspace",
	) => {
		// A double click on + still makes one page.
		if (creating.current) return;
		creating.current = true;
		const siblings = pages.filter(
			(p) => !p.parentId && (p.sectionId ?? null) === sectionId,
		);
		const last = Math.max(0, ...siblings.map((p) => p.position));
		const page = await createPage({
			sectionId,
			position: last + 1,
			visibility,
		});
		creating.current = false;
		if (page)
			router.navigate({ to: "/p/$pageId", params: { pageId: page.id } });
	};

	const shared = useMemo(
		() => pages.filter((p) => p.visibility === "workspace"),
		[pages],
	);
	const privatePages = useMemo(
		() =>
			pages.filter(
				(p) => p.visibility !== "workspace" && p.createdBy === viewer.userId,
			),
		[pages, viewer.userId],
	);

	const livePages = useMemo(() => {
		const byPage = new Map<string, { id: string; name: string }[]>();
		for (const peer of peers) {
			if (!peer.pageId) continue;
			const list = byPage.get(peer.pageId) ?? [];
			list.push({ id: peer.userId, name: peer.name });
			byPage.set(peer.pageId, list);
		}
		return [...byPage.entries()]
			.map(([id, people]) => ({ page: pages.find((p) => p.id === id), people }))
			.filter(
				(
					entry,
				): entry is { page: Page; people: { id: string; name: string }[] } =>
					Boolean(entry.page),
			);
	}, [peers, pages]);

	return (
		<aside className="flex h-full w-64 shrink-0 flex-col gap-4 border-r border-rule bg-wash px-2 pb-2 pt-3 max-md:w-[min(328px,calc(100vw-48px))] max-md:gap-2 max-md:overflow-y-auto max-md:border-r-0 max-md:px-2.5 max-md:pb-[max(8px,env(safe-area-inset-bottom))] max-md:pt-[max(12px,env(safe-area-inset-top))] max-md:[&>*]:shrink-0">
			<WorkspaceSwitcher />
			<nav className="flex flex-col gap-px" aria-label="Workspace">
				<button
					type="button"
					onClick={() =>
						window.dispatchEvent(new CustomEvent("livepage:command"))
					}
					className="flex h-8 items-center gap-2.5 rounded-md border border-rule bg-paper px-2 text-left hover:border-rule-strong coarse:mb-1 coarse:h-10 coarse:gap-3 coarse:rounded-lg"
				>
					<SearchIcon className="text-graphite" />
					<span className="min-w-0 flex-1 truncate text-sm leading-4 text-pencil coarse:text-[15px]">
						{ai && !(ai.state === "ready" && ai.ask)
							? "Search"
							: "Search or ask"}
					</span>
					<span className="text-xs text-pencil max-md:hidden coarse:hidden">
						⌘K
					</span>
				</button>
				<NavLink
					to="/w/$workspaceId"
					icon={<HomeIcon className="text-graphite" />}
					label="Home"
				/>
				<NavLink
					to="/w/$workspaceId/inbox"
					icon={<InboxIcon className="text-graphite" />}
					label="Inbox"
					badge={unread[workspace.id]}
				/>
				<NavLink
					to="/w/$workspaceId/map"
					icon={<MapIcon className="text-graphite" />}
					label="Map"
				/>
			</nav>
			{livePages.length > 0 && (
				<div className="flex flex-col gap-px">
					<div className="flex h-6 items-center gap-1.5 px-2">
						<span className="h-1.5 w-1.5 rounded-full bg-green" />
						<span className="text-xs font-medium text-pencil">Live now</span>
					</div>
					{livePages.map(({ page, people }) => (
						<Link
							key={page.id}
							to="/p/$pageId"
							params={{ pageId: page.id }}
							className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-wash-2 coarse:h-10"
						>
							<span className="min-w-0 flex-1 truncate text-base leading-[18px] text-ink coarse:text-[15px]">
								{displayName(page)}
							</span>
							<AvatarStack
								people={people}
								size={20}
								max={3}
								ringColor="var(--color-wash)"
							/>
						</Link>
					))}
				</div>
			)}
			<SidebarPins />
			<div className="min-h-0 flex-1 overflow-y-auto max-md:flex-none max-md:overflow-visible">
				{pagesLoading ? (
					<div className="flex flex-col gap-3 p-2">
						{[0, 1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-4" />
						))}
					</div>
				) : pagesError ? (
					<p className="p-2 text-sm text-coral">{pagesError}</p>
				) : (
					<>
						{workspace.sections.map((section) => {
							const list = shared.filter(
								(p) =>
									(p.sectionId ?? workspace.sections[0]?.id) === section.id ||
									(!workspace.sections.some((s) => s.id === p.sectionId) &&
										section.id === workspace.sections[0]?.id),
							);
							return (
								<div key={section.id} className="mt-3 first:mt-0">
									<SectionHeader
										label={section.name}
										onAdd={
											guest ? undefined : () => void openNewPage(section.id)
										}
									/>
									<PageTree
										section={section}
										pages={normalizeSection(list, section.id)}
									/>
								</div>
							);
						})}
						<div className="mt-3">
							<SectionHeader
								label="Private"
								onAdd={
									guest ? undefined : () => void openNewPage(null, "private")
								}
							/>
							<PageTree
								section={null}
								pages={normalizeSection(privatePages, null)}
							/>
						</div>
						{!pages.length && (
							<p className="px-2 pt-3 text-sm text-pencil">
								{guest
									? "Pages shared with you show up here."
									: "No pages yet. Use + to add one."}
							</p>
						)}
					</>
				)}
			</div>
			<nav
				className="flex shrink-0 flex-col gap-px"
				aria-label="Workspace tools"
			>
				{workspace.role !== "guest" && (
					<>
						<NavLink
							to="/w/$workspaceId/templates"
							icon={<TemplatesIcon className="text-graphite" />}
							label="Templates"
						/>
						<NavLink
							to="/w/$workspaceId/settings/$section"
							section="trash"
							icon={<TrashIcon className="text-graphite" />}
							label="Trash"
						/>
					</>
				)}
				<NavLink
					to="/w/$workspaceId/settings"
					icon={<GearIcon className="text-graphite" />}
					label="Settings"
				/>
			</nav>
			<AccountRow name={viewer.name} userId={viewer.userId} />
		</aside>
	);
}

// Top-level pages of a list belong to one section, so the tree only has to match by parent.
function normalizeSection(pages: Page[], sectionId: string | null) {
	return pages.map((p) => (p.parentId ? p : { ...p, sectionId }));
}

export function CreateWorkspaceDialog({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const router = useRouter();
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="New workspace"
			description="A workspace is shared with the people you invite."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					try {
						const created = await submitCreateWorkspace({ data: { name } });
						onClose();
						await router.invalidate();
						router.navigate({
							to: "/w/$workspaceId",
							params: { workspaceId: created.id },
						});
					} catch (err) {
						setError(errorText(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Name" error={error}>
					{(id) => (
						<Input
							id={id}
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							maxLength={128}
						/>
					)}
				</Field>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" variant="primary" loading={busy}>
						Create workspace
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

function AccountRow({ name, userId }: { name: string; userId: string }) {
	const { workspace } = useWorkspace();
	const menu = useMenu();
	const router = useRouter();
	const toast = useToast();
	// Read when the menu opens: the server doesn't know the theme.
	const dark = menu.open && isDark();
	const openSettings = (section: string) =>
		router.navigate({
			to: "/w/$workspaceId/settings/$section",
			params: { workspaceId: workspace.id, section },
		});
	const items: MenuItem[] = [
		{
			id: "profile",
			label: "Profile",
			icon: <PersonIcon size={14} />,
			onSelect: () => openSettings("profile"),
		},
		{
			id: "settings",
			label: "Settings",
			icon: <GearIcon size={14} />,
			onSelect: () =>
				router.navigate({
					to: "/w/$workspaceId/settings",
					params: { workspaceId: workspace.id },
				}),
		},
		{
			id: "theme",
			label: dark ? "Switch to light" : "Switch to dark",
			icon: <MoonIcon size={14} />,
			onSelect: () => applyTheme(isDark() ? "light" : "dark"),
		},
		{ type: "separator", id: "s" },
		{
			id: "out",
			label: "Sign out",
			icon: <LogoutIcon size={14} />,
			onSelect: async () => {
				try {
					await submitSignOut();
					await router.invalidate();
					router.navigate({ to: "/login" });
				} catch (err) {
					toast.show(errorText(err), { tone: "error" });
				}
			},
		},
	];
	return (
		<div className="shrink-0 border-t border-rule pt-1 max-md:sticky max-md:-bottom-2 max-md:z-10 max-md:-mx-2.5 max-md:mt-auto max-md:bg-wash max-md:px-2.5">
			<button
				ref={menu.anchor}
				type="button"
				aria-haspopup="menu"
				aria-expanded={menu.open}
				aria-label={`Account menu for ${name}`}
				onClick={menu.toggle}
				className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left hover:bg-wash-2 coarse:h-12"
			>
				<Avatar id={userId} name={name} size={26} />
				<span className="min-w-0 flex-1 truncate text-base leading-[18px] text-ink">
					{name}
				</span>
				<ChevronsUpDown size={14} className="shrink-0 text-pencil" />
			</button>
			<Menu
				anchor={menu.anchor}
				open={menu.open}
				onClose={menu.close}
				items={items}
				side="top"
				align="start"
			/>
		</div>
	);
}
