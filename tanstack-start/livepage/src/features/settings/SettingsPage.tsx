// Settings: a left rail of sections and one panel (boards 58 to 5G and 30).
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { CloseIcon } from "#/components/icons";
import { useWorkspace } from "#/components/shell/workspace-context";
import { AiSettings } from "#/features/ai/AiSettings";
import type { Role } from "#/lib/types";
import { AgentsPanel } from "./AgentsPanel";
import { FeaturesPanel } from "./FeaturesPanel";
import { GeneralPanel } from "./GeneralPanel";
import { MembersPanel } from "./MembersPanel";
import { ProfilePanel } from "./ProfilePanel";
import { SecurityPanel } from "./SecurityPanel";
import { TeamspacesPanel } from "./TeamspacesPanel";
import { TransferPanel } from "./TransferPanel";
import { TrashPanel } from "./TrashPanel";

const WORKSPACE_ITEMS = [
	["general", "General"],
	["members", "Members"],
	["teamspaces", "Teamspaces"],
	["ai", "AI"],
	["features", "Features"],
	["agents", "Agents"],
	["security", "Security"],
	["import", "Import and export"],
	["trash", "Trash"],
] as const;

// What each role can use. Someone who can't use a section isn't shown it.
function sectionsFor(role: Role) {
	if (role === "owner" || role === "admin")
		return WORKSPACE_ITEMS.map(([id]) => id as string);
	if (role === "guest") return ["security"];
	return WORKSPACE_ITEMS.map(([id]) => id as string).filter(
		(id) => id !== "ai" && id !== "features",
	);
}

const PANELS: Record<string, () => React.ReactNode> = {
	general: GeneralPanel,
	members: MembersPanel,
	teamspaces: TeamspacesPanel,
	ai: AiSettings,
	features: FeaturesPanel,
	agents: AgentsPanel,
	security: SecurityPanel,
	import: TransferPanel,
	trash: TrashPanel,
	profile: ProfilePanel,
};

export function SettingsPage({ section }: { section: string }) {
	const { workspace } = useWorkspace();
	const allowed = [...sectionsFor(workspace.role), "profile"];
	const active = allowed.includes(section) ? section : allowed[0];
	const Panel = PANELS[active];

	useEffect(() => {
		document.title = `Settings · ${workspace.name}`;
	}, [workspace.name]);

	return (
		<div className="lp-hit flex min-h-full flex-col md:flex-row">
			<nav
				aria-label="Settings"
				className="flex w-full shrink-0 flex-col gap-[2px] border-rule bg-wash px-2 py-[20px] scrollbar-none max-md:sticky max-md:top-0 max-md:z-10 max-md:flex-row max-md:items-center max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:py-1.5 max-md:pt-[max(6px,env(safe-area-inset-top))] md:min-h-dvh md:w-[240px] md:border-r"
			>
				<div className="flex items-center justify-between px-2 py-1 max-md:order-last max-md:sticky max-md:-right-2 max-md:bg-wash max-md:p-0 max-md:pr-1 max-md:pl-1">
					<span className="truncate text-xs font-medium text-pencil max-md:hidden">
						{workspace.name}
					</span>
					<Link
						to="/w/$workspaceId"
						params={{ workspaceId: workspace.id }}
						aria-label="Close settings"
						className="flex size-6 items-center justify-center rounded-sm text-pencil hover:bg-wash-2 hover:text-ink coarse:size-10"
					>
						<CloseIcon size={13} />
					</Link>
				</div>
				{WORKSPACE_ITEMS.filter(([id]) => allowed.includes(id)).map(
					([id, label]) => (
						<NavItem key={id} id={id} label={label} active={active === id} />
					),
				)}
				<div className="px-2 pb-1 pt-[14px] text-xs font-medium text-pencil max-md:hidden">
					You
				</div>
				<NavItem id="profile" label="Profile" active={active === "profile"} />
			</nav>
			<div className="min-w-0 flex-1 px-5 py-6 md:px-[56px] md:py-[40px]">
				<div className="flex w-full max-w-[848px] flex-col gap-[22px]">
					<Panel key={workspace.id} />
				</div>
			</div>
		</div>
	);
}

function NavItem({
	id,
	label,
	active,
}: {
	id: string;
	label: string;
	active: boolean;
}) {
	const { workspace } = useWorkspace();
	return (
		<Link
			to="/w/$workspaceId/settings/$section"
			params={{ workspaceId: workspace.id, section: id }}
			ref={(el) => {
				// On a phone the sections are a sideways strip; keep the open one in sight.
				if (active) el?.scrollIntoView({ block: "nearest", inline: "center" });
			}}
			aria-current={active ? "page" : undefined}
			className={`flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-base coarse:h-10 coarse:px-3 coarse:text-[15px] ${
				active
					? "bg-link-soft font-medium text-link"
					: "text-ink hover:bg-wash-2"
			}`}
		>
			{label}
		</Link>
	);
}
