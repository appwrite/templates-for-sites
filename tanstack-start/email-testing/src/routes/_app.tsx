import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName, Logo } from "#/components/icons";
import { LiveTokenProvider } from "#/components/live-status";
import { fetchInbox } from "#/functions/inbox";
import { fetchViewer, submitSignOut } from "#/functions/session";
import { initials, splitDomain } from "#/lib/format";

export const Route = createFileRoute("/_app")({
	beforeLoad: async () => ({ viewer: await fetchViewer() }),
	loader: async () => fetchInbox({ data: { limit: 1, withCounts: true } }),
	component: AppLayout,
});

function AppLayout() {
	const { viewer } = Route.useRouteContext();
	const sidebar = Route.useLoaderData();
	const [menuOpen, setMenuOpen] = useState(false);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// Close the mobile menu after navigating.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value the effect reads
	useEffect(() => setMenuOpen(false), [pathname]);

	return (
		<div className="flex min-h-screen">
			{/* The column keeps the wash and rule down the full page; the sidebar inside stays in view. */}
			<div
				className="hidden w-[232px] shrink-0 border-r border-rule bg-wash lg:block"
				aria-hidden="true"
			/>
			<aside
				className={`fixed inset-y-0 left-0 z-30 w-[232px] flex-col border-r border-rule bg-wash lg:flex ${menuOpen ? "flex" : "hidden"}`}
			>
				<div className="flex items-center gap-2.5 px-5 pb-5 pt-[19px]">
					<Logo />
					<span className="text-[17px] font-semibold tracking-tight">
						Catchall
					</span>
				</div>
				<nav className="space-y-0.5 px-3">
					<NavItem
						to="/inbox"
						icon="inbox"
						label="Inbox"
						count={sidebar.counts?.all}
					/>
					<NavItem to="/tests" icon="code" label="Tests & API" />
					<NavItem to="/settings" icon="settings" label="Settings" />
				</nav>
				<MailboxList mailboxes={sidebar.mailboxes || []} />
				<div className="mt-auto">
					<div className="mx-3 border-t border-rule px-2 py-4">
						<div className="text-[12px] text-pencil">Any name @</div>
						<DomainText domain={sidebar.domain} />
					</div>
					<UserMenu
						name={viewer.name}
						email={viewer.email}
						role={viewer.role}
					/>
				</div>
			</aside>
			{menuOpen ? (
				<button
					type="button"
					aria-label="Close menu"
					className="fixed inset-0 z-20 bg-black/30 lg:hidden"
					onClick={() => setMenuOpen(false)}
				/>
			) : null}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-3 border-b border-rule px-4 py-3 lg:hidden">
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => setMenuOpen(true)}
					>
						Menu
					</button>
					<Logo size={22} />
					<span className="font-semibold">Catchall</span>
				</div>
				<LiveTokenProvider>
					<Outlet />
				</LiveTokenProvider>
			</div>
		</div>
	);
}

function NavItem({
	to,
	icon,
	label,
	count,
}: {
	to: "/inbox" | "/tests" | "/settings";
	icon: IconName;
	label: string;
	count?: number;
}) {
	return (
		<Link
			to={to}
			className="flex h-8 items-center gap-2.5 rounded-md border border-transparent px-2 text-[15px] text-graphite hover:text-ink"
			activeProps={{ className: "!border-rule bg-paper !text-ink" }}
		>
			<Icon name={icon} size={16} />
			<span className="flex-1">{label}</span>
			{count !== undefined ? (
				<span className="mono text-[12px] text-graphite">{count}</span>
			) : null}
		</Link>
	);
}

function MailboxList({
	mailboxes,
}: {
	mailboxes: { mailbox: string; count: number }[];
}) {
	if (!mailboxes.length) return null;
	return (
		<div className="mt-7 min-h-0 overflow-y-auto px-3">
			<div className="px-2 pb-2 text-[12px] font-medium text-pencil">
				Recent addresses
			</div>
			<ul>
				{mailboxes.map((m) => (
					<li key={m.mailbox}>
						<Link
							to="/inbox"
							search={{ mailbox: m.mailbox }}
							className="flex h-[30px] items-center rounded-md px-2 hover:bg-wash-2"
							activeOptions={{ includeSearch: true }}
							activeProps={{ className: "bg-wash-2" }}
						>
							<span className="mono flex-1 truncate text-[13px]">
								{m.mailbox}
							</span>
							<span className="mono text-[12px] text-graphite">{m.count}</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function DomainText({ domain }: { domain: string }) {
	const [head, tail] = splitDomain(domain);
	return (
		<div className="mono mt-1 text-[12px] leading-[18px] text-graphite">
			<span className="break-all">{head}</span>
			<wbr />
			<span className="whitespace-nowrap">{tail}</span>
		</div>
	);
}

function UserMenu({
	name,
	email,
	role,
}: {
	name: string;
	email: string;
	role: string;
}) {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [open]);

	return (
		<div ref={ref} className="relative mx-3 mb-3 border-t border-rule pt-3">
			{open ? (
				<div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-rule bg-paper p-1 shadow-lg">
					<div className="px-2.5 py-2 text-[12px] text-graphite">{email}</div>
					<ThemeSwitch />
					<button
						type="button"
						className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[14px] hover:bg-wash"
						onClick={async () => {
							await submitSignOut();
							await navigate({ to: "/login" });
						}}
					>
						<Icon name="logout" size={15} /> Sign out
					</button>
				</div>
			) : null}
			<button
				type="button"
				className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-wash-2"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="flex size-7 items-center justify-center rounded-full bg-button text-[11px] font-semibold text-button-ink">
					{initials(name, email)}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[14px]">{name || email}</span>
					<span className="block text-[12px] text-graphite">
						{role === "admin" ? "Admin" : "Member"}
					</span>
				</span>
				<Icon name="updown" size={15} className="text-graphite" />
			</button>
		</div>
	);
}

function ThemeSwitch() {
	const [theme, setTheme] = useState<string>(() =>
		typeof document === "undefined"
			? ""
			: document.documentElement.dataset.theme || "",
	);
	const apply = (next: string) => {
		setTheme(next);
		if (next) document.documentElement.dataset.theme = next;
		else delete document.documentElement.dataset.theme;
		try {
			if (next) localStorage.setItem("catchall-theme", next);
			else localStorage.removeItem("catchall-theme");
		} catch {
			// Storage blocked: the choice lasts until reload.
		}
	};
	return (
		<div className="flex items-center gap-1 px-2.5 py-1.5">
			{[
				["", "System"],
				["light", "Light"],
				["dark", "Dark"],
			].map(([value, label]) => (
				<button
					key={label}
					type="button"
					className={`h-7 flex-1 rounded-md text-[12px] ${theme === value ? "bg-wash-2 font-medium text-ink" : "text-graphite hover:text-ink"}`}
					onClick={() => apply(value)}
				>
					{label}
				</button>
			))}
		</div>
	);
}
