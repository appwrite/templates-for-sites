import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { displayName } from "#/lib/permissions";
import type { Page } from "#/lib/types";
import { AvatarStack } from "../ui";
import { useWorkspace } from "./workspace-context";

let currentTarget: HTMLElement | null = null;
const targetListeners = new Set<(el: HTMLElement | null) => void>();

function setActionTarget(el: HTMLElement | null) {
	currentTarget = el;
	for (const fn of targetListeners) fn(el);
}

function useActionTarget() {
	const [target, setTarget] = useState<HTMLElement | null>(currentTarget);
	useEffect(() => {
		targetListeners.add(setTarget);
		// The bar's own ref lands before this effect runs on first load.
		setTarget(currentTarget);
		return () => {
			targetListeners.delete(setTarget);
		};
	}, []);
	return target;
}

// Renders children into the top bar's action area (Share, AI, saved state). Feature code uses this.
export function TopBarActions({ children }: { children: ReactNode }) {
	const target = useActionTarget();
	return target ? createPortal(children, target) : null;
}

let leadTarget: HTMLElement | null = null;
const leadListeners = new Set<(el: HTMLElement | null) => void>();

function setLeadTarget(el: HTMLElement | null) {
	leadTarget = el;
	for (const fn of leadListeners) fn(el);
}

// Replaces the breadcrumb with something more useful (a row's way back to its database).
export function TopBarLead({ children }: { children: ReactNode }) {
	const [target, setTarget] = useState<HTMLElement | null>(leadTarget);
	useEffect(() => {
		leadListeners.add(setTarget);
		setTarget(leadTarget);
		return () => {
			leadListeners.delete(setTarget);
		};
	}, []);
	return target ? createPortal(children, target) : null;
}

export function Breadcrumbs() {
	const { pages, activePageId, workspace } = useWorkspace();
	const page = pages.find((p) => p.id === activePageId);
	const trail: { label: string; id?: string }[] = [];
	if (page) {
		let current: Page | undefined = page;
		const chain: Page[] = [];
		while (current) {
			chain.unshift(current);
			current = current.parentId
				? pages.find((p) => p.id === current?.parentId)
				: undefined;
		}
		const section = workspace.sections.find(
			(s) => s.id === chain[0]?.sectionId,
		);
		if (section) trail.push({ label: section.name });
		for (const item of chain)
			trail.push({ label: displayName(item), id: item.id });
	}
	if (!page && !trail.length) return null;
	return (
		<div className="flex min-w-0 flex-1 items-center gap-3 text-sm leading-4 max-md:gap-1.5 max-md:text-[15px]">
			{trail.map((crumb, i) => {
				const last = i === trail.length - 1;
				// A phone has room for the page and at most one level above it.
				const hideOnPhone = !last && trail.length > 2;
				return (
					<Fragment key={crumb.id ?? crumb.label}>
						{i > 0 && (
							<span
								className={`text-rule-strong max-md:text-pencil ${hideOnPhone || (trail.length > 2 && i === trail.length - 1) ? "max-md:hidden" : ""}`}
							>
								/
							</span>
						)}
						{crumb.id && !last ? (
							<Link
								to="/p/$pageId"
								params={{ pageId: crumb.id }}
								className={`truncate text-pencil hover:text-ink ${hideOnPhone ? "max-md:hidden" : ""}`}
							>
								{crumb.label}
							</Link>
						) : (
							<span
								className={
									last
										? "truncate font-medium text-ink"
										: `truncate text-pencil ${hideOnPhone ? "max-md:hidden" : ""}`
								}
							>
								{crumb.label}
							</span>
						)}
					</Fragment>
				);
			})}
		</div>
	);
}

export function TopBar({
	title,
	onMenu,
}: {
	title?: string;
	onMenu?: () => void;
}) {
	const { peers, activePageId } = useWorkspace();
	const here = peers
		.filter((p) => activePageId && p.pageId === activePageId)
		.map((p) => ({ id: p.userId, name: p.name }));
	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule pl-4 pr-4 max-md:box-content max-md:h-[52px] max-md:gap-2 max-md:pl-2 max-md:pr-2.5 max-md:pt-safe md:pl-6">
			{onMenu && (
				<button
					type="button"
					aria-label="Open menu"
					onClick={onMenu}
					className="flex size-10 shrink-0 items-center justify-center rounded-md text-ink hover:bg-wash-2 md:hidden"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						aria-hidden="true"
					>
						<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
					</svg>
				</button>
			)}
			<div ref={setLeadTarget} className="contents" />
			{title ? (
				<div className="min-w-0 flex-1 truncate text-sm font-medium text-ink max-md:text-[15px]">
					{title}
				</div>
			) : (
				<Breadcrumbs />
			)}
			{here.length > 0 && (
				<div
					className="px-2 max-md:px-0"
					title={
						here.length === 1
							? `${here[0].name} is here`
							: `${here.length} people here`
					}
				>
					<AvatarStack people={here} size={26} />
				</div>
			)}
			<div ref={setActionTarget} className="flex items-center gap-3" />
		</header>
	);
}
