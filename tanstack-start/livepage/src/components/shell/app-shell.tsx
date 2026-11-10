import { Outlet, useLocation, useMatches } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AskHost } from "#/features/ai/ask";
import { CommandPalette } from "#/features/workspace/CommandPalette";
import { ExtrasProvider } from "#/features/workspace/extras";
import { WorkspaceLayer } from "#/features/workspace/WorkspaceLayer";
import type { Viewer, Workspace } from "#/lib/types";
import { LiveProvider, useLive } from "./live-context";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { WorkspaceProvider } from "./workspace-context";

type ShellProps = {
	viewer: Viewer;
	workspaces: Workspace[];
	schemaUpdate?: boolean;
};

// Finds which workspace the current route is in: a /w/$workspaceId param, or the page's own workspace.
function useRouteContext() {
	const matches = useMatches();
	let workspaceId: string | null = null;
	let pageId: string | null = null;
	let hideTopBar = false;
	let hideSidebar = false;
	let title: string | undefined;
	for (const match of matches) {
		const params = match.params as { workspaceId?: string; pageId?: string };
		const data = match.loaderData as
			| {
					workspaceId?: string;
					pageId?: string;
					hideTopBar?: boolean;
					hideSidebar?: boolean;
					title?: string;
			  }
			| undefined;
		workspaceId = params.workspaceId ?? data?.workspaceId ?? workspaceId;
		pageId = params.pageId ?? data?.pageId ?? pageId;
		hideTopBar = hideTopBar || Boolean(data?.hideTopBar);
		hideSidebar = hideSidebar || Boolean(data?.hideSidebar);
		title = data?.title ?? title;
	}
	return { workspaceId, pageId, hideTopBar, hideSidebar, title };
}

export function AppShell({ viewer, workspaces, schemaUpdate }: ShellProps) {
	const { workspaceId, pageId, hideTopBar, hideSidebar, title } =
		useRouteContext();
	const [navOpen, setNavOpen] = useState(false);
	useEffect(() => {
		if (!navOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setNavOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [navOpen]);
	// A phone gets the sidebar as a drawer; any navigation closes it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: closes on every route change
	useEffect(() => setNavOpen(false), [pageId, workspaceId, title]);
	const workspace = workspaces.find((w) => w.id === workspaceId);
	const { pathname } = useLocation();
	// Pages set their own title once loaded; the other screens are named from the path.
	useEffect(() => {
		const section = titleFor(pathname, workspace?.name);
		if (section) document.title = section;
	}, [pathname, workspace?.name]);
	if (!workspace) return <Outlet />;
	return (
		<LiveProvider>
			<WorkspaceProvider
				viewer={viewer}
				workspace={workspace}
				workspaces={workspaces}
				activePageId={pageId}
			>
				<ExtrasProvider>
					<AskHost />
					<CommandPalette />
					<WorkspaceLayer />
					<div className="flex h-dvh min-h-0 w-full">
						{!hideSidebar && (
							<>
								{navOpen && (
									<button
										type="button"
										aria-label="Close menu"
										className="lp-scrim fixed inset-0 z-30 bg-black/40 md:hidden"
										onClick={() => setNavOpen(false)}
									/>
								)}
								{/* biome-ignore lint/a11y/noStaticElementInteractions: closes the drawer when a link inside it is followed */}
								<div
									onClick={(e) => {
										if ((e.target as HTMLElement).closest("a"))
											setNavOpen(false);
									}}
									onKeyDown={undefined}
									className={`z-40 h-full shrink-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-[transform,visibility] max-md:duration-200 max-md:ease-out ${navOpen ? "" : "max-md:invisible max-md:-translate-x-full"}`}
								>
									<Sidebar />
								</div>
							</>
						)}
						<main className="flex min-w-0 flex-1 flex-col">
							{schemaUpdate && (
								<div className="flex items-center justify-between gap-3 border-b border-rule bg-wash px-4 py-2 text-sm text-graphite">
									<span>
										A new version of Livepage needs a small database update.
									</span>
									<a href="/setup" className="text-accent hover:underline">
										Update now
									</a>
								</div>
							)}
							{!hideTopBar && (
								<TopBar title={title} onMenu={() => setNavOpen(true)} />
							)}
							<ReconnectingBanner />
							<div className="min-h-0 flex-1 overflow-auto">
								<Outlet />
							</div>
						</main>
					</div>
				</ExtrasProvider>
			</WorkspaceProvider>
		</LiveProvider>
	);
}

const SCREENS: Record<string, string> = {
	inbox: "Inbox",
	map: "Map",
	comments: "All comments",
	new: "New page",
	templates: "Templates",
};

function titleFor(pathname: string, workspaceName?: string) {
	const parts = pathname.split("/").filter(Boolean);
	if (parts[0] !== "w") return null;
	const screen = parts[2] ? SCREENS[parts[2]] : "Home";
	if (!screen) return null;
	return workspaceName ? `${screen} · ${workspaceName}` : screen;
}

function ReconnectingBanner() {
	const { status, connection } = useLive();
	const [dismissed, setDismissed] = useState(false);
	if (status === "live" && dismissed) setDismissed(false);
	if ((status !== "reconnecting" && status !== "offline") || dismissed)
		return null;
	return (
		<output className="flex h-9 shrink-0 items-center gap-2 border-b border-rule bg-wash px-6 text-sm">
			<span className="h-1.5 w-1.5 rounded-full bg-amber" />
			<span className="flex-1 truncate text-graphite">
				<strong className="font-medium text-ink">Reconnecting.</strong> Your
				changes are saved on this device and will sync when you're back.
			</span>
			<button
				type="button"
				className="text-link"
				onClick={() => {
					setDismissed(true);
					connection?.check();
					setTimeout(() => setDismissed(false), 300);
				}}
			>
				Try now
			</button>
		</output>
	);
}
